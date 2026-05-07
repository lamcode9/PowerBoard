import fs from "node:fs/promises";
import path from "node:path";
import { applyBoardOperation, BoardOperation, BoardProject, BoardProjectSchema, createDefaultProject, createId, filterValidSelection, sanitizeProjectSelection, validateBoardProject } from "@powerboard/schema";
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

export class BoardStore {
  private undoStacks = new Map<string, BoardProject[]>();
  private redoStacks = new Map<string, BoardProject[]>();
  private selections = new Map<string, string[]>();
  private cloudUnavailableStatus: string | undefined;

  constructor(
    private readonly root = defaultBoardRoot,
    private cloud: CloudStore | undefined = createCloudStoreFromEnv(),
    private readonly storageMode: StorageMode = storageModeFromEnv()
  ) {}

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

  async createBoard(name = "PowerBoard Starter Board"): Promise<BoardProject> {
    await this.ensureReady();
    const project = createDefaultProject(name);
    const existing = (!this.isCloudPrimary() && (await this.exists(project.id))) || Boolean(await this.cloud?.readBoard(project.id));
    const id = existing ? createId("board") : project.id;
    const finalProject = BoardProjectSchema.parse({ ...project, id, name });
    await this.writeBoard(finalProject);
    return finalProject;
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

  async readStoredFile(boardId: string, relativePath: string): Promise<CloudFileRecord | undefined> {
    return this.cloud?.readFile(boardId, relativePath);
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

  async exportArtboardPng(boardId: string, artboardId: string): Promise<{ filePath: string }> {
    const project = await this.readBoard(boardId);
    const cloud = this.isCloudPrimary() ? this.requiredCloud() : this.cloud;
    await cloud?.writeBoard(project);
    const artboard = project.artboards.find((candidate) => candidate.id === artboardId);
    if (!artboard) {
      throw new Error(`Artboard not found: ${artboardId}`);
    }
    const svg = renderArtboardSvg(project, artboardId);
    const fileName = `${safeSegment(artboard.name)}.png`;
    const dir = this.isCloudPrimary() ? `cloud://${boardId}/exports` : await this.ensureExportDir(boardId);
    const filePath = this.isCloudPrimary() ? `${dir}/${fileName}` : path.join(dir, fileName);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
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
