import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BoardStore } from "./boardService.js";
import { createBoardMcpServer } from "./mcpServer.js";

const store = new BoardStore();
await store.ensureReady();

const server = createBoardMcpServer(store);
await server.connect(new StdioServerTransport());
