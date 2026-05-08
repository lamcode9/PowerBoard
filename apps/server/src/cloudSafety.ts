import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BoardProject,
  BoardProjectSchema,
  BoardValidationReport,
  createDefaultProject,
  createElementFromPreset,
  createId,
  nowIso,
  validateBoardProject,
  validateBoardStructure
} from "@powerboard/schema";
import { BoardStore } from "./boardService.js";
import { CloudStore, createCloudStoreFromEnv } from "./cloudStore.js";

type SafetyMode = "canary" | "backup";

interface SafetyArgs {
  mode: SafetyMode;
  boardId?: string;
  name?: string;
  write: boolean;
  verifyExports: boolean;
  includePrimitives: boolean;
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
  const candidate = createCanaryProject(args.name, { includePrimitives: args.includePrimitives });
  const validation = validateBoardStructure(candidate);
  if (!args.write) {
    return {
      action: "dry-run-canary",
      note: args.verifyExports
        ? "No cloud board was created. Re-run with --write --verify-exports to create, read back, validate, and export-check this canary board."
        : "No cloud board was created. Re-run with --write to create this canary board.",
      candidate: summarizeProject(candidate),
      validation: summarizeValidation(validation)
    };
  }

  const { store, cloud } = await cloudStore();
  try {
    await store.writeBoard(candidate);
    const verified = await store.readBoard(candidate.id);
    return { action: "created-canary", candidate: summarizeProject(verified), verification: await verifyStoredProject(store, verified, { verifyExports: args.verifyExports }) };
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
  const validation = validateBoardStructure(candidate);
  if (!args.write) {
    return {
      action: "dry-run-backup",
      note: "No cloud board was created. Re-run with --write to create this backup duplicate.",
      source: summarizeProject(source),
      candidate: summarizeProject(candidate),
      validation: summarizeValidation(validation)
    };
  }

  const { store, cloud } = await cloudStore();
  try {
    await store.writeBoard(candidate);
    const copiedAssets = await copyAssets(cloud, source, candidate);
    const verified = await store.readBoard(candidate.id);
    return {
      action: "created-backup",
      source: summarizeProject(source),
      candidate: summarizeProject(verified),
      copiedAssets,
      verification: await verifyStoredProject(store, verified, { verifyExports: args.verifyExports })
    };
  } finally {
    await cloud.close?.();
  }
}

export function createCanaryProject(name?: string, options: { includePrimitives?: boolean } = {}): BoardProject {
  const now = nowIso();
  const project = BoardProjectSchema.parse({
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
  return options.includePrimitives ? addPrimitiveCanaryFixture(project) : project;
}

export function createBackupProject(source: BoardProject, name?: string): BoardProject {
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

export async function verifyStoredProject(store: BoardStore, project: BoardProject, options: { verifyExports?: boolean } = {}) {
  const readBack = await store.readBoard(project.id);
  const validation = validateBoardStructure(readBack);
  const exportCheck = options.verifyExports ? await verifyExports(store, readBack) : undefined;
  return {
    readBack: summarizeProject(readBack),
    validation: summarizeValidation(validation),
    exports: exportCheck
  };
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

function addPrimitiveCanaryFixture(project: BoardProject): BoardProject {
  const artboard = project.artboards[0];
  if (!artboard) return project;
  const frame = createElementFromPreset("frame", artboard.id, 24, 316);
  frame.name = `${artboard.name} / Canary Primitive Frame`;
  frame.semanticRole = "canary validation frame";
  frame.width = 300;
  frame.height = 150;
  frame.zIndex = 20;
  const icon = createElementFromPreset("icon", artboard.id, 18, 18);
  icon.name = `${artboard.name} / Canary Add Icon`;
  icon.parentId = frame.id;
  icon.props.materialIcon = "add_circle";
  const line = createElementFromPreset("line", artboard.id, 18, 80);
  line.name = `${artboard.name} / Canary Divider`;
  line.parentId = frame.id;
  line.width = 260;
  const sparkline = createElementFromPreset("sparkline", artboard.id, 18, 98);
  sparkline.name = `${artboard.name} / Canary Sparkline`;
  sparkline.parentId = frame.id;
  sparkline.width = 260;
  sparkline.height = 42;

  return BoardProjectSchema.parse({
    ...project,
    elements: [...project.elements, frame, icon, line, sparkline],
    metadata: { ...project.metadata, canaryFixture: "primitive-readback-export", updatedAt: project.metadata.updatedAt }
  });
}

async function verifyExports(store: BoardStore, project: BoardProject) {
  const artboard = project.artboards[0];
  if (!artboard) {
    throw new Error("Cannot verify exports for a board with no artboards.");
  }
  const png = await store.exportArtboardPng(project.id, artboard.id);
  const spec = await store.exportSpec(project.id);
  const react = await store.exportReactTailwind(project.id);
  return {
    artboardId: artboard.id,
    pngPath: png.filePath,
    specPath: spec.markdownPath,
    reactDir: react.dir,
    reactFiles: react.files.length
  };
}

function summarizeValidation(report: BoardValidationReport) {
  return {
    valid: report.valid,
    errors: report.summary.errors,
    warnings: report.summary.warnings,
    issueCodes: Array.from(new Set(report.issues.map((issue) => issue.code))).sort()
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
  npm run cloud:safety -- --mode=canary [--write] [--verify-exports] [--include-primitives] [--name "PowerBoard Canary"]
  npm run cloud:safety -- --mode=backup --board <boardId> [--write] [--verify-exports] [--name "Backup name"]

Dry-run is the default. --write requires SUPABASE_DB_URL and creates a new cloud board only.
Use --include-primitives only when the target runtime already supports the branch primitive types.`);
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
    write: argv.includes("--write"),
    verifyExports: argv.includes("--verify-exports"),
    includePrimitives: argv.includes("--include-primitives")
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

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
