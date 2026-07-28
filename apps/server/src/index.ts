import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import http from "node:http";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BoardOperation, boardTemplates, BoardProjectSchema, OperationSchema } from "@powerboard/schema";
import { agentActivityForOperation, BoardStore } from "./boardService.js";
import { BackupService } from "./backupService.js";
import { boardRoot } from "./paths.js";
import { createBoardMcpServer } from "./mcpServer.js";

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 4318);
const store = new BoardStore();
await store.ensureReady();
const backup = new BackupService((boardId) => store.readBoard(boardId));

const app = express();
app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173"] }));
app.use(express.json({ limit: "30mb" }));
app.use("/boards", express.static(boardRoot));

app.get(/^\/boards\/([^/]+)\/(assets|exports)\/(.+)$/, asyncHandler(async (req, res) => {
  const boardId = req.params[0];
  const folder = req.params[1];
  const filePath = req.params[2];
  if (!boardId || !folder || !filePath) {
    res.status(404).json({ error: "File not found." });
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
}));

app.get("/api/health", asyncHandler(async (_req, res) => {
  await store.ensureReady();
  res.json({ ok: true, name: "PowerBoard", boardRoot, cloudStore: store.cloudStatus(), storageMode: store.storageModeStatus(), backup: backup.status() });
}));

app.get("/api/backups/status", (_req, res) => {
  res.json(backup.status());
});

app.post("/api/backups/flush", asyncHandler(async (_req, res) => {
  const boards = await store.listBoards();
  res.json(await backup.flush(boards.map((board) => board.id)));
}));

app.get("/api/boards/:boardId/backups", asyncHandler(async (req, res) => {
  res.json(await backup.listBackups(param(req, "boardId")));
}));

app.post("/api/boards/:boardId/restore", asyncHandler(async (req, res) => {
  const fileName = typeof req.body?.file === "string" ? req.body.file : "";
  const boardId = param(req, "boardId");
  const snapshot = await backup.readBackup(boardId, fileName);
  if (snapshot.id !== boardId) {
    throw new Error(`Backup belongs to a different board (${snapshot.id}).`);
  }
  const next = await store.replaceBoard(boardId, snapshot);
  broadcast(next.id, { type: "board.changed", boardId: next.id, project: next });
  res.json(next);
}));

app.get("/api/boards/:boardId/oplog", asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit ?? 100);
  res.json(await store.readOpLog(param(req, "boardId"), Number.isFinite(limit) ? limit : 100));
}));

app.get("/api/boards/:boardId/history", asyncHandler(async (req, res) => {
  res.json(await store.historyDepths(param(req, "boardId")));
}));

app.get("/api/boards", asyncHandler(async (_req, res) => {
  res.json(await store.listBoards());
}));

app.post("/api/boards", asyncHandler(async (req, res) => {
  const requestedTemplate = req.body?.template;
  const template = boardTemplates.find((candidate) => candidate === requestedTemplate);
  const project = await store.createBoard(typeof req.body?.name === "string" ? req.body.name : undefined, template);
  broadcast(project.id, { type: "board.changed", boardId: project.id, project });
  res.status(201).json(project);
}));

app.get("/api/boards/:boardId", asyncHandler(async (req, res) => {
  res.json(await store.readBoard(param(req, "boardId")));
}));

app.get("/api/boards/:boardId/validation", asyncHandler(async (req, res) => {
  res.json(await store.validateBoard(param(req, "boardId")));
}));

app.get("/api/boards/:boardId/hierarchy", asyncHandler(async (req, res) => {
  res.json(await store.inspectBoardHierarchy(param(req, "boardId")));
}));

app.put("/api/boards/:boardId", asyncHandler(async (req, res) => {
  const project = BoardProjectSchema.parse(req.body);
  const next = await store.replaceBoard(param(req, "boardId"), project);
  broadcast(next.id, { type: "board.changed", boardId: next.id, project: next });
  res.json(next);
}));

app.patch("/api/boards/:boardId", asyncHandler(async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name : "";
  if (!name.trim()) {
    res.status(400).json({ error: "name is required." });
    return;
  }
  const next = await store.renameBoard(param(req, "boardId"), name);
  broadcast(next.id, { type: "board.changed", boardId: next.id, project: next });
  res.json(next);
}));

app.delete("/api/boards/:boardId", asyncHandler(async (req, res) => {
  const boardId = param(req, "boardId");
  const removed = await store.deleteBoard(boardId);
  if (!removed) {
    res.status(404).json({ error: `Board not found: ${boardId}` });
    return;
  }
  backup.cancel(boardId);
  broadcast(boardId, { type: "board.removed", boardId });
  res.json({ ok: true, boardId });
}));

app.post("/api/boards/:boardId/operations", asyncHandler(async (req, res) => {
  const operation = OperationSchema.parse(req.body.operation) as BoardOperation;
  const agentEdit = readAgentEdit(req.body);
  const next = await store.applyOperation(param(req, "boardId"), operation, agentEdit ? { source: "agent", actor: agentEdit.actor } : {});
  const agentActivity = agentEdit ? agentActivityForOperation(next, operation) : undefined;
  broadcast(next.id, { type: "board.changed", boardId: next.id, project: next, operation, agentActivity });
  res.json(next);
}));

app.post("/api/boards/:boardId/operations/batch", asyncHandler(async (req, res) => {
  const rawOperations = Array.isArray(req.body?.operations) ? (req.body.operations as unknown[]) : [];
  if (!rawOperations.length) {
    res.status(400).json({ error: "operations must be a non-empty array." });
    return;
  }
  const operations = rawOperations.map((operation) => OperationSchema.parse(operation) as BoardOperation);
  const agentEdit = readAgentEdit(req.body);
  const expectedUpdatedAt = typeof req.body?.expectedUpdatedAt === "string" ? req.body.expectedUpdatedAt : undefined;
  const result = await store.applyOperations(param(req, "boardId"), operations, {
    ...(agentEdit ? { source: "agent" as const, actor: agentEdit.actor } : {}),
    expectedUpdatedAt
  });
  const agentActivity = agentEdit ? agentActivityForOperation(result.project, operations[operations.length - 1]!) : undefined;
  broadcast(result.project.id, { type: "board.changed", boardId: result.project.id, project: result.project, agentActivity });
  res.json(result);
}));

app.post("/api/boards/:boardId/operations/preview", asyncHandler(async (req, res) => {
  const operation = OperationSchema.parse(req.body.operation) as BoardOperation;
  res.json(await store.previewOperation(param(req, "boardId"), operation));
}));

app.post("/api/boards/:boardId/undo", asyncHandler(async (req, res) => {
  const next = await store.undo(param(req, "boardId"));
  broadcast(next.id, { type: "board.changed", boardId: next.id, project: next });
  res.json(next);
}));

app.post("/api/boards/:boardId/redo", asyncHandler(async (req, res) => {
  const next = await store.redo(param(req, "boardId"));
  broadcast(next.id, { type: "board.changed", boardId: next.id, project: next });
  res.json(next);
}));

app.post("/api/boards/:boardId/selection", asyncHandler(async (req, res) => {
  const selection = Array.isArray(req.body?.selection) ? req.body.selection.filter((id: unknown): id is string => typeof id === "string") : [];
  const project = await store.setSelection(param(req, "boardId"), selection);
  broadcast(project.id, { type: "selection.changed", boardId: project.id, selection });
  res.json({ selection });
}));

app.post("/api/boards/:boardId/selection/inspect", asyncHandler(async (req, res) => {
  const selection = readSelection(req.body);
  res.json(await store.inspectSelection(param(req, "boardId"), selection));
}));

app.post("/api/boards/:boardId/selection/handoff", asyncHandler(async (req, res) => {
  const selection = readSelection(req.body);
  const includePng = Boolean(req.body?.includePng);
  res.json(await store.exportSelectionHandoff(param(req, "boardId"), selection, { includePng }));
}));

app.post("/api/boards/:boardId/assets", asyncHandler(async (req, res) => {
  const { fileName, dataUrl } = req.body ?? {};
  if (typeof fileName !== "string" || typeof dataUrl !== "string") {
    res.status(400).json({ error: "fileName and dataUrl are required." });
    return;
  }
  const result = await store.saveAsset(param(req, "boardId"), { fileName, dataUrl });
  broadcast(result.project.id, { type: "board.changed", boardId: result.project.id, project: result.project });
  res.status(201).json(result);
}));

app.post("/api/boards/:boardId/export/png", asyncHandler(async (req, res) => {
  const artboardId = typeof req.body?.artboardId === "string" ? req.body.artboardId : undefined;
  if (!artboardId) {
    res.status(400).json({ error: "artboardId is required." });
    return;
  }
  res.json(await store.exportArtboardPng(param(req, "boardId"), artboardId));
}));

app.post("/api/boards/:boardId/export/spec", asyncHandler(async (req, res) => {
  res.json(await store.exportSpec(param(req, "boardId")));
}));

app.post("/api/boards/:boardId/export/react-tailwind", asyncHandler(async (req, res) => {
  res.json(await store.exportReactTailwind(param(req, "boardId")));
}));

app.post("/api/boards/:boardId/export/svg", asyncHandler(async (req, res) => {
  const pageId = typeof req.body?.pageId === "string" ? req.body.pageId : undefined;
  res.json(await store.exportPageSvg(param(req, "boardId"), pageId));
}));

app.post("/api/boards/:boardId/export/pdf", asyncHandler(async (req, res) => {
  const pageId = typeof req.body?.pageId === "string" ? req.body.pageId : undefined;
  res.json(await store.exportPagePdf(param(req, "boardId"), pageId));
}));

app.post("/api/boards/:boardId/export/mermaid", asyncHandler(async (req, res) => {
  res.json(await store.exportMermaid(param(req, "boardId")));
}));

app.post("/mcp", async (req, res) => {
  const server = createBoardMcpServer(store, {
    onBoardChanged: async (boardId, agentActivity) => {
      const project = await store.readBoard(boardId);
      broadcast(boardId, { type: "board.changed", boardId, project, agentActivity });
    },
    onBoardRemoved: (boardId) => {
      backup.cancel(boardId);
      broadcast(boardId, { type: "board.removed", boardId });
    },
    onAgentPresence: (presence) => {
      broadcast(presence.boardId, { type: "agent.presence", ...presence });
    },
    statusExtras: () => ({ backup: backup.status() })
  });

  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: error instanceof Error ? error.message : "Internal server error" },
        id: null
      });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({ error: "Use POST /mcp for streamable HTTP MCP." });
});

// Desktop shell: serve the built web app from the same origin so /api, /boards and /ws
// all resolve without CORS. POWERBOARD_WEB_DIST points at apps/web/dist (set by Electron).
const webDist = process.env.POWERBOARD_WEB_DIST;
if (webDist) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api\/|boards\/|mcp$|ws$).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(400).json({ error: error.message });
});

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
type BoardSocket = WebSocket & { boardId?: string };
const sockets = new Set<BoardSocket>();

wss.on("connection", (socket, request) => {
  const boardSocket = socket as BoardSocket;
  const url = new URL(request.url ?? "/ws", `http://${request.headers.host ?? "127.0.0.1"}`);
  boardSocket.boardId = url.searchParams.get("boardId") ?? undefined;
  sockets.add(boardSocket);

  socket.on("message", async (raw) => {
    try {
      const message = JSON.parse(String(raw)) as { type?: string; boardId?: string; selection?: string[] };
      if (message.type === "selection.changed" && message.boardId) {
        const selection = Array.isArray(message.selection) ? message.selection : [];
        await store.setSelection(message.boardId, selection);
        broadcast(message.boardId, { type: "selection.changed", boardId: message.boardId, selection }, boardSocket);
      }
    } catch {
      socket.send(JSON.stringify({ type: "error", error: "Invalid WebSocket message." }));
    }
  });

  socket.on("close", () => sockets.delete(boardSocket));
});

httpServer.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`PowerBoard server could not start: port ${port} is already in use (another PowerBoard instance or dev server?).`);
  } else {
    console.error(`PowerBoard server failed to start: ${error.message}`);
  }
  process.exitCode = 1;
});

httpServer.listen(port, host, () => {
  console.log(`PowerBoard server listening at http://${host}:${port}`);
  console.log(`Boards are stored in ${path.relative(process.cwd(), boardRoot) || boardRoot}`);
  console.log(`Cloud store: ${store.cloudStatus()}`);
  console.log(`Storage mode: ${store.storageModeStatus()}`);
});

function broadcast(boardId: string, message: unknown, except?: WebSocket): void {
  const payload = JSON.stringify(message);
  for (const socket of sockets) {
    if (socket !== except && socket.readyState === WebSocket.OPEN && (!socket.boardId || socket.boardId === boardId)) {
      socket.send(payload);
    }
  }
  if ((message as { type?: string }).type === "board.changed" && store.storageModeStatus() !== "cloud") {
    backup.schedule(boardId);
  }
}

// Flush pending backups before the process dies (Cmd+Q, SIGTERM from Electron, Ctrl+C in dev).
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void backup
      .flush()
      .catch((error) => console.error(`PowerBoard: backup flush on ${signal} failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => process.exit(0));
  });
}

function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<void> | Promise<Response> | Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string") {
    throw new Error(`Missing route parameter: ${name}`);
  }
  return value;
}

function readAgentEdit(body: unknown): { actor?: string } | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  if (record.source !== "agent") return undefined;
  return { actor: typeof record.actor === "string" && record.actor.trim() ? record.actor : undefined };
}

function readSelection(body: unknown): string[] | undefined {
  if (!body || typeof body !== "object") return undefined;
  const selection = (body as Record<string, unknown>).selection;
  return Array.isArray(selection) ? selection.filter((id): id is string => typeof id === "string") : undefined;
}
