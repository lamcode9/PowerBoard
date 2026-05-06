import type { BoardOperation, BoardProject } from "@powerboard/schema";
import { BoardProjectSchema, OperationSchema } from "@powerboard/schema";
import { BoardStore } from "./boardService.js";
import { createCloudStoreFromEnv } from "./cloudStore.js";

type RequestLike = {
  method?: string;
  url?: string;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type JsonResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): JsonResponseLike;
  json(value: unknown): void;
  end(value?: string): void;
};

type FileResponseLike = JsonResponseLike & {
  send(value: Buffer): void;
};

const store = new BoardStore("/tmp/powerboard-boards", createCloudStoreFromEnv(), "cloud");

export const vercelApiConfig = {
  runtime: "nodejs",
  maxDuration: 30
};

export async function handlePowerBoardApi(req: RequestLike, res: JsonResponseLike) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    const segments = routeSegments(req);
    const method = req.method ?? "GET";

    if (method === "GET" && isRoute(segments, ["health"])) {
      await store.ensureReady();
      res.json({ ok: true, name: "PowerBoard", cloudStore: store.cloudStatus(), storageMode: store.storageModeStatus() });
      return;
    }

    if (method === "GET" && isRoute(segments, ["boards"])) {
      res.json(await store.listBoards());
      return;
    }

    if (method === "POST" && isRoute(segments, ["boards"])) {
      const body = readObjectBody(req);
      const project = await store.createBoard(typeof body.name === "string" ? body.name : undefined);
      res.status(201).json(project);
      return;
    }

    const [resource, boardId, action, subaction] = segments;
    if (resource !== "boards" || !boardId) {
      notFound(res);
      return;
    }

    if (method === "GET" && segments.length === 2) {
      res.json(await store.readBoard(boardId));
      return;
    }

    if (method === "PUT" && segments.length === 2) {
      const project = BoardProjectSchema.parse(readObjectBody(req)) as BoardProject;
      res.json(await store.replaceBoard(boardId, project));
      return;
    }

    if (method === "POST" && action === "operations") {
      const operation = OperationSchema.parse(readObjectBody(req).operation) as BoardOperation;
      res.json(await store.applyOperation(boardId, operation));
      return;
    }

    if (method === "POST" && action === "undo") {
      res.json(await store.undo(boardId));
      return;
    }

    if (method === "POST" && action === "redo") {
      res.json(await store.redo(boardId));
      return;
    }

    if (method === "POST" && action === "selection") {
      const body = readObjectBody(req);
      const selection = Array.isArray(body.selection) ? body.selection.filter((id): id is string => typeof id === "string") : [];
      await store.setSelection(boardId, selection);
      res.json({ selection });
      return;
    }

    if (method === "POST" && action === "assets") {
      const body = readObjectBody(req);
      if (typeof body.fileName !== "string" || typeof body.dataUrl !== "string") {
        res.status(400).json({ error: "fileName and dataUrl are required." });
        return;
      }
      res.status(201).json(await store.saveAsset(boardId, { fileName: body.fileName, dataUrl: body.dataUrl }));
      return;
    }

    if (method === "POST" && action === "export" && subaction === "png") {
      const body = readObjectBody(req);
      if (typeof body.artboardId !== "string") {
        res.status(400).json({ error: "artboardId is required." });
        return;
      }
      res.json(await store.exportArtboardPng(boardId, body.artboardId));
      return;
    }

    if (method === "POST" && action === "export" && subaction === "spec") {
      res.json(await store.exportSpec(boardId));
      return;
    }

    if (method === "POST" && action === "export" && subaction === "react-tailwind") {
      res.json(await store.exportReactTailwind(boardId));
      return;
    }

    notFound(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "PowerBoard API error";
    const status = message.includes("SUPABASE_DB_URL") || message.includes("cloud storage") ? 503 : 400;
    res.status(status).json({ error: message });
  }
}

export async function handlePowerBoardFile(req: RequestLike, res: FileResponseLike) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Use GET for board files." });
    return;
  }

  try {
    const boardId = readQuery(req.query.boardId);
    const folder = readQuery(req.query.folder);
    const filePath = readQuery(req.query.path);
    if (!boardId || !folder || !filePath) {
      res.status(400).json({ error: "boardId, folder, and path are required." });
      return;
    }

    const record = await store.readStoredFile(boardId, `${folder}/${filePath}`);
    if (!record) {
      res.status(404).json({ error: "File not found." });
      return;
    }

    res.setHeader("Content-Type", record.contentType);
    res.setHeader("Content-Length", String(record.sizeBytes));
    res.send(record.data);
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "PowerBoard file API error" });
  }
}

function pathSegments(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join("/") : value ?? "";
  return raw.split("/").map((segment) => segment.trim()).filter(Boolean);
}

function routeSegments(req: RequestLike): string[] {
  const fromQuery = pathSegments(req.query.path);
  if (fromQuery.length) return fromQuery;
  const pathname = new URL(req.url ?? "/", "https://powerboard.local").pathname;
  return pathname.replace(/^\/api\/?/, "").split("/").map((segment) => segment.trim()).filter(Boolean);
}

function isRoute(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((segment, index) => segment === expected[index]);
}

function readObjectBody(req: RequestLike): Record<string, unknown> {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    return JSON.parse(req.body) as Record<string, unknown>;
  }
  if (typeof req.body === "object") {
    return req.body as Record<string, unknown>;
  }
  return {};
}

function readQuery(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join("/") : value;
}

function notFound(res: JsonResponseLike): void {
  res.status(404).json({ error: "PowerBoard API route not found." });
}
