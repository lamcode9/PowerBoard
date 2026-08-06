import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { BoardElement, BoardProject, BoardProjectSchema, createElementFromPreset } from "@powerboard/schema";
import { BoardStore, MAX_EXPORT_PIXELS, type StorageMode } from "./boardService";
import { CloudBoardSummary, CloudFileRecord, CloudStore } from "./cloudStore";

async function tempStore(cloud?: CloudStore, storageMode: StorageMode = "mirror") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "board-store-"));
  const store = new BoardStore(dir, cloud, storageMode);
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

  it("keeps every edit when several agents write the same board at once", async () => {
    const { store } = await tempStore();
    const board = await store.createBoard("Contended Board");
    const artboardId = board.artboards[0]!.id;
    const elements = Array.from({ length: 12 }, (_, index) => createElementFromPreset("button", artboardId, 24, 24 + index * 40));

    // Fired together, not awaited in turn: unserialized, these all read the same base state and the
    // last write wins, silently discarding eleven agents' work.
    await Promise.all(
      elements.map((element, index) => store.applyOperation(board.id, { type: "add_element", element }, { source: "agent", actor: `Agent ${index}` }))
    );

    const final = await store.readBoard(board.id);
    for (const element of elements) {
      expect(final.elements.some((candidate) => candidate.id === element.id)).toBe(true);
    }

    // Each concurrent write also has to leave its own undo entry and its own attributed op-log line.
    expect(await store.historyDepths(board.id)).toMatchObject({ undo: elements.length });
    const log = await store.readOpLog(board.id, 100);
    const actors = new Set(log.filter((entry) => entry.type === "add_element").map((entry) => entry.actor));
    expect(actors.size).toBe(elements.length);
  });

  it("deletes a board and its files, and reports missing boards as not found", async () => {
    const { dir, store } = await tempStore();
    const board = await store.createBoard("Deletable Board");
    const boardDir = path.join(dir, board.id);
    await expect(fs.access(boardDir)).resolves.toBeUndefined();

    const removed = await store.deleteBoard(board.id);
    expect(removed).toBe(true);

    const list = await store.listBoards();
    expect(list.some((candidate) => candidate.id === board.id)).toBe(false);
    await expect(store.readBoard(board.id)).rejects.toThrow();
    await expect(fs.access(boardDir)).rejects.toThrow();

    // Deleting an already-gone / never-existed board reports false rather than throwing.
    expect(await store.deleteBoard(board.id)).toBe(false);
    expect(await store.deleteBoard("board_missing")).toBe(false);
  });

  it("deletes a board from the cloud store in cloud mode", async () => {
    const cloud = new MemoryCloudStore();
    const { store } = await tempStore(cloud, "cloud");
    const board = await store.createBoard("Cloud Deletable");
    expect(await cloud.readBoard(board.id)).toBeDefined();

    expect(await store.deleteBoard(board.id)).toBe(true);
    expect(await cloud.readBoard(board.id)).toBeUndefined();
    expect(await store.deleteBoard(board.id)).toBe(false);
  });

  it("renames a board and bumps updatedAt, and rejects missing boards or blank names", async () => {
    const { store } = await tempStore();
    const board = await store.createBoard("Original Name");

    const renamed = await store.renameBoard(board.id, "  Renamed Board  ");
    expect(renamed.name).toBe("Renamed Board");
    expect(renamed.metadata.updatedAt >= board.metadata.updatedAt).toBe(true);

    // Persisted, not just returned.
    const reread = await store.readBoard(board.id);
    expect(reread.name).toBe("Renamed Board");
    const list = await store.listBoards();
    expect(list.find((candidate) => candidate.id === board.id)?.name).toBe("Renamed Board");

    await expect(store.renameBoard(board.id, "   ")).rejects.toThrow(/name is required/i);
    await expect(store.renameBoard("board_missing", "Nope")).rejects.toThrow();
  });

  it("lists the files backing a board: location, assets, and exports", async () => {
    const { dir, store } = await tempStore();
    const board = await store.createBoard("Files Board");

    const emptyListing = await store.listBoardFiles(board.id);
    expect(emptyListing.boardId).toBe(board.id);
    expect(emptyListing.name).toBe("Files Board");
    expect(emptyListing.location).toBe(path.join(dir, board.id, "board.json"));
    expect(emptyListing.assets).toEqual([]);
    expect(emptyListing.exports).toEqual([]);

    const pngPixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
    await store.saveAsset(board.id, { fileName: "pixel.png", dataUrl: pngPixel });
    await store.exportSpec(board.id);

    const listing = await store.listBoardFiles(board.id);
    expect(listing.assets).toHaveLength(1);
    expect(listing.assets[0]?.name).toBe("pixel.png");
    expect(listing.assets[0]?.mimeType).toBe("image/png");
    expect(listing.exports.map((file) => file.fileName)).toEqual(
      expect.arrayContaining(["implementation-spec.md", "board-summary.json"])
    );
    expect(listing.exports.every((file) => file.size > 0)).toBe(true);
  });

  it("does not persist stale selection ids", async () => {
    const { store } = await tempStore();
    const board = await store.createBoard("Selection Board");
    const element = board.elements[0]!;

    const selected = await store.setSelection(board.id, ["missing", element.id, element.id]);

    expect(selected.selection).toEqual([element.id]);
    expect(store.getSelection(board.id)).toEqual([element.id]);
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

  it("records agent edit metadata for agent operations", async () => {
    const { store } = await tempStore();
    const board = await store.createBoard("Agent Activity Board");
    const element = createElementFromPreset("button", board.artboards[0]!.id, 24, 24);

    const updated = await store.applyOperation(board.id, { type: "add_element", element }, { source: "agent", actor: "test-agent" });
    const metadata = updated.metadata as Record<string, unknown>;

    expect(metadata.lastAgentEditedAt).toBe(updated.metadata.updatedAt);
    expect(metadata.lastAgentEditedBy).toBe("test-agent");
    expect(metadata.lastAgentEditedOperation).toBe("add_element");
    expect(metadata.lastAgentEditedIds).toEqual([element.id]);
  });

  it("returns hierarchy and validation diagnostics for agent inspection", async () => {
    const { store } = await tempStore();
    const board = await store.createBoard("Agent Inspect Board");
    const mobileArtboard = board.artboards[0]!;
    const webArtboard = board.artboards[1]!;
    const line = createElementFromPreset("line", mobileArtboard.id, 24, 96);
    line.name = "Mobile Home / Odd Divider";
    line.props.direction = "sideways";
    const crossArtboardChild = createElementFromPreset("text", webArtboard.id, 24, 24);
    crossArtboardChild.name = "Web Dashboard / Cross Parent Text";
    crossArtboardChild.parentId = board.elements.find((element) => element.artboardId === mobileArtboard.id)!.id;
    const fixture = BoardProjectSchema.parse({
      ...board,
      elements: [...board.elements, line, crossArtboardChild],
      metadata: { ...board.metadata, updatedAt: new Date().toISOString() }
    });
    await store.replaceBoard(board.id, fixture);

    const validation = await store.validateBoard(board.id);
    const hierarchy = await store.inspectBoardHierarchy(board.id);

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["line-unknown-direction", "parent-on-different-artboard"]));
    expect(hierarchy.hierarchy.find((artboard) => artboard.id === mobileArtboard.id)?.children.some((element) => element.path === "Mobile Home / Header Frame")).toBe(true);
  });

  it("previews operations with validation without writing the board", async () => {
    const { store } = await tempStore();
    const board = await store.createBoard("Preview Board");
    const element = createElementFromPreset("button", board.artboards[0]!.id, 24, 24);

    const preview = await store.previewOperation(board.id, { type: "add_element", element });
    const stored = await store.readBoard(board.id);

    expect(preview.operationType).toBe("add_element");
    expect(preview.targetIds).toEqual([element.id]);
    expect(preview.before.elements).toBe(board.elements.length);
    expect(preview.after.elements).toBe(board.elements.length + 1);
    expect(preview.validation.valid).toBe(true);
    expect(stored.elements.some((candidate) => candidate.id === element.id)).toBe(false);
  });

  it("inspects selected elements with computed style and hierarchy paths", async () => {
    const { store } = await tempStore();
    const board = await store.createBoard("Selection Inspect Board");
    const element = board.elements.find((candidate) => candidate.id === "el_mobile_card")!;
    await store.setSelection(board.id, [element.id]);

    const inspection = await store.inspectSelection(board.id);
    const node = inspection.nodes[0];

    expect(inspection.requestedSelection).toEqual([element.id]);
    expect(inspection.effectiveSelection).toEqual([element.id]);
    expect(node).toMatchObject({
      kind: "element",
      id: element.id,
      path: "Mobile Home / Summary Frame / Safe-to-Spend Card",
      frame: { x: 24, y: 132, width: 345, height: 152 }
    });
    expect(node?.kind === "element" ? node.computedStyle.background : undefined).toBe("#FFFFFF");
    expect(node?.kind === "element" ? node.computedStyle.borderRadius : undefined).toBe("24px");

    const emptyExplicitSelection = await store.inspectSelection(board.id, []);
    expect(emptyExplicitSelection.requestedSelection).toEqual([element.id]);
    expect(emptyExplicitSelection.effectiveSelection).toEqual([element.id]);
  });

  it("exports selected artboard handoff with JSX and optional PNG", async () => {
    const { store } = await tempStore();
    const board = await store.createBoard("Selection Handoff Board");
    const artboard = board.artboards[0]!;

    const handoff = await store.exportSelectionHandoff(board.id, [artboard.id], { includePng: true });

    expect(handoff.selectedIds).toEqual([artboard.id]);
    expect(handoff.artboards).toHaveLength(1);
    expect(handoff.artboards[0]?.jsx.path).toBe("src/screens/MobileHome.tsx");
    expect(handoff.artboards[0]?.jsx.contents).toContain("export function MobileHome");
    expect(handoff.artboards[0]?.pngPath).toMatch(/Mobile-Home\.png$/);
    expect(handoff.inspection.nodes[0]).toMatchObject({ kind: "artboard", id: artboard.id });
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

  it("renders downloadable bytes for every format and scope without writing a file", async () => {
    const { dir, store } = await tempStore();
    const board = await store.createBoard("Download Board");
    const artboard = board.artboards[0]!;

    const png = await store.renderExport(board.id, { scope: "artboard", artboardId: artboard.id, format: "png", scale: 3 });
    expect(png.contentType).toBe("image/png");
    expect(png.fileName.endsWith(".png")).toBe(true);
    expect(png.scale).toBe(3);
    const pngMeta = await sharp(png.data).metadata();
    expect(pngMeta.width).toBe(Math.round(artboard.width * 3));
    expect(pngMeta.height).toBe(Math.round(artboard.height * 3));

    const jpg = await store.renderExport(board.id, { scope: "page", format: "jpg", scale: 1 });
    expect(jpg.contentType).toBe("image/jpeg");
    expect((await sharp(jpg.data).metadata()).format).toBe("jpeg");

    const svg = await store.renderExport(board.id, { scope: "artboard", artboardId: artboard.id, format: "svg" });
    expect(svg.contentType).toBe("image/svg+xml");
    expect(svg.data.toString("utf8")).toContain("<svg");

    const pdf = await store.renderExport(board.id, { scope: "page", format: "pdf", scale: 1 });
    expect(pdf.data.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // Nothing above touched the exports folder — renderExport is the download path, not a file writer.
    const exportsDir = await fs.readdir(path.join(dir, board.id, "exports")).catch(() => []);
    expect(exportsDir).toEqual([]);
  });

  it("keeps alpha for a transparent PNG and flattens formats that have no alpha", async () => {
    const { store } = await tempStore();
    const board = await store.createBoard("Transparent Board");
    const artboardId = board.artboards[0]!.id;

    const transparent = await store.renderExport(board.id, { scope: "artboard", artboardId, format: "png", scale: 1, background: "transparent" });
    const corner = await sharp(transparent.data).ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    expect(corner[3]).toBe(0);

    const opaque = await store.renderExport(board.id, { scope: "artboard", artboardId, format: "png", scale: 1, background: "white" });
    const opaqueCorner = await sharp(opaque.data).ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    expect(opaqueCorner[3]).toBe(255);

    // JPEG cannot carry alpha, so a transparent request must come back white rather than black.
    const jpg = await store.renderExport(board.id, { scope: "artboard", artboardId, format: "jpg", scale: 1, background: "transparent" });
    const jpgCorner = await sharp(jpg.data).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    expect([jpgCorner[0], jpgCorner[1], jpgCorner[2]]).toEqual([255, 255, 255]);
  });

  it("clamps an oversized export to the pixel budget and reports the scale it used", async () => {
    const { store } = await tempStore();
    const board = await store.createBoard("Poster Board");
    const huge = { ...board.artboards[0]!, width: 6000, height: 6000 };
    await store.replaceBoard(board.id, { ...board, artboards: [huge, ...board.artboards.slice(1)] });

    const rendered = await store.renderExport(board.id, { scope: "artboard", artboardId: huge.id, format: "png", scale: 4 });
    expect(rendered.requestedScale).toBe(4);
    expect(rendered.scale).toBeLessThan(4);
    expect(rendered.width * rendered.height).toBeLessThanOrEqual(MAX_EXPORT_PIXELS);
  });

  it("exports a whole page as one PNG including every frame", async () => {
    const { store } = await tempStore();
    const board = await store.createBoard("Page PNG Board");
    const page = await store.exportPagePng(board.id, { scale: 1 });

    const widest = Math.max(...board.artboards.map((artboard) => artboard.x + artboard.width));
    expect(page.width).toBeGreaterThan(widest - Math.min(...board.artboards.map((artboard) => artboard.x)));
    const stat = await fs.stat(page.filePath);
    expect(stat.size).toBeGreaterThan(100);
  });

  it("exports editable text as visible glyph pixels in PNG", async () => {
    const { store } = await tempStore();
    const board = await store.createBoard("Editable Text PNG");
    const artboard = {
      ...board.artboards[0]!,
      name: "Editable Text Fixture",
      width: 240,
      height: 120,
      background: "#ffffff"
    };
    const textElement: BoardElement = {
      id: "text_editable_fixture",
      type: "text",
      name: "Editable text fixture",
      artboardId: artboard.id,
      parentId: null,
      x: 24,
      y: 30,
      width: 192,
      height: 52,
      zIndex: 1,
      locked: false,
      visible: true,
      semanticRole: "headline",
      style: {
        color: "#000000",
        fontSize: 34,
        fontWeight: 800
      },
      layout: { mode: "absolute" },
      props: { text: "Editable" }
    };
    const fixture = BoardProjectSchema.parse({
      ...board,
      pages: board.pages.map((page, index) => ({ ...page, artboardIds: index === 0 ? [artboard.id] : [] })),
      artboards: [artboard],
      elements: [textElement],
      connectors: [],
      assets: [],
      selection: [],
      metadata: { ...board.metadata, updatedAt: new Date().toISOString() }
    });
    await store.replaceBoard(board.id, fixture);

    const png = await store.exportArtboardPng(board.id, artboard.id);
    const { data, info } = await sharp(png.filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    expect(countDarkPixels(data, info.width, info.channels, { left: 18, top: 22, right: 220, bottom: 92 })).toBeGreaterThan(40);
  });

  it("exports icon, line, and sparkline primitives as visible PNG pixels", async () => {
    const { store } = await tempStore();
    const board = await store.createBoard("Primitive PNG");
    const artboard = {
      ...board.artboards[0]!,
      name: "Primitive Fixture",
      width: 260,
      height: 180,
      background: "#ffffff"
    };
    const icon = createElementFromPreset("icon", artboard.id, 24, 24);
    icon.name = "Primitive Fixture / Icon";
    icon.props.materialIcon = "search";
    icon.style.color = "#000000";
    const line = createElementFromPreset("line", artboard.id, 24, 92);
    line.name = "Primitive Fixture / Line";
    line.width = 210;
    line.style.stroke = "#000000";
    line.style.strokeWidth = 4;
    const sparkline = createElementFromPreset("sparkline", artboard.id, 24, 116);
    sparkline.name = "Primitive Fixture / Sparkline";
    sparkline.style.stroke = "#000000";
    sparkline.style.strokeWidth = 4;
    const fixture = BoardProjectSchema.parse({
      ...board,
      pages: board.pages.map((page, index) => ({ ...page, artboardIds: index === 0 ? [artboard.id] : [] })),
      artboards: [artboard],
      elements: [icon, line, sparkline],
      connectors: [],
      assets: [],
      selection: [],
      metadata: { ...board.metadata, updatedAt: new Date().toISOString() }
    });
    await store.replaceBoard(board.id, fixture);

    const png = await store.exportArtboardPng(board.id, artboard.id);
    const { data, info } = await sharp(png.filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    expect(countDarkPixels(data, info.width, info.channels, { left: 12, top: 12, right: 240, bottom: 170 })).toBeGreaterThan(120);
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

  it("can use cloud as the primary store without writing board files locally", async () => {
    const cloud = new MemoryCloudStore();
    const { dir, store } = await tempStore(cloud, "cloud");
    const board = await store.createBoard("Cloud Primary Board");
    const element = createElementFromPreset("button", board.artboards[0]!.id, 24, 24);

    await expect(fs.stat(path.join(dir, board.id, "board.json"))).rejects.toThrow();
    expect(await cloud.readBoard(board.id)).toMatchObject({ id: board.id, name: "Cloud Primary Board" });

    const updated = await store.applyOperation(board.id, { type: "add_element", element });
    expect(updated.elements.some((candidate) => candidate.id === element.id)).toBe(true);
    await expect(fs.stat(path.join(dir, board.id, "board.json"))).rejects.toThrow();
    expect(await cloud.readBoard(board.id)).toMatchObject({ elements: expect.arrayContaining([expect.objectContaining({ id: element.id })]) });

    const upload = await store.saveAsset(board.id, {
      fileName: "overlay.png",
      dataUrl: "data:image/png;base64,aGVsbG8="
    });
    const asset = upload.project.assets.find((candidate) => candidate.id === upload.assetId);
    expect(asset).toBeDefined();
    await expect(fs.stat(path.join(dir, board.id, "assets", asset!.fileName))).rejects.toThrow();
    expect(await cloud.readFile(board.id, `assets/${asset.fileName}`)).toMatchObject({ contentType: "image/png" });

    const spec = await store.exportSpec(board.id);
    expect(spec.markdownPath).toBe(`cloud://${board.id}/exports/implementation-spec.md`);
    expect(await cloud.readFile(board.id, "exports/implementation-spec.md")).toMatchObject({ contentType: "text/markdown; charset=utf-8" });

    const png = await store.exportArtboardPng(board.id, board.artboards[0]!.id);
    expect(png.filePath).toMatch(/^cloud:\/\//);
    const pngName = png.filePath.split("/exports/")[1]!;
    expect(await cloud.readFile(board.id, `exports/${pngName}`)).toMatchObject({ contentType: "image/png" });
  });

  it("falls back to local files when cloud storage is unreachable", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "board-store-"));
    const store = new BoardStore(dir, new FailingCloudStore(), "mirror");

    await store.ensureReady();

    expect(store.cloudStatus()).toBe("local-files (cloud unavailable)");
    const board = await store.createBoard("Fallback Board");
    expect(board.name).toBe("Fallback Board");
    expect(await fs.stat(path.join(dir, board.id, "board.json"))).toBeDefined();
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

  async deleteBoard(boardId: string): Promise<boolean> {
    const existed = this.boards.delete(boardId);
    for (const key of Array.from(this.files.keys())) {
      if (key.startsWith(`${boardId}/`)) this.files.delete(key);
    }
    return existed;
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

class FailingCloudStore extends MemoryCloudStore {
  override readonly label = "failing-cloud";

  override async ensureReady(): Promise<void> {
    throw new Error("network unreachable");
  }
}

function countDarkPixels(data: Buffer, width: number, channels: number, bounds: { left: number; top: number; right: number; bottom: number }): number {
  let count = 0;
  for (let y = bounds.top; y < bounds.bottom; y += 1) {
    for (let x = bounds.left; x < bounds.right; x += 1) {
      const offset = (y * width + x) * channels;
      const red = data[offset] ?? 255;
      const green = data[offset + 1] ?? 255;
      const blue = data[offset + 2] ?? 255;
      const alpha = channels > 3 ? data[offset + 3] ?? 255 : 255;
      if (alpha > 0 && red < 96 && green < 96 && blue < 96) {
        count += 1;
      }
    }
  }
  return count;
}
