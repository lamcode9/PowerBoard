import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { validateBoardProject } from "@powerboard/schema";
import { boardRoot } from "./paths.js";
import { createCloudStoreFromEnv } from "./cloudStore.js";

const cloud = createCloudStoreFromEnv();

if (!cloud) {
  throw new Error("SUPABASE_DB_URL is required to sync local boards to PowerBoard cloud.");
}

await cloud.ensureReady();

const boardDirs = await fs.readdir(boardRoot, { withFileTypes: true }).catch((error: unknown) => {
  if (isMissingDirectory(error)) return [];
  throw error;
});

const results: Array<{
  boardId: string;
  name: string;
  artboards: number;
  elements: number;
  files: number;
  replacedCloud: boolean;
}> = [];

for (const entry of boardDirs) {
  if (!entry.isDirectory()) continue;
  const boardDir = path.join(boardRoot, entry.name);
  const boardPath = path.join(boardDir, "board.json");
  const raw = await fs.readFile(boardPath, "utf8").catch((error: unknown) => {
    if (isMissingDirectory(error)) return undefined;
    throw error;
  });
  if (!raw) continue;

  const project = validateBoardProject(JSON.parse(raw));
  const existing = await cloud.readBoard(project.id);
  await cloud.writeBoard(project);

  let files = 0;
  for (const asset of project.assets) {
    if (typeof asset.src !== "string" || !asset.src.startsWith("data:")) continue;
    const parsed = parseDataUrl(asset.src);
    if (!parsed) continue;
    const cloudPath = `assets/${asset.fileName}`;
    await cloud.writeFile({
      boardId: project.id,
      path: cloudPath,
      kind: "asset",
      contentType: parsed.contentType,
      data: parsed.data,
      metadata: { assetId: asset.id, originalName: asset.name }
    });
    await verifyCloudFile(project.id, cloudPath, parsed.data.byteLength);
    files += 1;
  }

  for (const folder of ["assets", "exports"] as const) {
    const root = path.join(boardDir, folder);
    for (const filePath of await walkFiles(root)) {
      const data = await fs.readFile(filePath);
      const relativePath = `${folder}/${path.relative(root, filePath).split(path.sep).join("/")}`;
      await cloud.writeFile({
        boardId: project.id,
        path: relativePath,
        kind: folder === "assets" ? "asset" : "export",
        contentType: contentTypeForFile(filePath),
        data,
        metadata: { syncedFrom: "local-board-folder" }
      });
      await verifyCloudFile(project.id, relativePath, data.byteLength);
      files += 1;
    }
  }

  const after = await cloud.readBoard(project.id);
  assert.deepStrictEqual(after, project, `Cloud verification failed for ${project.id}: uploaded board does not match local board.json.`);

  results.push({
    boardId: project.id,
    name: project.name,
    artboards: project.artboards.length,
    elements: project.elements.length,
    files,
    replacedCloud: Boolean(existing && !isDeepStrictEqual(existing, project))
  });
}

console.log(JSON.stringify({ ok: true, cloudStore: cloud.label, boardRoot, boards: results }, null, 2));
await cloud.close?.();

async function verifyCloudFile(boardId: string, filePath: string, expectedBytes: number): Promise<void> {
  const record = await cloud?.readFile(boardId, filePath);
  if (!record || record.sizeBytes !== expectedBytes) {
    throw new Error(`Cloud verification failed for ${boardId}/${filePath}.`);
  }
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    if (isMissingDirectory(error)) return [];
    throw error;
  });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(target));
    } else if (entry.isFile()) {
      files.push(target);
    }
  }
  return files.sort();
}

function parseDataUrl(value: string): { contentType: string; data: Buffer } | undefined {
  const match = value.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return undefined;
  return { contentType: match[1]!, data: Buffer.from(match[2]!, "base64") };
}

function contentTypeForFile(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".tsx") || lower.endsWith(".ts")) return "text/typescript; charset=utf-8";
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

function isMissingDirectory(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
