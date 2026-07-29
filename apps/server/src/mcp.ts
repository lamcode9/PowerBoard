import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { agentIdentity } from "./agentIdentity.js";
import { BoardStore } from "./boardService.js";
import { createBoardMcpServer } from "./mcpServer.js";

/**
 * stdio entrypoint. Two modes, and the choice matters for correctness rather than convenience:
 *
 * - **Attached** (default when PowerBoard or `npm run dev` is running): this process is a
 *   transport-level JSON-RPC proxy into the live server's `/mcp`. That keeps exactly one BoardStore
 *   for the machine, so several agents plus the human share one undo stack, one history index, and
 *   one set of `board.changed` broadcasts — edits show up on the canvas as they land.
 * - **Embedded** (nothing listening, or POWERBOARD_MCP_EMBEDDED=1): the original in-process store, so
 *   headless/offline use still works. A second *writing* process is the thing to avoid here: two
 *   stores racing the same `board.json` and `history/index.json` corrupt history and lose edits, and
 *   the canvas never hears about any of it.
 *
 * Never write to stdout in this file — stdout is the protocol channel. Diagnostics go to stderr.
 */
const serverUrl = process.env.POWERBOARD_SERVER_URL ?? "http://127.0.0.1:4318";
const agent = agentIdentity(process.env.POWERBOARD_AGENT_NAME);
const forceEmbedded = process.env.POWERBOARD_MCP_EMBEDDED === "1";

if (!forceEmbedded && (await serverIsLive(serverUrl))) {
  try {
    await startProxy(serverUrl, agent.name);
  } catch (error) {
    console.error(`PowerBoard MCP: could not attach to ${serverUrl} (${describe(error)}); falling back to an embedded store.`);
    await startEmbedded();
  }
} else {
  await startEmbedded();
}

async function startEmbedded(): Promise<void> {
  const store = new BoardStore();
  await store.ensureReady();
  const server = createBoardMcpServer(store, { agent });
  await server.connect(new StdioServerTransport());
}

/**
 * Pumps raw JSON-RPC between the two transports. The protocol is symmetric, so no McpServer/Client
 * pair is needed in the middle — anything the client asks for (including tools this build has never
 * heard of) is answered by the live server, which is the point of attaching to it.
 */
async function startProxy(url: string, agentName: string): Promise<void> {
  const endpoint = new URL("/mcp", url);
  endpoint.searchParams.set("agent", agentName);
  const upstream = new StreamableHTTPClientTransport(endpoint);
  const stdio = new StdioServerTransport();

  stdio.onmessage = (message: JSONRPCMessage) => {
    void upstream.send(message).catch((error) => fail(`send to ${endpoint.origin} failed: ${describe(error)}`));
  };
  upstream.onmessage = (message: JSONRPCMessage) => {
    void stdio.send(message).catch((error) => fail(`reply to the MCP client failed: ${describe(error)}`));
  };
  // A dropped link has to be loud: silently serving nothing would look like a board that ignores the agent.
  upstream.onerror = (error) => console.error(`PowerBoard MCP proxy: upstream error — ${describe(error)}`);
  stdio.onerror = (error) => console.error(`PowerBoard MCP proxy: stdio error — ${describe(error)}`);
  upstream.onclose = () => void stdio.close();
  stdio.onclose = () => void upstream.close();

  await upstream.start();
  await stdio.start();
  console.error(`PowerBoard MCP: attached to the running server at ${endpoint.origin} as "${agentName}".`);
}

async function serverIsLive(url: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/api/health", url), { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    const body = (await response.json()) as { name?: string };
    return body?.name === "PowerBoard";
  } catch {
    return false;
  }
}

function fail(message: string): void {
  console.error(`PowerBoard MCP proxy: ${message}`);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
