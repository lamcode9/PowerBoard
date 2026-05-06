import { applyBoardOperation, createDefaultProject, createId, validateBoardProject, type BoardAsset, type BoardOperation, type BoardProject } from "@powerboard/schema";

const API_BASE = "";
const LOCAL_STORAGE_KEY = "powerboard.boards.v1";
const LEGACY_LOCAL_STORAGE_KEYS = ["paper-design-danny.boards.v1"];
const localUndoStacks = new Map<string, BoardProject[]>();
const localRedoStacks = new Map<string, BoardProject[]>();
let apiUnavailable = false;

export interface BoardSummary {
  id: string;
  name: string;
  updatedAt: string;
  artboardCount: number;
  elementCount: number;
}

export interface ApiHealth {
  ok: boolean;
  name: string;
  boardRoot?: string;
  cloudStore: string;
}

export async function getHealth(): Promise<ApiHealth> {
  try {
    return await request("/api/health");
  } catch (error) {
    if (!shouldUseLocalFallback(error)) throw error;
    return { ok: true, name: "PowerBoard", cloudStore: "browser-local" };
  }
}

export async function listBoards(): Promise<BoardSummary[]> {
  return withLocalFallback(() => request("/api/boards"), () => localListBoards());
}

export async function createBoard(name?: string): Promise<BoardProject> {
  return withLocalFallback(() => request("/api/boards", { method: "POST", body: JSON.stringify({ name }) }), () => localCreateBoard(name));
}

export async function readBoard(boardId: string): Promise<BoardProject> {
  return withLocalFallback(() => request(`/api/boards/${boardId}`), () => localReadBoard(boardId));
}

export async function saveBoard(project: BoardProject): Promise<BoardProject> {
  return withLocalFallback(() => request(`/api/boards/${project.id}`, { method: "PUT", body: JSON.stringify(project) }), () => localSaveBoard(project));
}

export async function applyOperation(boardId: string, operation: BoardOperation): Promise<BoardProject> {
  return withLocalFallback(
    () =>
      request(`/api/boards/${boardId}/operations`, {
        method: "POST",
        body: JSON.stringify({ operation })
      }),
    () => localApplyOperation(boardId, operation)
  );
}

export async function undo(boardId: string): Promise<BoardProject> {
  return withLocalFallback(() => request(`/api/boards/${boardId}/undo`, { method: "POST" }), () => localUndo(boardId));
}

export async function redo(boardId: string): Promise<BoardProject> {
  return withLocalFallback(() => request(`/api/boards/${boardId}/redo`, { method: "POST" }), () => localRedo(boardId));
}

export async function setSelection(boardId: string, selection: string[]): Promise<{ selection: string[] }> {
  return withLocalFallback(
    () =>
      request(`/api/boards/${boardId}/selection`, {
        method: "POST",
        body: JSON.stringify({ selection })
      }),
    () => localSetSelection(boardId, selection)
  );
}

export async function uploadAsset(boardId: string, file: File): Promise<{ project: BoardProject; assetId: string }> {
  const dataUrl = await readFileAsDataUrl(file);
  return withLocalFallback(
    () =>
      request(`/api/boards/${boardId}/assets`, {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, dataUrl })
      }),
    () => localUploadAsset(boardId, file, dataUrl)
  );
}

export async function exportPng(boardId: string, artboardId: string): Promise<{ filePath: string }> {
  return withLocalFallback(
    () =>
      request(`/api/boards/${boardId}/export/png`, {
        method: "POST",
        body: JSON.stringify({ artboardId })
      }),
    async () => {
      await localReadBoard(boardId);
      return { filePath: `browser-local://PNG export requires the local server (${artboardId})` };
    }
  );
}

export async function exportSpec(boardId: string): Promise<{ markdownPath: string; jsonPath: string; markdown: string }> {
  return withLocalFallback(() => request(`/api/boards/${boardId}/export/spec`, { method: "POST" }), () => localExportSpec(boardId));
}

export async function exportReactTailwind(boardId: string): Promise<{ dir: string; summary: string; files: { path: string; contents: string }[] }> {
  return withLocalFallback(() => request(`/api/boards/${boardId}/export/react-tailwind`, { method: "POST" }), () => localExportReactTailwind(boardId));
}

async function withLocalFallback<T>(remote: () => Promise<T>, local: () => Promise<T> | T): Promise<T> {
  if (apiUnavailable) return local();
  try {
    return await remote();
  } catch (error) {
    if (!shouldUseLocalFallback(error)) throw error;
    apiUnavailable = true;
    return local();
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {})
      }
    });
  } catch (error) {
    throw new ApiRequestError(error instanceof Error ? error.message : "API unavailable", 0, true);
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiRequestError(payload.error ?? `Request failed: ${response.status}`, response.status, [404, 405, 502, 503, 504].includes(response.status));
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiRequestError("Local API is not available in this deployment.", response.status, true);
  }
  return response.json() as Promise<T>;
}

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly canUseLocalFallback: boolean
  ) {
    super(message);
  }
}

function shouldUseLocalFallback(error: unknown): boolean {
  return error instanceof ApiRequestError && error.canUseLocalFallback;
}

function localListBoards(): BoardSummary[] {
  return localProjects()
    .map((project) => ({
      id: project.id,
      name: project.name,
      updatedAt: project.metadata.updatedAt,
      artboardCount: project.artboards.length,
      elementCount: project.elements.length
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function localCreateBoard(name = "PowerBoard Starter Board"): BoardProject {
  const projects = localProjects();
  const base = createDefaultProject(name);
  const project = validateBoardProject({ ...base, id: projects.some((candidate) => candidate.id === base.id) ? createId("board") : base.id, name });
  writeLocalProjects([...projects, project]);
  return project;
}

function localReadBoard(boardId: string): BoardProject {
  const project = localProjects().find((candidate) => candidate.id === boardId);
  if (!project) throw new Error(`Board not found: ${boardId}`);
  return project;
}

function localSaveBoard(project: BoardProject): BoardProject {
  const valid = validateBoardProject(project);
  const projects = localProjects().filter((candidate) => candidate.id !== valid.id);
  writeLocalProjects([...projects, valid]);
  return valid;
}

function localApplyOperation(boardId: string, operation: BoardOperation): BoardProject {
  const current = localReadBoard(boardId);
  const next = applyBoardOperation(current, operation);
  pushLocalUndo(boardId, current);
  localRedoStacks.set(boardId, []);
  return localSaveBoard(next);
}

function localUndo(boardId: string): BoardProject {
  const stack = localUndoStacks.get(boardId) ?? [];
  const previous = stack.pop();
  if (!previous) return localReadBoard(boardId);
  localUndoStacks.set(boardId, stack);
  const current = localReadBoard(boardId);
  pushLocalRedo(boardId, current);
  return localSaveBoard(previous);
}

function localRedo(boardId: string): BoardProject {
  const stack = localRedoStacks.get(boardId) ?? [];
  const next = stack.pop();
  if (!next) return localReadBoard(boardId);
  localRedoStacks.set(boardId, stack);
  pushLocalUndo(boardId, localReadBoard(boardId));
  return localSaveBoard(next);
}

function localSetSelection(boardId: string, selection: string[]): { selection: string[] } {
  const project = localReadBoard(boardId);
  localSaveBoard({ ...project, selection, metadata: { ...project.metadata, updatedAt: new Date().toISOString() } });
  return { selection };
}

function localUploadAsset(boardId: string, file: File, dataUrl: string): { project: BoardProject; assetId: string } {
  const project = localReadBoard(boardId);
  const assetId = createId("asset");
  const asset: BoardAsset = {
    id: assetId,
    name: file.name,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    src: dataUrl
  };
  const next = localSaveBoard({
    ...project,
    assets: [...project.assets, asset],
    metadata: { ...project.metadata, updatedAt: new Date().toISOString() }
  });
  return { project: next, assetId };
}

function localExportSpec(boardId: string): { markdownPath: string; jsonPath: string; markdown: string } {
  const project = localReadBoard(boardId);
  const markdown = `# ${project.name} Implementation Spec

Generated in browser-local mode.

- Artboards: ${project.artboards.length}
- Elements: ${project.elements.length}
- Connectors: ${project.connectors.length}
`;
  return { markdownPath: "browser-local://implementation-spec.md", jsonPath: "browser-local://board-summary.json", markdown };
}

function localExportReactTailwind(boardId: string): { dir: string; summary: string; files: { path: string; contents: string }[] } {
  const project = localReadBoard(boardId);
  return {
    dir: "browser-local://react-tailwind",
    summary: "Browser-local mode can preview boards. Run the local server for full React/Tailwind file export.",
    files: [{ path: "board-summary.json", contents: JSON.stringify(project, null, 2) }]
  };
}

function localProjects(): BoardProject[] {
  if (!hasLocalStorage()) return [createDefaultProject("PowerBoard App Mockups")];
  const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!raw) {
    const legacyProjects = readLegacyLocalProjects();
    if (legacyProjects.length > 0) {
      writeLocalProjects(legacyProjects);
      return legacyProjects;
    }
    const project = createDefaultProject("PowerBoard App Mockups");
    writeLocalProjects([project]);
    return [project];
  }
  return parseLocalProjects(raw);
}

function readLegacyLocalProjects(): BoardProject[] {
  if (!hasLocalStorage()) return [];
  for (const key of LEGACY_LOCAL_STORAGE_KEYS) {
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    const projects = parseLocalProjects(raw);
    if (projects.length > 0) return projects;
  }
  return [];
}

function parseLocalProjects(raw: string): BoardProject[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((project) => validateBoardProject(project));
}

function writeLocalProjects(projects: BoardProject[]): void {
  if (!hasLocalStorage()) return;
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(projects, null, 2));
}

function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function pushLocalUndo(boardId: string, project: BoardProject): void {
  const stack = localUndoStacks.get(boardId) ?? [];
  stack.push(project);
  localUndoStacks.set(boardId, stack.slice(-50));
}

function pushLocalRedo(boardId: string, project: BoardProject): void {
  const stack = localRedoStacks.get(boardId) ?? [];
  stack.push(project);
  localRedoStacks.set(boardId, stack.slice(-50));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
