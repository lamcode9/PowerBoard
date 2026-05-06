import fs from "node:fs/promises";
import path from "node:path";
import { applyBoardOperation, BoardOperation, BoardProject, BoardProjectSchema, createDefaultProject, createId, validateBoardProject } from "@powerboard/schema";
import { renderArtboardSvg, renderReactTailwind, renderSpecMarkdown } from "@powerboard/renderers";
import sharp from "sharp";
import { CloudFileRecord, CloudStore, createCloudStoreFromEnv } from "./cloudStore.js";
import { boardRoot as defaultBoardRoot, ensureInsideRoot, safeSegment } from "./paths.js";

interface BoardSummary {
  id: string;
  name: string;
  updatedAt: string;
  artboardCount: number;
  elementCount: number;
}

interface AssetInput {
  fileName: string;
  dataUrl: string;
}

export class BoardStore {
  private undoStacks = new Map<string, BoardProject[]>();
  private redoStacks = new Map<string, BoardProject[]>();
  private selections = new Map<string, string[]>();
  private cloudUnavailableStatus: string | undefined;

  constructor(
    private readonly root = defaultBoardRoot,
    private cloud: CloudStore | undefined = createCloudStoreFromEnv()
  ) {}

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    if (!this.cloud) return;
    try {
      await this.cloud.ensureReady();
    } catch (error) {
      const label = this.cloud.label;
      this.cloud = undefined;
      this.cloudUnavailableStatus = "local-files (cloud unavailable)";
      console.warn(`PowerBoard cloud store disabled (${label}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async listBoards(): Promise<BoardSummary[]> {
    await this.ensureReady();
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    const boards: BoardSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const project = await this.readBoard(entry.name);
        boards.push({
          id: project.id,
          name: project.name,
          updatedAt: project.metadata.updatedAt,
          artboardCount: project.artboards.length,
          elementCount: project.elements.length
        });
      } catch {
        // Ignore folders that are not valid boards.
      }
    }
    if (this.cloud) {
      const localIds = new Set(boards.map((board) => board.id));
      const cloudBoards = await this.cloud.listBoards();
      for (const board of cloudBoards) {
        if (!localIds.has(board.id)) boards.push(board);
      }
    }
    return boards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createBoard(name = "PowerBoard Starter Board"): Promise<BoardProject> {
    await this.ensureReady();
    const project = createDefaultProject(name);
    const existing = (await this.exists(project.id)) || Boolean(await this.cloud?.readBoard(project.id));
    const id = existing ? createId("board") : project.id;
    const finalProject = BoardProjectSchema.parse({ ...project, id, name });
    await this.writeBoard(finalProject);
    return finalProject;
  }

  async readBoard(boardId: string): Promise<BoardProject> {
    const filePath = this.boardFilePath(boardId);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return validateBoardProject(parsed);
    } catch (error) {
      if (!isMissingFile(error) || !this.cloud) {
        throw error;
      }
      const cloudProject = await this.cloud.readBoard(boardId);
      if (!cloudProject) {
        throw error;
      }
      await this.writeLocalBoard(cloudProject);
      return cloudProject;
    }
  }

  async writeBoard(project: BoardProject): Promise<BoardProject> {
    const valid = validateBoardProject(project);
    await this.writeLocalBoard(valid);
    await this.cloud?.writeBoard(valid);
    return valid;
  }

  async readStoredFile(boardId: string, relativePath: string): Promise<CloudFileRecord | undefined> {
    return this.cloud?.readFile(boardId, relativePath);
  }

  cloudStatus(): string {
    return this.cloud?.label ?? this.cloudUnavailableStatus ?? "local-files";
  }

  private async writeLocalBoard(valid: BoardProject): Promise<BoardProject> {
    const dir = this.boardDir(valid.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(path.join(dir, "assets"), { recursive: true });
    await fs.mkdir(path.join(dir, "exports"), { recursive: true });
    const filePath = this.boardFilePath(valid.id);
    const tmp = `${filePath}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
    await fs.rename(tmp, filePath);
    this.selections.set(valid.id, valid.selection);
    return valid;
  }

  async applyOperation(boardId: string, operation: BoardOperation): Promise<BoardProject> {
    const current = await this.readBoard(boardId);
    const next = applyBoardOperation(current, operation);
    this.pushUndo(boardId, current);
    this.redoStacks.set(boardId, []);
    return this.writeBoard(next);
  }

  async replaceBoard(boardId: string, project: BoardProject): Promise<BoardProject> {
    if (boardId !== project.id) {
      throw new Error("Board id in URL and body must match.");
    }
    const current = await this.readBoard(boardId).catch(() => undefined);
    if (current) this.pushUndo(boardId, current);
    this.redoStacks.set(boardId, []);
    return this.writeBoard(project);
  }

  async undo(boardId: string): Promise<BoardProject> {
    const stack = this.undoStacks.get(boardId) ?? [];
    const previous = stack.pop();
    if (!previous) {
      return this.readBoard(boardId);
    }
    const current = await this.readBoard(boardId);
    this.pushRedo(boardId, current);
    this.undoStacks.set(boardId, stack);
    return this.writeBoard(previous);
  }

  async redo(boardId: string): Promise<BoardProject> {
    const stack = this.redoStacks.get(boardId) ?? [];
    const next = stack.pop();
    if (!next) {
      return this.readBoard(boardId);
    }
    const current = await this.readBoard(boardId);
    this.pushUndo(boardId, current);
    this.redoStacks.set(boardId, stack);
    return this.writeBoard(next);
  }

  getSelection(boardId: string): string[] {
    return this.selections.get(boardId) ?? [];
  }

  async setSelection(boardId: string, selection: string[]): Promise<BoardProject> {
    const project = await this.readBoard(boardId);
    const next = BoardProjectSchema.parse({ ...project, selection, metadata: { ...project.metadata, updatedAt: new Date().toISOString() } });
    await this.writeBoard(next);
    return next;
  }

  async saveAsset(boardId: string, input: AssetInput): Promise<{ project: BoardProject; assetId: string }> {
    const project = await this.readBoard(boardId);
    const match = input.dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) {
      throw new Error("Asset upload must use a base64 data URL.");
    }
    const mimeType = match[1]!;
    const buffer = Buffer.from(match[2]!, "base64");
    const ext = extensionForMime(mimeType, input.fileName);
    const fileName = `${createId("asset")}-${safeSegment(stripExtension(input.fileName))}.${ext}`;
    const dir = ensureInsideRoot(this.root, path.join(this.boardDir(boardId), "assets"));
    await fs.mkdir(dir, { recursive: true });
    const filePath = ensureInsideRoot(dir, path.join(dir, fileName));
    await fs.writeFile(filePath, buffer);
    await this.cloud?.writeBoard(project);
    await this.cloud?.writeFile({
      boardId,
      path: `assets/${fileName}`,
      kind: "asset",
      contentType: mimeType,
      data: buffer,
      metadata: { originalName: input.fileName }
    });

    const assetId = createId("asset");
    const asset = {
      id: assetId,
      name: input.fileName,
      fileName,
      mimeType,
      size: buffer.byteLength,
      src: `/boards/${boardId}/assets/${fileName}`
    };
    const next = BoardProjectSchema.parse({
      ...project,
      assets: [...project.assets, asset],
      metadata: { ...project.metadata, updatedAt: new Date().toISOString() }
    });
    await this.writeBoard(next);
    return { project: next, assetId };
  }

  async exportSpec(boardId: string): Promise<{ markdownPath: string; jsonPath: string; markdown: string }> {
    const project = await this.readBoard(boardId);
    await this.cloud?.writeBoard(project);
    const dir = await this.ensureExportDir(boardId);
    const markdown = renderSpecMarkdown(project);
    const markdownPath = path.join(dir, "implementation-spec.md");
    const jsonPath = path.join(dir, "board-summary.json");
    await fs.writeFile(markdownPath, markdown, "utf8");
    await fs.writeFile(jsonPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
    await this.cloud?.writeFile({
      boardId,
      path: "exports/implementation-spec.md",
      kind: "export",
      contentType: "text/markdown; charset=utf-8",
      data: Buffer.from(markdown, "utf8")
    });
    await this.cloud?.writeFile({
      boardId,
      path: "exports/board-summary.json",
      kind: "export",
      contentType: "application/json; charset=utf-8",
      data: Buffer.from(`${JSON.stringify(project, null, 2)}\n`, "utf8")
    });
    return { markdownPath, jsonPath, markdown };
  }

  async exportReactTailwind(boardId: string): Promise<{ dir: string; files: { path: string; contents: string }[]; summary: string }> {
    const project = await this.readBoard(boardId);
    await this.cloud?.writeBoard(project);
    const exportResult = renderReactTailwind(project);
    const dir = path.join(await this.ensureExportDir(boardId), "react-tailwind");
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    for (const file of exportResult.files) {
      const target = ensureInsideRoot(dir, path.join(dir, file.path));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.contents, "utf8");
      await this.cloud?.writeFile({
        boardId,
        path: `exports/react-tailwind/${file.path}`,
        kind: "export",
        contentType: contentTypeForFile(file.path),
        data: Buffer.from(file.contents, "utf8")
      });
    }
    return { dir, files: exportResult.files, summary: exportResult.summary };
  }

  async exportArtboardPng(boardId: string, artboardId: string): Promise<{ filePath: string }> {
    const project = await this.readBoard(boardId);
    await this.cloud?.writeBoard(project);
    const artboard = project.artboards.find((candidate) => candidate.id === artboardId);
    if (!artboard) {
      throw new Error(`Artboard not found: ${artboardId}`);
    }
    const svg = renderArtboardSvg(project, artboardId);
    const dir = await this.ensureExportDir(boardId);
    const filePath = path.join(dir, `${safeSegment(artboard.name)}.png`);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    await fs.writeFile(filePath, png);
    await this.cloud?.writeFile({
      boardId,
      path: `exports/${path.basename(filePath)}`,
      kind: "export",
      contentType: "image/png",
      data: png,
      metadata: { artboardId }
    });
    return { filePath };
  }

  async summarizeBoard(boardId: string): Promise<string> {
    const project = await this.readBoard(boardId);
    const artboards = project.artboards.map((artboard) => `${artboard.name} (${artboard.type}, ${Math.round(artboard.width)}x${Math.round(artboard.height)})`).join(", ");
    const elementsByType = project.elements.reduce<Record<string, number>>((counts, element) => {
      counts[element.type] = (counts[element.type] ?? 0) + 1;
      return counts;
    }, {});
    const elementSummary = Object.entries(elementsByType).map(([type, count]) => `${type}: ${count}`).join(", ");
    return `${project.name}: ${project.artboards.length} artboards [${artboards}], ${project.elements.length} elements [${elementSummary || "none"}], ${project.connectors.length} flow connectors.`;
  }

  private boardDir(boardId: string): string {
    return ensureInsideRoot(this.root, path.join(this.root, safeSegment(boardId)));
  }

  private boardFilePath(boardId: string): string {
    return ensureInsideRoot(this.root, path.join(this.boardDir(boardId), "board.json"));
  }

  private async exists(boardId: string): Promise<boolean> {
    try {
      await fs.access(this.boardFilePath(boardId));
      return true;
    } catch {
      return false;
    }
  }

  private async ensureExportDir(boardId: string): Promise<string> {
    const dir = ensureInsideRoot(this.root, path.join(this.boardDir(boardId), "exports"));
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  private pushUndo(boardId: string, project: BoardProject): void {
    const stack = this.undoStacks.get(boardId) ?? [];
    stack.push(project);
    this.undoStacks.set(boardId, stack.slice(-50));
  }

  private pushRedo(boardId: string, project: BoardProject): void {
    const stack = this.redoStacks.get(boardId) ?? [];
    stack.push(project);
    this.redoStacks.set(boardId, stack.slice(-50));
  }
}

function extensionForMime(mimeType: string, fileName: string): string {
  const explicit = path.extname(fileName).replace(".", "").toLowerCase();
  if (explicit) return explicit;
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/svg+xml") return "svg";
  if (mimeType === "image/webp") return "webp";
  return "bin";
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function contentTypeForFile(filePath: string): string {
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".tsx")) return "text/typescript; charset=utf-8";
  if (filePath.endsWith(".ts")) return "text/typescript; charset=utf-8";
  if (filePath.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  return "text/plain; charset=utf-8";
}
