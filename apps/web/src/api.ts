import { applyBoardOperation, createDefaultProject, createId, validateBoardProject, type BoardAsset, type BoardOperation, type BoardProject, type BoardTemplate } from "@powerboard/schema";

const API_BASE = "";
const LOCAL_STORAGE_KEY = "powerboard.boards.v1";
const LEGACY_LOCAL_STORAGE_KEYS = ["paper-design-danny.boards.v1"];
const ENABLE_BROWSER_LOCAL_FALLBACK = import.meta.env.VITE_POWERBOARD_BROWSER_LOCAL === "1";
const localUndoStacks = new Map<string, BoardProject[]>();
const localRedoStacks = new Map<string, BoardProject[]>();

export interface BoardSummary {
  id: string;
  name: string;
  updatedAt: string;
  artboardCount: number;
  elementCount: number;
}

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

export interface ApiHealth {
  ok: boolean;
  name: string;
  boardRoot?: string;
  cloudStore: string;
  storageMode?: string;
  backup?: BackupStatus;
}

export async function getHealth(): Promise<ApiHealth> {
  try {
    return await request("/api/health");
  } catch (error) {
    if (!shouldUseLocalFallback(error)) throw error;
    return { ok: true, name: "PowerBoard", cloudStore: "browser-local", storageMode: "browser-local" };
  }
}

export async function listBoards(): Promise<BoardSummary[]> {
  return withLocalFallback(() => request("/api/boards"), () => localListBoards());
}

export async function createBoard(name?: string, template?: BoardTemplate): Promise<BoardProject> {
  return withLocalFallback(
    () => request("/api/boards", { method: "POST", body: JSON.stringify({ name, template }) }),
    () => localCreateBoard(name, template)
  );
}

export async function readBoard(boardId: string): Promise<BoardProject> {
  return withLocalFallback(() => request(`/api/boards/${boardId}`), () => localReadBoard(boardId));
}

export async function saveBoard(project: BoardProject): Promise<BoardProject> {
  return withLocalFallback(() => request(`/api/boards/${project.id}`, { method: "PUT", body: JSON.stringify(project) }), () => localSaveBoard(project));
}

export async function deleteBoard(boardId: string): Promise<void> {
  await withLocalFallback(
    async () => {
      await request<{ ok: boolean; boardId: string }>(`/api/boards/${boardId}`, { method: "DELETE" });
    },
    () => localDeleteBoard(boardId)
  );
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

export async function exportPageSvg(boardId: string, pageId?: string): Promise<{ filePath: string; svg: string }> {
  return request(`/api/boards/${boardId}/export/svg`, { method: "POST", body: JSON.stringify({ pageId }) });
}

export async function exportPagePdf(boardId: string, pageId?: string): Promise<{ filePath: string }> {
  return request(`/api/boards/${boardId}/export/pdf`, { method: "POST", body: JSON.stringify({ pageId }) });
}

export async function exportMermaid(boardId: string): Promise<{ filePath: string; mermaid: string }> {
  return request(`/api/boards/${boardId}/export/mermaid`, { method: "POST" });
}

export async function listBackups(boardId: string): Promise<BackupEntry[]> {
  return request(`/api/boards/${boardId}/backups`);
}

export async function restoreBackup(boardId: string, file: string): Promise<BoardProject> {
  return request(`/api/boards/${boardId}/restore`, { method: "POST", body: JSON.stringify({ file }) });
}

export async function backupNow(): Promise<{ backedUp: string[]; failed: { boardId: string; error: string }[] }> {
  return request(`/api/backups/flush`, { method: "POST" });
}

async function withLocalFallback<T>(remote: () => Promise<T>, local: () => Promise<T> | T): Promise<T> {
  try {
    return await remote();
  } catch (error) {
    if (!shouldUseLocalFallback(error)) throw error;
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
  return ENABLE_BROWSER_LOCAL_FALLBACK && error instanceof ApiRequestError && error.canUseLocalFallback;
}

async function localListBoards(): Promise<BoardSummary[]> {
  return (await localProjects())
    .map((project) => ({
      id: project.id,
      name: project.name,
      updatedAt: project.metadata.updatedAt,
      artboardCount: project.artboards.length,
      elementCount: project.elements.length
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function localCreateBoard(name = "PowerBoard Starter Board", template: BoardTemplate = "starter"): Promise<BoardProject> {
  const projects = await localProjects();
  const base = createDefaultProject(name, template);
  const project = validateBoardProject({ ...base, id: projects.some((candidate) => candidate.id === base.id) ? createId("board") : base.id, name });
  await writeLocalProjects([project]);
  return project;
}

async function localReadBoard(boardId: string): Promise<BoardProject> {
  const project = (await localProjects()).find((candidate) => candidate.id === boardId);
  if (!project) throw new Error(`Board not found: ${boardId}`);
  return project;
}

async function localSaveBoard(project: BoardProject): Promise<BoardProject> {
  const valid = validateBoardProject(project);
  await writeLocalProjects([valid]);
  return valid;
}

async function localDeleteBoard(boardId: string): Promise<void> {
  try {
    const db = await openLocalDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(boardId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Local board delete failed."));
      tx.onabort = () => reject(tx.error ?? new Error("Local board delete was aborted."));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`PowerBoard: board delete FAILED in browser-local mode. ${message}`);
    throw new Error(`Board not deleted: ${message}`);
  }
}

async function localApplyOperation(boardId: string, operation: BoardOperation): Promise<BoardProject> {
  const current = await localReadBoard(boardId);
  const next = applyBoardOperation(current, operation);
  pushLocalUndo(boardId, current);
  localRedoStacks.set(boardId, []);
  return localSaveBoard(next);
}

async function localUndo(boardId: string): Promise<BoardProject> {
  const stack = localUndoStacks.get(boardId) ?? [];
  const previous = stack.pop();
  if (!previous) return localReadBoard(boardId);
  localUndoStacks.set(boardId, stack);
  const current = await localReadBoard(boardId);
  pushLocalRedo(boardId, current);
  return localSaveBoard(previous);
}

async function localRedo(boardId: string): Promise<BoardProject> {
  const stack = localRedoStacks.get(boardId) ?? [];
  const next = stack.pop();
  if (!next) return localReadBoard(boardId);
  localRedoStacks.set(boardId, stack);
  pushLocalUndo(boardId, await localReadBoard(boardId));
  return localSaveBoard(next);
}

async function localSetSelection(boardId: string, selection: string[]): Promise<{ selection: string[] }> {
  const project = await localReadBoard(boardId);
  await localSaveBoard({ ...project, selection, metadata: { ...project.metadata, updatedAt: new Date().toISOString() } });
  return { selection };
}

async function localUploadAsset(boardId: string, file: File, dataUrl: string): Promise<{ project: BoardProject; assetId: string }> {
  const project = await localReadBoard(boardId);
  const assetId = createId("asset");
  const asset: BoardAsset = {
    id: assetId,
    name: file.name,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    src: dataUrl
  };
  const next = await localSaveBoard({
    ...project,
    assets: [...project.assets, asset],
    metadata: { ...project.metadata, updatedAt: new Date().toISOString() }
  });
  return { project: next, assetId };
}

async function localExportSpec(boardId: string): Promise<{ markdownPath: string; jsonPath: string; markdown: string }> {
  const project = await localReadBoard(boardId);
  const markdown = `# ${project.name} Implementation Spec

Generated in browser-local mode.

- Artboards: ${project.artboards.length}
- Elements: ${project.elements.length}
- Connectors: ${project.connectors.length}
`;
  return { markdownPath: "browser-local://implementation-spec.md", jsonPath: "browser-local://board-summary.json", markdown };
}

async function localExportReactTailwind(boardId: string): Promise<{ dir: string; summary: string; files: { path: string; contents: string }[] }> {
  const project = await localReadBoard(boardId);
  return {
    dir: "browser-local://react-tailwind",
    summary: "Browser-local mode can preview boards. Run the local server for full React/Tailwind file export.",
    files: [{ path: "board-summary.json", contents: JSON.stringify(project, null, 2) }]
  };
}

// Browser-local persistence lives in IndexedDB (one record per board, keyed by id).
// localStorage is quota-cliffed (~5 MB, synchronous) and previously held every board —
// including base64 screenshot assets — in a single key; existing data migrates on first read.
const IDB_NAME = "powerboard.local";
const IDB_STORE = "projects";
let localDbPromise: Promise<IDBDatabase> | null = null;

function openLocalDb(): Promise<IDBDatabase> {
  if (!localDbPromise) {
    localDbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is unavailable in this browser."));
        return;
      }
      const request = indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(IDB_STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Failed to open the local board database."));
    });
    localDbPromise.catch(() => {
      localDbPromise = null;
    });
  }
  return localDbPromise;
}

async function localProjects(): Promise<BoardProject[]> {
  const stored = await readLocalProjects();
  if (stored.length > 0) return stored;
  const migrated = readLegacyLocalStorageProjects();
  if (migrated.length > 0) {
    await writeLocalProjects(migrated);
    clearLegacyLocalStorage();
    return migrated;
  }
  const project = createDefaultProject("PowerBoard App Mockups");
  await writeLocalProjects([project]);
  return [project];
}

async function readLocalProjects(): Promise<BoardProject[]> {
  const db = await openLocalDb();
  const rows = await new Promise<unknown[]>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const request = tx.objectStore(IDB_STORE).getAll();
    request.onsuccess = () => resolve(request.result as unknown[]);
    request.onerror = () => reject(request.error ?? new Error("Failed to read local boards."));
  });
  return rows.map((row) => validateBoardProject(row));
}

async function writeLocalProjects(projects: BoardProject[]): Promise<void> {
  try {
    const db = await openLocalDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      for (const project of projects) tx.objectStore(IDB_STORE).put(project);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Local board write failed."));
      tx.onabort = () => reject(tx.error ?? new Error("Local board write was aborted."));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`PowerBoard: board save FAILED in browser-local mode — your latest changes are NOT persisted. ${message}`);
    throw new Error(`Board not saved: ${message}`);
  }
}

function readLegacyLocalStorageProjects(): BoardProject[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  for (const key of [LOCAL_STORAGE_KEY, ...LEGACY_LOCAL_STORAGE_KEYS]) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      const projects = parsed.map((project) => validateBoardProject(project));
      if (projects.length > 0) {
        console.info(`PowerBoard: migrating ${projects.length} board(s) from localStorage ("${key}") to IndexedDB.`);
        return projects;
      }
    } catch (error) {
      console.error(`PowerBoard: could not migrate legacy localStorage boards from "${key}":`, error);
    }
  }
  return [];
}

function clearLegacyLocalStorage(): void {
  try {
    for (const key of [LOCAL_STORAGE_KEY, ...LEGACY_LOCAL_STORAGE_KEYS]) window.localStorage.removeItem(key);
  } catch (error) {
    console.warn("PowerBoard: legacy localStorage cleanup failed (data already migrated to IndexedDB):", error);
  }
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
