import type { BoardOperation, BoardProject } from "@board/schema";

const API_BASE = "";

export interface BoardSummary {
  id: string;
  name: string;
  updatedAt: string;
  artboardCount: number;
  elementCount: number;
}

export async function listBoards(): Promise<BoardSummary[]> {
  return request("/api/boards");
}

export async function createBoard(name?: string): Promise<BoardProject> {
  return request("/api/boards", { method: "POST", body: JSON.stringify({ name }) });
}

export async function readBoard(boardId: string): Promise<BoardProject> {
  return request(`/api/boards/${boardId}`);
}

export async function saveBoard(project: BoardProject): Promise<BoardProject> {
  return request(`/api/boards/${project.id}`, { method: "PUT", body: JSON.stringify(project) });
}

export async function applyOperation(boardId: string, operation: BoardOperation): Promise<BoardProject> {
  return request(`/api/boards/${boardId}/operations`, {
    method: "POST",
    body: JSON.stringify({ operation })
  });
}

export async function undo(boardId: string): Promise<BoardProject> {
  return request(`/api/boards/${boardId}/undo`, { method: "POST" });
}

export async function redo(boardId: string): Promise<BoardProject> {
  return request(`/api/boards/${boardId}/redo`, { method: "POST" });
}

export async function setSelection(boardId: string, selection: string[]): Promise<{ selection: string[] }> {
  return request(`/api/boards/${boardId}/selection`, {
    method: "POST",
    body: JSON.stringify({ selection })
  });
}

export async function uploadAsset(boardId: string, file: File): Promise<{ project: BoardProject; assetId: string }> {
  const dataUrl = await readFileAsDataUrl(file);
  return request(`/api/boards/${boardId}/assets`, {
    method: "POST",
    body: JSON.stringify({ fileName: file.name, dataUrl })
  });
}

export async function exportPng(boardId: string, artboardId: string): Promise<{ filePath: string }> {
  return request(`/api/boards/${boardId}/export/png`, {
    method: "POST",
    body: JSON.stringify({ artboardId })
  });
}

export async function exportSpec(boardId: string): Promise<{ markdownPath: string; jsonPath: string; markdown: string }> {
  return request(`/api/boards/${boardId}/export/spec`, { method: "POST" });
}

export async function exportReactTailwind(boardId: string): Promise<{ dir: string; summary: string; files: { path: string; contents: string }[] }> {
  return request(`/api/boards/${boardId}/export/react-tailwind`, { method: "POST" });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
