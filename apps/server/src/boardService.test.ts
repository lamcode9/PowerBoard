import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createElementFromPreset } from "@board/schema";
import { BoardStore } from "./boardService";

async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "board-store-"));
  const store = new BoardStore(dir);
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
});
