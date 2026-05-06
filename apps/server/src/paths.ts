import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(here, "../../..");
dotenv.config({ path: path.join(repoRoot, ".env.local"), override: false, quiet: true });
dotenv.config({ path: path.join(repoRoot, ".env"), override: false, quiet: true });
export const boardRoot = path.resolve(process.env.BOARD_ROOT ?? path.join(repoRoot, "boards"));

export function ensureInsideRoot(root: string, targetPath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path escapes workspace root: ${targetPath}`);
  }
  return resolvedTarget;
}

export function safeSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "untitled";
}
