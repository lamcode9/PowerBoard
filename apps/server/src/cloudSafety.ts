import { BoardProject, BoardProjectSchema, createDefaultProject, createId, nowIso, validateBoardProject } from "@powerboard/schema";
import { BoardStore } from "./boardService.js";
import { CloudStore, createCloudStoreFromEnv } from "./cloudStore.js";

type SafetyMode = "canary" | "backup";

interface SafetyArgs {
  mode: SafetyMode;
  boardId?: string;
  name?: string;
  write: boolean;
}

const PRODUCTION_API = process.env.POWERBOARD_PRODUCTION_API?.replace(/\/+$/, "") ?? "https://lamper-server.vercel.app/api";
const SAFETY_ACTOR = "PowerBoard cloud safety";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const health = await fetchJson<{ ok: boolean; cloudStore?: string; storageMode?: string }>(`${PRODUCTION_API}/health`);
  if (!health.ok || health.cloudStore !== "supabase-postgres" || health.storageMode !== "cloud") {
    throw new Error(`Production health is not cloud-ready: ${JSON.stringify(health)}`);
  }

  const result = args.mode === "canary" ? await prepareCanary(args) : await prepareBackup(args);
  console.log(JSON.stringify({ ok: true, write: args.write, productionHealth: health, ...result }, null, 2));
}

async function prepareCanary(args: SafetyArgs) {
  const candidate = createCanaryProject(args.name);
  if (!args.write) {
    return {
      action: "dry-run-canary",
      note: "No cloud board was created. Re-run with --write to create this canary board.",
      candidate: summarizeProject(candidate)
    };
  }

  const { store, cloud } = await cloudStore();
  try {
    await store.writeBoard(candidate);
    const verified = await store.readBoard(candidate.id);
    return { action: "created-canary", candidate: summarizeProject(verified) };
  } finally {
    await cloud.close?.();
  }
}

async function prepareBackup(args: SafetyArgs) {
  if (!args.boardId) {
    throw new Error("Backup mode requires --board <boardId>.");
  }

  const source = args.write ? await readCloudBoard(args.boardId) : await readProductionBoard(args.boardId);
  const candidate = createBackupProject(source, args.name);
  if (!args.write) {
    return {
      action: "dry-run-backup",
      note: "No cloud board was created. Re-run with --write to create this backup duplicate.",
      source: summarizeProject(source),
      candidate: summarizeProject(candidate)
    };
  }

  const { store, cloud } = await cloudStore();
  try {
    await store.writeBoard(candidate);
    const copiedAssets = await copyAssets(cloud, source, candidate);
    const verified = await store.readBoard(candidate.id);
    return { action: "created-backup", source: summarizeProject(source), candidate: summarizeProject(verified), copiedAssets };
  } finally {
    await cloud.close?.();
  }
}

function createCanaryProject(name?: string): BoardProject {
  const now = nowIso();
  return BoardProjectSchema.parse({
    ...createDefaultProject(name ?? `PowerBoard Canary - ${timestampLabel(now)}`),
    id: createId("canary_board"),
    selection: [],
    metadata: {
      createdAt: now,
      updatedAt: now,
      createdBy: SAFETY_ACTOR,
      safetyKind: "canary",
      safetyCreatedAt: now
    }
  });
}

function createBackupProject(source: BoardProject, name?: string): BoardProject {
  const now = nowIso();
  const id = createId("backup_board");
  return BoardProjectSchema.parse({
    ...source,
    id,
    name: name ?? `Backup of ${source.name} - ${timestampLabel(now)}`,
    assets: source.assets.map((asset) => ({ ...asset, src: `/boards/${id}/assets/${asset.fileName}` })),
    selection: [],
    metadata: {
      ...source.metadata,
      createdAt: now,
      updatedAt: now,
      createdBy: SAFETY_ACTOR,
      safetyKind: "backup",
      safetyCreatedAt: now,
      backupOfBoardId: source.id,
      backupOfBoardName: source.name,
      backupOfUpdatedAt: source.metadata.updatedAt
    }
  });
}

async function readCloudBoard(boardId: string): Promise<BoardProject> {
  const { store, cloud } = await cloudStore();
  try {
    return await store.readBoard(boardId);
  } finally {
    await cloud.close?.();
  }
}

async function readProductionBoard(boardId: string): Promise<BoardProject> {
  return validateBoardProject(await fetchJson<unknown>(`${PRODUCTION_API}/boards/${encodeURIComponent(boardId)}`));
}

async function copyAssets(cloud: CloudStore, source: BoardProject, candidate: BoardProject): Promise<number> {
  let copied = 0;
  for (const asset of source.assets) {
    const record = await cloud.readFile(source.id, `assets/${asset.fileName}`);
    if (!record) {
      console.warn(`Asset missing in cloud backup source: ${asset.fileName}`);
      continue;
    }
    await cloud.writeFile({
      boardId: candidate.id,
      path: `assets/${asset.fileName}`,
      kind: "asset",
      contentType: record.contentType,
      data: record.data,
      metadata: { copiedFromBoardId: source.id, copiedFromAssetId: asset.id }
    });
    copied += 1;
  }
  return copied;
}

async function cloudStore(): Promise<{ store: BoardStore; cloud: CloudStore }> {
  const cloud = createCloudStoreFromEnv();
  if (!cloud) {
    throw new Error("SUPABASE_DB_URL is required for --write cloud safety operations.");
  }
  const store = new BoardStore(undefined, cloud, "cloud");
  await store.ensureReady();
  return { store, cloud };
}

function summarizeProject(project: BoardProject) {
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.metadata.updatedAt,
    artboards: project.artboards.length,
    elements: project.elements.length,
    assets: project.assets.length
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed ${response.status} for ${url}`);
  }
  return response.json() as Promise<T>;
}

function parseArgs(argv: string[]): SafetyArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`Usage:
  npm run cloud:safety -- --mode=canary [--write] [--name "PowerBoard Canary"]
  npm run cloud:safety -- --mode=backup --board <boardId> [--write] [--name "Backup name"]

Dry-run is the default. --write requires SUPABASE_DB_URL and creates a new cloud board only.`);
    process.exit(0);
  }
  const mode = readArg(argv, "mode") ?? "canary";
  if (mode !== "canary" && mode !== "backup") {
    throw new Error("--mode must be canary or backup.");
  }
  return {
    mode,
    boardId: readArg(argv, "board"),
    name: readArg(argv, "name"),
    write: argv.includes("--write")
  };
}

function readArg(argv: string[], name: string): string | undefined {
  const equalsPrefix = `--${name}=`;
  const equalValue = argv.find((arg) => arg.startsWith(equalsPrefix));
  if (equalValue) return equalValue.slice(equalsPrefix.length).trim() || undefined;
  const index = argv.indexOf(`--${name}`);
  const next = index >= 0 ? argv[index + 1] : undefined;
  return next && !next.startsWith("--") ? next.trim() : undefined;
}

function timestampLabel(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
