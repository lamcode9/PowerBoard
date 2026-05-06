import { Pool } from "pg";
import { BoardProject, validateBoardProject } from "@board/schema";

const SCHEMA_NAME = "paper_design_danny";

export interface CloudBoardSummary {
  id: string;
  name: string;
  updatedAt: string;
  artboardCount: number;
  elementCount: number;
}

export interface CloudFileRecord {
  data: Buffer;
  contentType: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface CloudStore {
  readonly label: string;
  ensureReady(): Promise<void>;
  listBoards(): Promise<CloudBoardSummary[]>;
  readBoard(boardId: string): Promise<BoardProject | undefined>;
  writeBoard(project: BoardProject): Promise<void>;
  writeFile(input: {
    boardId: string;
    path: string;
    kind: "asset" | "export";
    contentType: string;
    data: Buffer;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  readFile(boardId: string, path: string): Promise<CloudFileRecord | undefined>;
}

export function createCloudStoreFromEnv(): CloudStore | undefined {
  if ((process.env.NODE_ENV === "test" || process.env.VITEST) && process.env.BOARD_CLOUD_TEST !== "1") {
    return undefined;
  }
  const driver = process.env.BOARD_CLOUD_DRIVER?.trim().toLowerCase();
  const connectionString = process.env.SUPABASE_DB_URL?.trim();
  if (driver && driver !== "supabase") {
    throw new Error(`Unsupported BOARD_CLOUD_DRIVER: ${driver}`);
  }
  if (!connectionString) {
    return undefined;
  }
  return new SupabasePostgresStore(connectionString);
}

export class SupabasePostgresStore implements CloudStore {
  readonly label = "supabase-postgres";
  private readonly pool: Pool;

  constructor(connectionString: string) {
    const ssl = shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined;
    this.pool = new Pool({ connectionString, ssl, max: 4, idleTimeoutMillis: 30_000 });
  }

  async ensureReady(): Promise<void> {
    await this.pool.query(`
      create schema if not exists ${SCHEMA_NAME};

      create table if not exists ${SCHEMA_NAME}.board_projects (
        id text primary key,
        name text not null,
        schema_version integer not null,
        project jsonb not null,
        artboard_count integer not null default 0,
        element_count integer not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null
      );

      create table if not exists ${SCHEMA_NAME}.board_files (
        board_id text not null references ${SCHEMA_NAME}.board_projects(id) on delete cascade,
        path text not null,
        kind text not null check (kind in ('asset', 'export')),
        content_type text not null,
        size_bytes integer not null check (size_bytes >= 0),
        data bytea not null,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (board_id, path)
      );

      create index if not exists board_projects_updated_at_idx
        on ${SCHEMA_NAME}.board_projects (updated_at desc);

      create index if not exists board_files_board_kind_idx
        on ${SCHEMA_NAME}.board_files (board_id, kind);

      alter table ${SCHEMA_NAME}.board_projects enable row level security;
      alter table ${SCHEMA_NAME}.board_files enable row level security;
    `);
  }

  async listBoards(): Promise<CloudBoardSummary[]> {
    const result = await this.pool.query<{
      id: string;
      name: string;
      updated_at: Date | string;
      artboard_count: number;
      element_count: number;
    }>(
      `select id, name, updated_at, artboard_count, element_count
       from ${SCHEMA_NAME}.board_projects
       order by updated_at desc`
    );

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      updatedAt: isoString(row.updated_at),
      artboardCount: row.artboard_count,
      elementCount: row.element_count
    }));
  }

  async readBoard(boardId: string): Promise<BoardProject | undefined> {
    const result = await this.pool.query<{ project: unknown }>(
      `select project
       from ${SCHEMA_NAME}.board_projects
       where id = $1
       limit 1`,
      [boardId]
    );
    const row = result.rows[0];
    return row ? validateBoardProject(row.project) : undefined;
  }

  async writeBoard(project: BoardProject): Promise<void> {
    const valid = validateBoardProject(project);
    await this.pool.query(
      `insert into ${SCHEMA_NAME}.board_projects
         (id, name, schema_version, project, artboard_count, element_count, updated_at)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7)
       on conflict (id) do update set
         name = excluded.name,
         schema_version = excluded.schema_version,
         project = excluded.project,
         artboard_count = excluded.artboard_count,
         element_count = excluded.element_count,
         updated_at = excluded.updated_at`,
      [
        valid.id,
        valid.name,
        valid.schemaVersion,
        JSON.stringify(valid),
        valid.artboards.length,
        valid.elements.length,
        valid.metadata.updatedAt
      ]
    );
  }

  async writeFile(input: {
    boardId: string;
    path: string;
    kind: "asset" | "export";
    contentType: string;
    data: Buffer;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `insert into ${SCHEMA_NAME}.board_files
         (board_id, path, kind, content_type, size_bytes, data, metadata, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
       on conflict (board_id, path) do update set
         kind = excluded.kind,
         content_type = excluded.content_type,
         size_bytes = excluded.size_bytes,
         data = excluded.data,
         metadata = excluded.metadata,
         updated_at = now()`,
      [
        input.boardId,
        normalizeCloudPath(input.path),
        input.kind,
        input.contentType,
        input.data.byteLength,
        input.data,
        JSON.stringify(input.metadata ?? {})
      ]
    );
  }

  async readFile(boardId: string, path: string): Promise<CloudFileRecord | undefined> {
    const result = await this.pool.query<{
      data: Buffer;
      content_type: string;
      size_bytes: number;
      updated_at: Date | string;
    }>(
      `select data, content_type, size_bytes, updated_at
       from ${SCHEMA_NAME}.board_files
       where board_id = $1 and path = $2
       limit 1`,
      [boardId, normalizeCloudPath(path)]
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      data: row.data,
      contentType: row.content_type,
      sizeBytes: row.size_bytes,
      updatedAt: isoString(row.updated_at)
    };
  }
}

function shouldUseSsl(connectionString: string): boolean {
  return /supabase\.(co|com)/i.test(connectionString) || /sslmode=require/i.test(connectionString);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizeCloudPath(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+/g, "/");
}
