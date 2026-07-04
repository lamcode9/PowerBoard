import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { BoardOperation, BoardProject, validateBoardProject } from "@powerboard/schema";
import { ensureInsideRoot, safeSegment } from "./paths.js";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const MAX_STACK = 50;
const OPLOG_ROTATE_BYTES = 5 * 1024 * 1024;

interface HistoryIndex {
  nextSeq: number;
  undo: number[];
  redo: number[];
}

export interface OpLogEntry {
  seq: number;
  at: string;
  source: "user" | "agent";
  actor?: string;
  type: BoardOperation["type"] | "replace_board" | "restore_backup";
  targetIds: string[];
}

/**
 * Disk-backed undo/redo history + append-only operation log, one folder per board
 * (`<boardDir>/history/`). Snapshots are gzipped pre-operation states, so undo/redo
 * survive app restarts (decision D6); the op-log is the future sync substrate.
 */
export class HistoryStore {
  private indexes = new Map<string, HistoryIndex>();
  private locks = new Map<string, Promise<unknown>>();

  constructor(private readonly root: string) {}

  async pushUndo(boardId: string, project: BoardProject): Promise<void> {
    await this.withLock(boardId, async () => {
      const index = await this.loadIndex(boardId);
      const seq = index.nextSeq++;
      await this.writeSnapshot(boardId, seq, project);
      index.undo.push(seq);
      await this.pruneStack(boardId, index.undo);
      await this.saveIndex(boardId, index);
    });
  }

  async popUndo(boardId: string): Promise<BoardProject | undefined> {
    return this.withLock(boardId, async () => {
      const index = await this.loadIndex(boardId);
      const seq = index.undo.pop();
      if (seq === undefined) return undefined;
      const project = await this.readSnapshot(boardId, seq);
      await this.saveIndex(boardId, index);
      void this.deleteSnapshot(boardId, seq);
      return project;
    });
  }

  async pushRedo(boardId: string, project: BoardProject): Promise<void> {
    await this.withLock(boardId, async () => {
      const index = await this.loadIndex(boardId);
      const seq = index.nextSeq++;
      await this.writeSnapshot(boardId, seq, project);
      index.redo.push(seq);
      await this.pruneStack(boardId, index.redo);
      await this.saveIndex(boardId, index);
    });
  }

  async popRedo(boardId: string): Promise<BoardProject | undefined> {
    return this.withLock(boardId, async () => {
      const index = await this.loadIndex(boardId);
      const seq = index.redo.pop();
      if (seq === undefined) return undefined;
      const project = await this.readSnapshot(boardId, seq);
      await this.saveIndex(boardId, index);
      void this.deleteSnapshot(boardId, seq);
      return project;
    });
  }

  async clearRedo(boardId: string): Promise<void> {
    await this.withLock(boardId, async () => {
      const index = await this.loadIndex(boardId);
      const stale = index.redo.splice(0, index.redo.length);
      await this.saveIndex(boardId, index);
      for (const seq of stale) void this.deleteSnapshot(boardId, seq);
    });
  }

  async depths(boardId: string): Promise<{ undo: number; redo: number }> {
    const index = await this.loadIndex(boardId);
    return { undo: index.undo.length, redo: index.redo.length };
  }

  async appendOpLog(boardId: string, entry: Omit<OpLogEntry, "seq">): Promise<void> {
    const dir = this.historyDir(boardId);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "oplog.jsonl");
    const index = await this.loadIndex(boardId);
    const line = `${JSON.stringify({ seq: index.nextSeq, ...entry } satisfies OpLogEntry)}\n`;
    await fs.appendFile(file, line, "utf8");
    const stat = await fs.stat(file).catch(() => undefined);
    if (stat && stat.size > OPLOG_ROTATE_BYTES) {
      await fs.rename(file, path.join(dir, "oplog.1.jsonl")).catch(() => undefined);
    }
  }

  async readOpLog(boardId: string, limit = 100): Promise<OpLogEntry[]> {
    const file = path.join(this.historyDir(boardId), "oplog.jsonl");
    try {
      const raw = await fs.readFile(file, "utf8");
      return raw
        .split("\n")
        .filter(Boolean)
        .slice(-limit)
        .map((line) => JSON.parse(line) as OpLogEntry);
    } catch {
      return [];
    }
  }

  private async withLock<T>(boardId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(boardId) ?? Promise.resolve();
    const run = previous.then(task, task);
    this.locks.set(boardId, run.catch(() => undefined));
    return run;
  }

  private historyDir(boardId: string): string {
    return ensureInsideRoot(this.root, path.join(this.root, safeSegment(boardId), "history"));
  }

  private snapshotPath(boardId: string, seq: number): string {
    return path.join(this.historyDir(boardId), `${seq}.json.gz`);
  }

  private async loadIndex(boardId: string): Promise<HistoryIndex> {
    const cached = this.indexes.get(boardId);
    if (cached) return cached;
    let index: HistoryIndex = { nextSeq: 1, undo: [], redo: [] };
    try {
      const raw = await fs.readFile(path.join(this.historyDir(boardId), "index.json"), "utf8");
      const parsed = JSON.parse(raw) as Partial<HistoryIndex>;
      if (typeof parsed.nextSeq === "number" && Array.isArray(parsed.undo) && Array.isArray(parsed.redo)) {
        index = { nextSeq: parsed.nextSeq, undo: parsed.undo, redo: parsed.redo };
      }
    } catch {
      // First use for this board — start fresh.
    }
    this.indexes.set(boardId, index);
    return index;
  }

  private async saveIndex(boardId: string, index: HistoryIndex): Promise<void> {
    const dir = this.historyDir(boardId);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "index.json");
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(index), "utf8");
    await fs.rename(tmp, file);
    this.indexes.set(boardId, index);
  }

  private async writeSnapshot(boardId: string, seq: number, project: BoardProject): Promise<void> {
    const dir = this.historyDir(boardId);
    await fs.mkdir(dir, { recursive: true });
    const data = await gzip(Buffer.from(JSON.stringify(project), "utf8"));
    await fs.writeFile(this.snapshotPath(boardId, seq), data);
  }

  private async readSnapshot(boardId: string, seq: number): Promise<BoardProject | undefined> {
    try {
      const data = await fs.readFile(this.snapshotPath(boardId, seq));
      return validateBoardProject(JSON.parse((await gunzip(data)).toString("utf8")));
    } catch (error) {
      console.error(`PowerBoard history: snapshot ${seq} for ${boardId} is unreadable — skipping. ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private async deleteSnapshot(boardId: string, seq: number): Promise<void> {
    await fs.rm(this.snapshotPath(boardId, seq), { force: true }).catch(() => undefined);
  }

  private async pruneStack(boardId: string, stack: number[]): Promise<void> {
    while (stack.length > MAX_STACK) {
      const seq = stack.shift();
      if (seq !== undefined) void this.deleteSnapshot(boardId, seq);
    }
  }
}
