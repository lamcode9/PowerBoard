import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BoardProject, createElementFromPreset } from "@board/schema";
import { BoardStore } from "./boardService";
import { CloudBoardSummary, CloudFileRecord, CloudStore } from "./cloudStore";

async function tempStore(cloud?: CloudStore) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "board-store-"));
  const store = new BoardStore(dir, cloud);
  await store.ensureReady();
  return { dir, store };
}

describe("BoardStore", () => {
  it("creates, reads, updates, undoes, and redoes a board", async () => {
    const { store } = await tempStore();
    const board = await store.createBoard("Test Board");
    const element = createElementFromPreset("button", board.artboards[0]!.id, 24, 24);

    const updated = await store.applyOperation(board.id, { type: "add_element", element });
    expect(updated.elements.some((candidate) => candidate.id === element.id)).toBe(true);

    const undone = await store.undo(board.id);
    expect(undone.elements.some((candidate) => candidate.id === element.id)).toBe(false);

    const redone = await store.redo(board.id);
    expect(redone.elements.some((candidate) => candidate.id === element.id)).toBe(true);
  });

  it("applies artboard edits through undoable operations", async () => {
    const { store } = await tempStore();
    const board = await store.createBoard("Artboard Ops");
    const artboardId = board.artboards[0]!.id;

    const updated = await store.applyOperation(board.id, { type: "update_artboard", artboardId, patch: { x: 320, name: "Moved Screen" } });
    expect(updated.artboards.find((candidate) => candidate.id === artboardId)?.x).toBe(320);

    const undone = await store.undo(board.id);
    expect(undone.artboards.find((candidate) => candidate.id === artboardId)?.name).toBe(board.artboards[0]!.name);
  });

  it("exports spec, React/Tailwind files, and PNG", async () => {
    const { store } = await tempStore();
    const board = await store.createBoard("Export Board");

    const spec = await store.exportSpec(board.id);
    expect(spec.markdown).toContain("Implementation Spec");

    const react = await store.exportReactTailwind(board.id);
    expect(react.files.length).toBeGreaterThan(0);

    const png = await store.exportArtboardPng(board.id, board.artboards[0]!.id);
    const stat = await fs.stat(png.filePath);
    expect(stat.size).toBeGreaterThan(100);
  });

  it("mirrors boards, assets, and exports to cloud storage", async () => {
    const cloud = new MemoryCloudStore();
    const { dir, store } = await tempStore(cloud);
    const board = await store.createBoard("Cloud Board");

    expect(await cloud.readBoard(board.id)).toMatchObject({ id: board.id, name: "Cloud Board" });

    await fs.rm(path.join(dir, board.id), { recursive: true, force: true });
    const restored = await store.readBoard(board.id);
    expect(restored.id).toBe(board.id);

    const upload = await store.saveAsset(board.id, {
      fileName: "overlay.png",
      dataUrl: "data:image/png;base64,aGVsbG8="
    });
    const asset = upload.project.assets.find((candidate) => candidate.id === upload.assetId);
    expect(asset).toBeDefined();
    expect(await cloud.readFile(board.id, `assets/${asset!.fileName}`)).toMatchObject({ contentType: "image/png" });

    await store.exportSpec(board.id);
    expect(await cloud.readFile(board.id, "exports/implementation-spec.md")).toMatchObject({ contentType: "text/markdown; charset=utf-8" });
  });
});

class MemoryCloudStore implements CloudStore {
  readonly label = "memory-cloud";
  private readonly boards = new Map<string, BoardProject>();
  private readonly files = new Map<string, CloudFileRecord>();

  async ensureReady(): Promise<void> {}

  async listBoards(): Promise<CloudBoardSummary[]> {
    return Array.from(this.boards.values()).map((project) => ({
      id: project.id,
      name: project.name,
      updatedAt: project.metadata.updatedAt,
      artboardCount: project.artboards.length,
      elementCount: project.elements.length
    }));
  }

  async readBoard(boardId: string): Promise<BoardProject | undefined> {
    return this.boards.get(boardId);
  }

  async writeBoard(project: BoardProject): Promise<void> {
    this.boards.set(project.id, project);
  }

  async writeFile(input: {
    boardId: string;
    path: string;
    kind: "asset" | "export";
    contentType: string;
    data: Buffer;
  }): Promise<void> {
    this.files.set(`${input.boardId}/${input.path}`, {
      data: input.data,
      contentType: input.contentType,
      sizeBytes: input.data.byteLength,
      updatedAt: new Date().toISOString()
    });
  }

  async readFile(boardId: string, filePath: string): Promise<CloudFileRecord | undefined> {
    return this.files.get(`${boardId}/${filePath}`);
  }
}
