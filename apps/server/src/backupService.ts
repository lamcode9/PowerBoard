import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { BoardProject, validateBoardProject } from "@powerboard/schema";
import { safeSegment } from "./paths.js";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const DEBOUNCE_MS = 15_000;
const KEEP_SNAPSHOTS = 20;

export interface BackupStatus {
  dir: string;
  healthy: boolean;
  lastBackupAt?: string;
  lastError?: string;
  pending: number;
}

export interface BackupEntry {
  file: string;
  at: string;
  sizeBytes: number;
}

/**
 * Versioned board snapshots (decision D4: iCloud backup, not sync). Debounced after each
 * change and flushable on quit. A failed backup must be LOUD: it is recorded in status()
 * (surfaced in the app status bar) and logged as an error — never swallowed.
 */
export class BackupService {
  private timers = new Map<string, NodeJS.Timeout>();
  private lastBackupAt: string | undefined;
  private lastError: string | undefined;

  constructor(
    private readonly readBoard: (boardId: string) => Promise<BoardProject>,
    readonly dir = defaultBackupDir()
  ) {}

  schedule(boardId: string): void {
    const existing = this.timers.get(boardId);
    if (existing) clearTimeout(existing);
    this.timers.set(
      boardId,
      setTimeout(() => {
        void this.backupBoard(boardId);
      }, DEBOUNCE_MS)
    );
  }

  /** Cancel a pending debounced backup (e.g. the board was deleted). Existing snapshot files are kept. */
  cancel(boardId: string): void {
    const timer = this.timers.get(boardId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(boardId);
    }
  }

  async backupBoard(boardId: string): Promise<{ file: string }> {
    const timer = this.timers.get(boardId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(boardId);
    }
    try {
      const project = await this.readBoard(boardId);
      const dir = this.boardBackupDir(boardId);
      await fs.mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
      const file = path.join(dir, `${stamp}.json.gz`);
      const data = await gzip(Buffer.from(JSON.stringify(project, null, 2), "utf8"));
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, data);
      await fs.rename(tmp, file);
      await this.prune(dir);
      this.lastBackupAt = new Date().toISOString();
      this.lastError = undefined;
      return { file };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      console.error(`PowerBoard backup FAILED for ${boardId} — this board is NOT backed up: ${message}`);
      throw new Error(`Backup failed: ${message}`);
    }
  }

  async flush(boardIds?: string[]): Promise<{ backedUp: string[]; failed: { boardId: string; error: string }[] }> {
    const pending = boardIds ?? [...this.timers.keys()];
    const backedUp: string[] = [];
    const failed: { boardId: string; error: string }[] = [];
    for (const boardId of pending) {
      try {
        await this.backupBoard(boardId);
        backedUp.push(boardId);
      } catch (error) {
        failed.push({ boardId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { backedUp, failed };
  }

  async listBackups(boardId: string): Promise<BackupEntry[]> {
    const dir = this.boardBackupDir(boardId);
    try {
      const entries = await fs.readdir(dir);
      const backups: BackupEntry[] = [];
      for (const name of entries) {
        if (!name.endsWith(".json.gz")) continue;
        const stat = await fs.stat(path.join(dir, name)).catch(() => undefined);
        if (!stat) continue;
        backups.push({ file: name, at: stat.mtime.toISOString(), sizeBytes: stat.size });
      }
      return backups.sort((a, b) => b.file.localeCompare(a.file));
    } catch {
      return [];
    }
  }

  async readBackup(boardId: string, fileName: string): Promise<BoardProject> {
    if (!/^[A-Za-z0-9_-]+\.json\.gz$/.test(fileName)) {
      throw new Error(`Invalid backup file name: ${fileName}`);
    }
    const file = path.join(this.boardBackupDir(boardId), fileName);
    const data = await fs.readFile(file);
    return validateBoardProject(JSON.parse((await gunzip(data)).toString("utf8")));
  }

  status(): BackupStatus {
    return {
      dir: this.dir,
      healthy: this.lastError === undefined,
      lastBackupAt: this.lastBackupAt,
      lastError: this.lastError,
      pending: this.timers.size
    };
  }

  private boardBackupDir(boardId: string): string {
    return path.join(this.dir, safeSegment(boardId));
  }

  private async prune(dir: string): Promise<void> {
    const entries = (await fs.readdir(dir)).filter((name) => name.endsWith(".json.gz")).sort();
    while (entries.length > KEEP_SNAPSHOTS) {
      const oldest = entries.shift();
      if (oldest) await fs.rm(path.join(dir, oldest), { force: true }).catch(() => undefined);
    }
  }
}

export function defaultBackupDir(): string {
  const fromEnv = process.env.POWERBOARD_BACKUP_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(os.homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs", "PowerBoard", "Backups");
}
