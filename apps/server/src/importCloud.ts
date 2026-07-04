// One-time Supabase → local import for the desktop pivot (decision D3: local files are the
// source of truth). Downloads every cloud board + its asset files into POWERBOARD_ROOT.
// Existing local boards are kept unless --overwrite is passed.
//   npm run import:cloud --prefix apps/server            # skip boards that exist locally
//   npm run import:cloud --prefix apps/server -- --overwrite
import fs from "node:fs/promises";
import path from "node:path";
import { boardRoot, safeSegment } from "./paths.js";
import { createCloudStoreFromEnv } from "./cloudStore.js";

const overwrite = process.argv.includes("--overwrite");
const cloud = createCloudStoreFromEnv();

if (!cloud) {
  throw new Error("SUPABASE_DB_URL is required to import PowerBoard cloud boards.");
}

await cloud.ensureReady();
await fs.mkdir(boardRoot, { recursive: true });

const summaries = await cloud.listBoards();
const results: Array<{ boardId: string; name: string; action: "imported" | "skipped-exists"; assets: number }> = [];

for (const summary of summaries) {
  const dir = path.join(boardRoot, safeSegment(summary.id));
  const boardPath = path.join(dir, "board.json");
  const exists = await fs
    .access(boardPath)
    .then(() => true)
    .catch(() => false);
  if (exists && !overwrite) {
    results.push({ boardId: summary.id, name: summary.name, action: "skipped-exists", assets: 0 });
    continue;
  }

  const project = await cloud.readBoard(summary.id);
  if (!project) continue;

  await fs.mkdir(path.join(dir, "assets"), { recursive: true });
  await fs.mkdir(path.join(dir, "exports"), { recursive: true });

  let assetCount = 0;
  for (const asset of project.assets) {
    const record = await cloud.readFile(project.id, `assets/${asset.fileName}`);
    if (!record) {
      console.warn(`Import: asset missing in cloud for ${project.id}: ${asset.fileName}`);
      continue;
    }
    await fs.writeFile(path.join(dir, "assets", asset.fileName), record.data);
    assetCount += 1;
  }

  const tmp = `${boardPath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  await fs.rename(tmp, boardPath);

  // Verify the round-trip before reporting success.
  const readBack = JSON.parse(await fs.readFile(boardPath, "utf8")) as { id?: string };
  if (readBack.id !== project.id) {
    throw new Error(`Import verification failed for ${project.id}: local board.json does not match.`);
  }
  results.push({ boardId: project.id, name: project.name, action: "imported", assets: assetCount });
}

console.log(JSON.stringify({ ok: true, cloudStore: cloud.label, boardRoot, boards: results }, null, 2));
await cloud.close?.();
