import fs from "node:fs/promises";
import path from "node:path";
import {
  applyBoardOperation,
  BoardHierarchyArtboard,
  BoardOperation,
  BoardProject,
  BoardProjectSchema,
  BoardTemplate,
  BoardValidationReport,
  createDefaultProject,
  createId,
  filterValidSelection,
  inspectBoardHierarchy,
  sanitizeProjectSelection,
  validateBoardProject,
  validateBoardStructure
} from "@powerboard/schema";
import { renderArtboardReactTailwind, renderArtboardSvg, renderMermaid, renderPageSvg, renderReactTailwind, renderSpecMarkdown, type RenderedFile } from "@powerboard/renderers";
import sharp from "sharp";
import { jpegToPdf } from "./pdf.js";
import { CloudFileRecord, CloudStore, createCloudStoreFromEnv } from "./cloudStore.js";
import { HistoryStore, OpLogEntry } from "./historyStore.js";
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

export interface BoardFileListing {
  boardId: string;
  name: string;
  storageMode: StorageMode;
  /** board.json path (local) or a cloud:// URI (cloud-primary). */
  location: string;
  assets: Array<{ id: string; name: string; fileName: string; mimeType: string; size: number; src: string }>;
  exports: Array<{ fileName: string; path: string; size: number }>;
}

export type StorageMode = "local" | "mirror" | "cloud";
export type BoardEditSource = "user" | "agent";

export interface ApplyOperationOptions {
  actor?: string;
  source?: BoardEditSource;
}

export interface AgentBoardActivity {
  source: "agent";
  kind: "operation" | "selection";
  ids: string[];
  operationType?: string;
  at: string;
}

export interface InspectedArtboard {
  kind: "artboard";
  id: string;
  name: string;
  path: string;
  type: BoardProject["artboards"][number]["type"];
  frame: { x: number; y: number; width: number; height: number };
  background: string;
  locked: boolean;
  visible: boolean;
  childrenIds: string[];
}

export interface InspectedElement {
  kind: "element";
  id: string;
  name: string;
  path: string;
  type: BoardProject["elements"][number]["type"];
  artboardId: string;
  parentId: string | null;
  semanticRole?: string;
  frame: { x: number; y: number; width: number; height: number };
  localFrame: { x: number; y: number; width: number; height: number };
  computedStyle: Record<string, string | number | boolean | undefined>;
  layout: BoardProject["elements"][number]["layout"];
  props: BoardProject["elements"][number]["props"];
  locked: boolean;
  visible: boolean;
  zIndex: number;
  childrenIds: string[];
}

export interface InspectedConnector {
  kind: "connector";
  id: string;
  fromArtboardId: string;
  toArtboardId: string;
  fromElementId?: string;
  toElementId?: string;
  label?: string;
}

export interface SelectionInspection {
  boardId: string;
  boardName: string;
  requestedSelection: string[];
  effectiveSelection: string[];
  nodes: Array<InspectedArtboard | InspectedElement | InspectedConnector>;
  validation: BoardValidationReport["summary"];
}

export interface SelectionHandoff {
  boardId: string;
  boardName: string;
  selectedIds: string[];
  artboards: {
    id: string;
    name: string;
    jsx: RenderedFile;
    pngPath?: string;
  }[];
  inspection: SelectionInspection;
  validation: BoardValidationReport["summary"];
}

export class BoardStore {
  // Cloud mode keeps history in memory (boards live remotely); local/mirror modes use the
  // disk-backed HistoryStore so undo/redo and the op-log survive restarts (decision D6).
  private undoStacks = new Map<string, BoardProject[]>();
  private redoStacks = new Map<string, BoardProject[]>();
  private selections = new Map<string, string[]>();
  private cloudUnavailableStatus: string | undefined;
  private readonly history: HistoryStore;

  constructor(
    private readonly root = defaultBoardRoot,
    private cloud: CloudStore | undefined = createCloudStoreFromEnv(),
    private readonly storageMode: StorageMode = storageModeFromEnv()
  ) {
    this.history = new HistoryStore(this.root);
  }

  async ensureReady(): Promise<void> {
    if (!this.isCloudPrimary()) {
      await fs.mkdir(this.root, { recursive: true });
    }
    if (this.storageMode === "local") {
      this.cloud = undefined;
      return;
    }
    if (!this.cloud && this.cloudUnavailableStatus) {
      this.cloud = createCloudStoreFromEnv();
    }
    if (!this.cloud) {
      if (this.isCloudPrimary()) {
        throw new Error("POWERBOARD_STORAGE_MODE=cloud requires SUPABASE_DB_URL.");
      }
      return;
    }
    try {
      await this.cloud.ensureReady();
      this.cloudUnavailableStatus = undefined;
    } catch (error) {
      if (this.isCloudPrimary()) {
        throw new Error(`PowerBoard cloud storage unavailable (${this.cloud.label}): ${error instanceof Error ? error.message : String(error)}`);
      }
      const label = this.cloud.label;
      this.cloud = undefined;
      this.cloudUnavailableStatus = "local-files (cloud unavailable)";
      console.warn(`PowerBoard cloud store disabled (${label}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async listBoards(): Promise<BoardSummary[]> {
    await this.ensureReady();
    if (this.isCloudPrimary()) {
      return this.requiredCloud().listBoards();
    }
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

  async createBoard(name = "PowerBoard Starter Board", template: BoardTemplate = "starter"): Promise<BoardProject> {
    await this.ensureReady();
    const project = createDefaultProject(name, template);
    const existing = (!this.isCloudPrimary() && (await this.exists(project.id))) || Boolean(await this.cloud?.readBoard(project.id));
    const id = existing ? createId("board") : project.id;
    const finalProject = BoardProjectSchema.parse({ ...project, id, name });
    await this.writeBoard(finalProject);
    return finalProject;
  }

  /**
   * Rename a whole board project (metadata only). Application-level lifecycle action — bumps
   * updatedAt and persists through the normal write path (local + cloud mirror). Not an in-board
   * element operation, so it is deliberately not on the undo stack. Throws if the board is missing.
   */
  async renameBoard(boardId: string, name: string): Promise<BoardProject> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("name is required.");
    }
    const project = await this.readBoard(boardId);
    const next = BoardProjectSchema.parse({
      ...project,
      name: trimmed,
      metadata: { ...project.metadata, updatedAt: new Date().toISOString() }
    });
    return this.writeBoard(next);
  }

  async readBoard(boardId: string): Promise<BoardProject> {
    if (this.isCloudPrimary()) {
      await this.ensureReady();
      const cloudProject = await this.requiredCloud().readBoard(boardId);
      if (!cloudProject) {
        throw new Error(`Board not found: ${boardId}`);
      }
      const project = sanitizeProjectSelection(cloudProject);
      this.selections.set(project.id, project.selection);
      return project;
    }
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
      const project = sanitizeProjectSelection(cloudProject);
      await this.writeLocalBoard(project);
      return project;
    }
  }

  async writeBoard(project: BoardProject): Promise<BoardProject> {
    const valid = sanitizeProjectSelection(validateBoardProject(project));
    if (this.isCloudPrimary()) {
      await this.ensureReady();
      await this.requiredCloud().writeBoard(valid);
      this.selections.set(valid.id, valid.selection);
      return valid;
    }
    await this.writeLocalBoard(valid);
    if (this.shouldMirrorToCloud()) {
      await this.cloud?.writeBoard(valid);
    }
    return valid;
  }

  /**
   * Permanently delete a board and everything under it (JSON, assets, exports, history). Lifecycle
   * action — not an in-board operation, so it is not undoable. Returns false if the board did not
   * exist (route surfaces that as 404). Backup snapshots are intentionally left on disk as a safety net.
   */
  async deleteBoard(boardId: string): Promise<boolean> {
    await this.ensureReady();
    if (this.isCloudPrimary()) {
      const found = await this.requiredCloud().deleteBoard(boardId);
      this.forgetBoardState(boardId);
      return found;
    }
    const existedLocally = await this.exists(boardId);
    // Mirror mode: remove the cloud copy first so a cloud failure aborts before we touch local files.
    let existedInCloud = false;
    if (this.cloud) {
      existedInCloud = await this.cloud.deleteBoard(boardId);
    }
    if (existedLocally) {
      await fs.rm(this.boardDir(boardId), { recursive: true, force: true });
    }
    this.forgetBoardState(boardId);
    await this.history.drop(boardId);
    return existedLocally || existedInCloud;
  }

  private forgetBoardState(boardId: string): void {
    this.undoStacks.delete(boardId);
    this.redoStacks.delete(boardId);
    this.selections.delete(boardId);
  }

  async readStoredFile(boardId: string, relativePath: string): Promise<CloudFileRecord | undefined> {
    return this.cloud?.readFile(boardId, relativePath);
  }

  /**
   * Application-level file view for one board: where its JSON lives, the assets it references, and
   * the exports generated for it. Pairs with listBoards() so an agent can see everything PowerBoard
   * stores, not just the in-board object model. In cloud-primary mode paths are cloud:// URIs and
   * export listing is deferred (cloud exports are addressed on demand).
   */
  async listBoardFiles(boardId: string): Promise<BoardFileListing> {
    const project = await this.readBoard(boardId);
    const assets = project.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      size: asset.size,
      src: asset.src
    }));
    if (this.isCloudPrimary()) {
      return {
        boardId,
        name: project.name,
        storageMode: this.storageMode,
        location: `cloud://${boardId}/board.json`,
        assets,
        exports: []
      };
    }
    const exportsDir = ensureInsideRoot(this.root, path.join(this.boardDir(boardId), "exports"));
    let exports: BoardFileListing["exports"] = [];
    try {
      const entries = await fs.readdir(exportsDir, { withFileTypes: true });
      exports = await Promise.all(
        entries
          .filter((entry) => entry.isFile())
          .map(async (entry) => {
            const filePath = path.join(exportsDir, entry.name);
            const stat = await fs.stat(filePath);
            return { fileName: entry.name, path: filePath, size: stat.size };
          })
      );
    } catch {
      // No exports folder yet — the board simply has no generated files.
    }
    return {
      boardId,
      name: project.name,
      storageMode: this.storageMode,
      location: this.boardFilePath(boardId),
      assets,
      exports
    };
  }

  cloudStatus(): string {
    return this.cloud?.label ?? this.cloudUnavailableStatus ?? "local-files";
  }

  storageModeStatus(): StorageMode {
    return this.storageMode;
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

  async applyOperation(boardId: string, operation: BoardOperation, options: ApplyOperationOptions = {}): Promise<BoardProject> {
    const current = await this.readBoard(boardId);
    let next = applyBoardOperation(current, operation);
    if (options.source === "agent") {
      next = markAgentEdited(next, operation, options.actor);
    }
    await this.pushUndoState(boardId, current);
    await this.clearRedoState(boardId);
    const written = await this.writeBoard(next);
    await this.logOperation(boardId, {
      at: written.metadata.updatedAt,
      source: options.source ?? "user",
      actor: options.actor,
      type: operation.type,
      targetIds: targetIdsForOperation(operation, written)
    });
    return written;
  }

  /**
   * Atomic batch: every operation validates and applies against a draft; only if ALL
   * succeed is the result written (one undo entry). Conflict detection via expectedUpdatedAt.
   */
  async applyOperations(
    boardId: string,
    operations: BoardOperation[],
    options: ApplyOperationOptions & { expectedUpdatedAt?: string } = {}
  ): Promise<{ project: BoardProject; applied: number }> {
    const current = await this.readBoard(boardId);
    if (options.expectedUpdatedAt && options.expectedUpdatedAt !== current.metadata.updatedAt) {
      throw new Error(
        `Conflict: board changed since you read it (expected updatedAt ${options.expectedUpdatedAt}, actual ${current.metadata.updatedAt}). Re-read the board and retry.`
      );
    }
    let draft = current;
    for (let index = 0; index < operations.length; index++) {
      try {
        draft = applyBoardOperation(draft, operations[index]!);
      } catch (error) {
        throw new Error(`Batch aborted, nothing was written. operations[${index}] (${operations[index]!.type}) failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (options.source === "agent") {
      draft = markAgentEdited(draft, operations[operations.length - 1]!, options.actor);
    }
    await this.pushUndoState(boardId, current);
    await this.clearRedoState(boardId);
    const written = await this.writeBoard(draft);
    for (const operation of operations) {
      await this.logOperation(boardId, {
        at: written.metadata.updatedAt,
        source: options.source ?? "user",
        actor: options.actor,
        type: operation.type,
        targetIds: targetIdsForOperation(operation, written)
      });
    }
    return { project: written, applied: operations.length };
  }

  async replaceBoard(boardId: string, project: BoardProject, options: ApplyOperationOptions = {}): Promise<BoardProject> {
    if (boardId !== project.id) {
      throw new Error("Board id in URL and body must match.");
    }
    const current = await this.readBoard(boardId).catch(() => undefined);
    if (current) await this.pushUndoState(boardId, current);
    await this.clearRedoState(boardId);
    const written = await this.writeBoard(project);
    await this.logOperation(boardId, {
      at: written.metadata.updatedAt,
      source: options.source ?? "user",
      actor: options.actor,
      type: "replace_board",
      targetIds: [boardId]
    });
    return written;
  }

  async undo(boardId: string): Promise<BoardProject> {
    const previous = await this.popUndoState(boardId);
    if (!previous) {
      return this.readBoard(boardId);
    }
    const current = await this.readBoard(boardId);
    await this.pushRedoState(boardId, current);
    return this.writeBoard(previous);
  }

  async redo(boardId: string): Promise<BoardProject> {
    const next = await this.popRedoState(boardId);
    if (!next) {
      return this.readBoard(boardId);
    }
    const current = await this.readBoard(boardId);
    await this.pushUndoState(boardId, current);
    return this.writeBoard(next);
  }

  async historyDepths(boardId: string): Promise<{ undo: number; redo: number }> {
    if (this.isCloudPrimary()) {
      return { undo: (this.undoStacks.get(boardId) ?? []).length, redo: (this.redoStacks.get(boardId) ?? []).length };
    }
    return this.history.depths(boardId);
  }

  async readOpLog(boardId: string, limit = 100): Promise<OpLogEntry[]> {
    if (this.isCloudPrimary()) return [];
    return this.history.readOpLog(boardId, limit);
  }

  getSelection(boardId: string): string[] {
    return this.selections.get(boardId) ?? [];
  }

  async setSelection(boardId: string, selection: string[]): Promise<BoardProject> {
    const project = await this.readBoard(boardId);
    const next = BoardProjectSchema.parse({ ...project, selection: filterValidSelection(project, selection), metadata: { ...project.metadata, updatedAt: new Date().toISOString() } });
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
    if (!this.isCloudPrimary()) {
      const dir = ensureInsideRoot(this.root, path.join(this.boardDir(boardId), "assets"));
      await fs.mkdir(dir, { recursive: true });
      const filePath = ensureInsideRoot(dir, path.join(dir, fileName));
      await fs.writeFile(filePath, buffer);
    }
    const cloud = this.isCloudPrimary() ? this.requiredCloud() : this.cloud;
    await cloud?.writeBoard(project);
    await cloud?.writeFile({
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
    const markdown = renderSpecMarkdown(project);
    const markdownPath = this.isCloudPrimary() ? `cloud://${boardId}/exports/implementation-spec.md` : path.join(await this.ensureExportDir(boardId), "implementation-spec.md");
    const jsonPath = this.isCloudPrimary() ? `cloud://${boardId}/exports/board-summary.json` : path.join(path.dirname(markdownPath), "board-summary.json");
    if (!this.isCloudPrimary()) {
      await fs.writeFile(markdownPath, markdown, "utf8");
      await fs.writeFile(jsonPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
    }
    const cloud = this.isCloudPrimary() ? this.requiredCloud() : this.cloud;
    await cloud?.writeBoard(project);
    await cloud?.writeFile({
      boardId,
      path: "exports/implementation-spec.md",
      kind: "export",
      contentType: "text/markdown; charset=utf-8",
      data: Buffer.from(markdown, "utf8")
    });
    await cloud?.writeFile({
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
    const cloud = this.isCloudPrimary() ? this.requiredCloud() : this.cloud;
    await cloud?.writeBoard(project);
    const exportResult = renderReactTailwind(project);
    const dir = this.isCloudPrimary() ? `cloud://${boardId}/exports/react-tailwind` : path.join(await this.ensureExportDir(boardId), "react-tailwind");
    if (!this.isCloudPrimary()) {
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
    }
    for (const file of exportResult.files) {
      if (!this.isCloudPrimary()) {
        const target = ensureInsideRoot(dir, path.join(dir, file.path));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, file.contents, "utf8");
      }
      await cloud?.writeFile({
        boardId,
        path: `exports/react-tailwind/${file.path}`,
        kind: "export",
        contentType: contentTypeForFile(file.path),
        data: Buffer.from(file.contents, "utf8")
      });
    }
    return { dir, files: exportResult.files, summary: exportResult.summary };
  }

  async exportArtboardPng(boardId: string, artboardId: string, options: { scale?: number } = {}): Promise<{ filePath: string; width: number; height: number; scale: number }> {
    const project = await this.readBoard(boardId);
    const cloud = this.isCloudPrimary() ? this.requiredCloud() : this.cloud;
    await cloud?.writeBoard(project);
    const artboard = project.artboards.find((candidate) => candidate.id === artboardId);
    if (!artboard) {
      throw new Error(`Artboard not found: ${artboardId}`);
    }
    // 2x by default: an artboard rasterized 1:1 is screen-resolution, and the usual reason to ask
    // for a PNG is to print or paste it into a deck. Capped so a big poster can't exhaust memory.
    const scale = Math.min(Math.max(options.scale ?? 2, 1), 4);
    const width = Math.round(artboard.width * scale);
    const height = Math.round(artboard.height * scale);
    const svg = renderArtboardSvg(project, artboardId);
    const fileName = `${safeSegment(artboard.name)}.png`;
    const dir = this.isCloudPrimary() ? `cloud://${boardId}/exports` : await this.ensureExportDir(boardId);
    const filePath = this.isCloudPrimary() ? `${dir}/${fileName}` : path.join(dir, fileName);
    const png = await sharp(Buffer.from(svg), { density: Math.round(72 * scale) }).resize(width, height).png().toBuffer();
    if (!this.isCloudPrimary()) {
      await fs.writeFile(filePath, png);
    }
    await cloud?.writeFile({
      boardId,
      path: `exports/${fileName}`,
      kind: "export",
      contentType: "image/png",
      data: png,
      metadata: { artboardId }
    });
    return { filePath, width, height, scale };
  }

  async exportPageSvg(boardId: string, pageId?: string): Promise<{ filePath: string; svg: string }> {
    const project = await this.readBoard(boardId);
    const svg = renderPageSvg(project, pageId);
    const fileName = `${safeSegment(project.pages.find((page) => page.id === pageId)?.name ?? "page")}.svg`;
    const filePath = this.isCloudPrimary() ? `cloud://${boardId}/exports/${fileName}` : path.join(await this.ensureExportDir(boardId), fileName);
    if (!this.isCloudPrimary()) {
      await fs.writeFile(filePath, svg, "utf8");
    }
    await this.cloudExportWrite(boardId, `exports/${fileName}`, "image/svg+xml", Buffer.from(svg, "utf8"));
    return { filePath, svg };
  }

  async exportPagePdf(boardId: string, pageId?: string): Promise<{ filePath: string }> {
    const project = await this.readBoard(boardId);
    const svg = renderPageSvg(project, pageId);
    const image = sharp(Buffer.from(svg));
    const { width, height } = await image.metadata();
    const jpeg = await image.flatten({ background: "#F1F5F9" }).jpeg({ quality: 92 }).toBuffer();
    const pdf = jpegToPdf(jpeg, width ?? 1200, height ?? 800);
    const fileName = `${safeSegment(project.pages.find((page) => page.id === pageId)?.name ?? "page")}.pdf`;
    const filePath = this.isCloudPrimary() ? `cloud://${boardId}/exports/${fileName}` : path.join(await this.ensureExportDir(boardId), fileName);
    if (!this.isCloudPrimary()) {
      await fs.writeFile(filePath, pdf);
    }
    await this.cloudExportWrite(boardId, `exports/${fileName}`, "application/pdf", pdf);
    return { filePath };
  }

  async exportMermaid(boardId: string): Promise<{ filePath: string; mermaid: string }> {
    const project = await this.readBoard(boardId);
    const mermaid = renderMermaid(project);
    const filePath = this.isCloudPrimary() ? `cloud://${boardId}/exports/diagram.mmd` : path.join(await this.ensureExportDir(boardId), "diagram.mmd");
    if (!this.isCloudPrimary()) {
      await fs.writeFile(filePath, mermaid, "utf8");
    }
    await this.cloudExportWrite(boardId, "exports/diagram.mmd", "text/plain; charset=utf-8", Buffer.from(mermaid, "utf8"));
    return { filePath, mermaid };
  }

  private async cloudExportWrite(boardId: string, relativePath: string, contentType: string, data: Buffer): Promise<void> {
    const cloud = this.isCloudPrimary() ? this.requiredCloud() : this.cloud;
    if (!cloud) return;
    await cloud.writeFile({ boardId, path: relativePath, kind: "export", contentType, data });
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

  async validateBoard(boardId: string): Promise<BoardValidationReport> {
    return validateBoardStructure(await this.readBoard(boardId));
  }

  async inspectBoardHierarchy(boardId: string): Promise<{ id: string; name: string; hierarchy: BoardHierarchyArtboard[] }> {
    const project = await this.readBoard(boardId);
    return { id: project.id, name: project.name, hierarchy: inspectBoardHierarchy(project) };
  }

  async previewOperation(boardId: string, operation: BoardOperation) {
    const current = await this.readBoard(boardId);
    const next = applyBoardOperation(current, operation);
    const validation = validateBoardStructure(next);
    return {
      boardId,
      operationType: operation.type,
      targetIds: targetIdsForOperation(operation, next),
      before: projectCounts(current),
      after: projectCounts(next),
      validation
    };
  }

  async inspectSelection(boardId: string, selection?: string[]): Promise<SelectionInspection> {
    const project = await this.readBoard(boardId);
    const currentSelection = selection ?? this.getSelection(boardId);
    const requestedSelection = currentSelection.length ? currentSelection : project.selection;
    const effectiveSelection = resolveSelection(project, requestedSelection);
    const pathByElementId = elementPathMap(project);
    const nodes = effectiveSelection.map((id) => inspectSelectionNode(project, id, pathByElementId)).filter((node): node is InspectedArtboard | InspectedElement | InspectedConnector => Boolean(node));
    return {
      boardId: project.id,
      boardName: project.name,
      requestedSelection,
      effectiveSelection,
      nodes,
      validation: validateBoardStructure(project).summary
    };
  }

  async exportSelectionHandoff(boardId: string, selection?: string[], options: { includePng?: boolean } = {}): Promise<SelectionHandoff> {
    const project = await this.readBoard(boardId);
    const inspection = await this.inspectSelection(boardId, selection);
    const artboards = resolveHandoffArtboards(project, inspection.effectiveSelection);
    if (!artboards.length) {
      throw new Error("Select at least one artboard or element, or pass selection ids, before exporting a selection handoff.");
    }
    const handoffArtboards = [];
    for (const artboard of artboards) {
      const jsx = renderArtboardReactTailwind(project, artboard.id);
      const png = options.includePng ? await this.exportArtboardPng(boardId, artboard.id) : undefined;
      handoffArtboards.push({
        id: artboard.id,
        name: artboard.name,
        jsx,
        pngPath: png?.filePath
      });
    }
    return {
      boardId: project.id,
      boardName: project.name,
      selectedIds: inspection.effectiveSelection,
      artboards: handoffArtboards,
      inspection,
      validation: validateBoardStructure(project).summary
    };
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

  private async pushUndoState(boardId: string, project: BoardProject): Promise<void> {
    if (this.isCloudPrimary()) {
      const stack = this.undoStacks.get(boardId) ?? [];
      stack.push(project);
      this.undoStacks.set(boardId, stack.slice(-50));
      return;
    }
    await this.history.pushUndo(boardId, project);
  }

  private async popUndoState(boardId: string): Promise<BoardProject | undefined> {
    if (this.isCloudPrimary()) {
      return (this.undoStacks.get(boardId) ?? []).pop();
    }
    return this.history.popUndo(boardId);
  }

  private async pushRedoState(boardId: string, project: BoardProject): Promise<void> {
    if (this.isCloudPrimary()) {
      const stack = this.redoStacks.get(boardId) ?? [];
      stack.push(project);
      this.redoStacks.set(boardId, stack.slice(-50));
      return;
    }
    await this.history.pushRedo(boardId, project);
  }

  private async popRedoState(boardId: string): Promise<BoardProject | undefined> {
    if (this.isCloudPrimary()) {
      return (this.redoStacks.get(boardId) ?? []).pop();
    }
    return this.history.popRedo(boardId);
  }

  private async clearRedoState(boardId: string): Promise<void> {
    if (this.isCloudPrimary()) {
      this.redoStacks.set(boardId, []);
      return;
    }
    await this.history.clearRedo(boardId);
  }

  private async logOperation(boardId: string, entry: Omit<OpLogEntry, "seq">): Promise<void> {
    if (this.isCloudPrimary()) return;
    try {
      await this.history.appendOpLog(boardId, entry);
    } catch (error) {
      // The board write already succeeded; a failed log line must not corrupt the edit,
      // but it must be visible.
      console.error(`PowerBoard op-log append failed for ${boardId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private isCloudPrimary(): boolean {
    return this.storageMode === "cloud";
  }

  private shouldMirrorToCloud(): boolean {
    return this.storageMode === "mirror";
  }

  private requiredCloud(): CloudStore {
    if (!this.cloud) {
      throw new Error("PowerBoard cloud storage is not configured.");
    }
    return this.cloud;
  }
}

function projectCounts(project: BoardProject) {
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.metadata.updatedAt,
    artboards: project.artboards.length,
    elements: project.elements.length,
    connectors: project.connectors.length,
    assets: project.assets.length
  };
}

function resolveSelection(project: BoardProject, selection: string[] = []): string[] {
  return filterValidSelection(project, selection.length ? selection : project.selection);
}

function inspectSelectionNode(project: BoardProject, id: string, pathByElementId: Map<string, string>): InspectedArtboard | InspectedElement | InspectedConnector | undefined {
  const artboard = project.artboards.find((candidate) => candidate.id === id);
  if (artboard) {
    return {
      kind: "artboard",
      id: artboard.id,
      name: artboard.name,
      path: artboard.name,
      type: artboard.type,
      frame: { x: artboard.x, y: artboard.y, width: artboard.width, height: artboard.height },
      background: artboard.background,
      locked: artboard.locked,
      visible: artboard.visible,
      childrenIds: project.elements.filter((element) => element.artboardId === artboard.id && !element.parentId).sort(byLayerOrder).map((element) => element.id)
    };
  }

  const element = project.elements.find((candidate) => candidate.id === id);
  if (element) {
    const absoluteFrame = absoluteElementFrame(project, element);
    return {
      kind: "element",
      id: element.id,
      name: element.name,
      path: pathByElementId.get(element.id) ?? element.name,
      type: element.type,
      artboardId: element.artboardId,
      parentId: element.parentId,
      semanticRole: element.semanticRole,
      frame: absoluteFrame,
      localFrame: { x: element.x, y: element.y, width: element.width, height: element.height },
      computedStyle: computedElementStyle(element, absoluteFrame),
      layout: element.layout,
      props: element.props,
      locked: element.locked,
      visible: element.visible,
      zIndex: element.zIndex,
      childrenIds: project.elements.filter((child) => child.parentId === element.id).sort(byLayerOrder).map((child) => child.id)
    };
  }

  const connector = project.connectors.find((candidate) => candidate.id === id);
  if (connector) {
    return {
      kind: "connector",
      id: connector.id,
      fromArtboardId: connector.fromArtboardId,
      toArtboardId: connector.toArtboardId,
      fromElementId: connector.fromElementId,
      toElementId: connector.toElementId,
      label: connector.label
    };
  }

  return undefined;
}

function resolveHandoffArtboards(project: BoardProject, selection: string[]): BoardProject["artboards"] {
  const seen = new Set<string>();
  const artboards: BoardProject["artboards"] = [];
  for (const id of selection) {
    const selectedArtboard = project.artboards.find((artboard) => artboard.id === id);
    const selectedElement = project.elements.find((element) => element.id === id);
    const artboardId = selectedArtboard?.id ?? selectedElement?.artboardId;
    if (!artboardId || seen.has(artboardId)) continue;
    const artboard = project.artboards.find((candidate) => candidate.id === artboardId);
    if (!artboard) continue;
    seen.add(artboardId);
    artboards.push(artboard);
  }
  return artboards;
}

function elementPathMap(project: BoardProject): Map<string, string> {
  const paths = new Map<string, string>();
  const visit = (node: BoardHierarchyArtboard["children"][number]) => {
    paths.set(node.id, node.path);
    for (const child of node.children) visit(child);
  };
  for (const artboard of inspectBoardHierarchy(project)) {
    for (const child of artboard.children) visit(child);
  }
  return paths;
}

function absoluteElementFrame(project: BoardProject, element: BoardProject["elements"][number]): { x: number; y: number; width: number; height: number } {
  let x = element.x;
  let y = element.y;
  let parentId = element.parentId;
  while (parentId) {
    const parent = project.elements.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    x += parent.x;
    y += parent.y;
    parentId = parent.parentId;
  }
  return { x, y, width: element.width, height: element.height };
}

function computedElementStyle(element: BoardProject["elements"][number], frame: { x: number; y: number; width: number; height: number }): Record<string, string | number | boolean | undefined> {
  const hierarchyOnly = (element.type === "frame" || element.type === "group") && element.props.hierarchyOnly === true;
  return {
    position: "absolute",
    left: px(frame.x),
    top: px(frame.y),
    width: px(frame.width),
    height: px(frame.height),
    display: element.layout.mode === "stack" ? "flex" : element.layout.mode === "grid" ? "grid" : "block",
    flexDirection: element.layout.mode === "stack" ? element.layout.direction ?? "column" : undefined,
    gridTemplateColumns: element.layout.mode === "grid" && element.layout.columns ? `repeat(${element.layout.columns}, minmax(0, 1fr))` : undefined,
    gap: pxOrUndefined(element.style.gap ?? element.layout.gap),
    padding: pxOrUndefined(element.style.padding ?? element.layout.padding),
    alignItems: cssAlign(element.style.align ?? element.layout.align),
    justifyContent: cssJustify(element.style.justify ?? element.layout.justify),
    background: hierarchyOnly ? "transparent" : element.style.fill,
    color: element.style.color,
    borderColor: hierarchyOnly ? undefined : element.style.stroke,
    borderWidth: hierarchyOnly ? undefined : pxOrUndefined(element.style.strokeWidth),
    borderRadius: hierarchyOnly ? undefined : pxOrUndefined(element.style.radius),
    opacity: element.style.opacity,
    boxShadow: hierarchyOnly ? undefined : element.style.shadow,
    fontFamily: element.style.fontFamily,
    fontSize: pxOrUndefined(element.style.fontSize),
    fontWeight: element.style.fontWeight,
    lineHeight: pxOrUndefined(element.style.lineHeight),
    letterSpacing: pxOrUndefined(element.style.letterSpacing),
    textAlign: element.style.textAlign,
    objectFit: element.style.imageFit,
    hiddenFromVisualExport: hierarchyOnly
  };
}

function byLayerOrder(a: BoardProject["elements"][number], b: BoardProject["elements"][number]): number {
  return a.zIndex - b.zIndex || a.y - b.y || a.x - b.x || a.name.localeCompare(b.name);
}

function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

function pxOrUndefined(value: number | undefined): string | undefined {
  return value === undefined ? undefined : px(value);
}

function cssAlign(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return ({ start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" } as Record<string, string>)[value] ?? undefined;
}

function cssJustify(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return ({ start: "flex-start", center: "center", end: "flex-end", between: "space-between" } as Record<string, string>)[value] ?? undefined;
}

export function agentActivityForOperation(project: BoardProject, operation: BoardOperation): AgentBoardActivity {
  const metadata = project.metadata as Record<string, unknown>;
  return {
    source: "agent",
    kind: "operation",
    ids: readStringArrayMetadata(metadata.lastAgentEditedIds) ?? targetIdsForOperation(operation, project),
    operationType: operation.type,
    at: readStringMetadata(metadata.lastAgentEditedAt) ?? project.metadata.updatedAt
  };
}

export function agentActivityForSelection(project: BoardProject): AgentBoardActivity {
  return {
    source: "agent",
    kind: "selection",
    ids: project.selection,
    at: new Date().toISOString()
  };
}

export function targetIdsForOperation(operation: BoardOperation, projectAfter?: BoardProject): string[] {
  switch (operation.type) {
    case "create_artboard":
      return [operation.artboard.id];
    case "update_artboard":
      return [operation.artboardId];
    case "create_variant":
      return operation.artboardId ? [operation.artboardId] : projectAfter?.selection ?? [operation.sourceArtboardId];
    case "add_element":
      return [operation.element.id];
    case "update_element":
    case "delete_element":
    case "move_resize_element":
      return [operation.elementId];
    case "group_elements":
      return [operation.group.id, ...operation.elementIds];
    case "add_connector":
      return [operation.connector.id];
    case "update_connector":
    case "delete_connector":
      return [operation.connectorId];
    case "delete_artboard":
      return [operation.artboardId];
    case "apply_layout":
      return operation.elementIds ?? projectAfter?.selection ?? [];
    case "set_selection":
      return operation.selection;
    default:
      return [];
  }
}

function markAgentEdited(project: BoardProject, operation: BoardOperation, actor = "PowerBoard MCP"): BoardProject {
  const ids = targetIdsForOperation(operation, project);
  return BoardProjectSchema.parse({
    ...project,
    metadata: {
      ...project.metadata,
      lastAgentEditedAt: project.metadata.updatedAt,
      lastAgentEditedBy: actor,
      lastAgentEditedOperation: operation.type,
      lastAgentEditedIds: ids
    }
  });
}

function readStringMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readStringArrayMetadata(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return strings.length ? strings : undefined;
}

function storageModeFromEnv(): StorageMode {
  const value = process.env.POWERBOARD_STORAGE_MODE?.trim().toLowerCase();
  if (!value) return "mirror";
  if (value === "cloud" || value === "cloud-only" || value === "direct") return "cloud";
  if (value === "mirror" || value === "local") return value;
  throw new Error(`Unsupported POWERBOARD_STORAGE_MODE: ${value}`);
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
