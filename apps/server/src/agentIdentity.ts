import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who is editing. More than one agent can hold a board at once, so every write, op-log entry and
 * presence ping has to say *which* one — otherwise the activity feed and the canvas reticles
 * collapse into a single anonymous "agent" and the human can't tell two collaborators apart.
 *
 * `id` is derived from the name, so the same agent keeps its colour and its presence lane across
 * reconnects. Two connections that give the same name deliberately share one lane — give agents
 * distinct names when you want distinct lanes.
 */
export interface AgentIdentity {
  id: string;
  name: string;
}

export const ANONYMOUS_AGENT: AgentIdentity = { id: "agent", name: "Agent" };

const MAX_NAME_LENGTH = 48;

export function agentIdentity(name?: string | null): AgentIdentity {
  const clean = typeof name === "string" ? name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH) : "";
  if (!clean) return ANONYMOUS_AGENT;
  const id = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return { id: id || ANONYMOUS_AGENT.id, name: clean };
}

/**
 * Request-scoped identity. HTTP `/mcp` is stateless — a fresh `McpServer` per POST over one shared
 * store — so several agents' tool calls interleave inside the same process. AsyncLocalStorage is the
 * only way to read "who is calling" deep inside a handler without threading an identity argument
 * through all 39 tools; a module-level "current agent" variable would be read by the wrong caller
 * the moment two handlers await concurrently.
 */
const agentContext = new AsyncLocalStorage<AgentIdentity>();

export function runAsAgent<T>(identity: AgentIdentity, task: () => T): T {
  return agentContext.run(identity, task);
}

export function currentAgent(): AgentIdentity {
  return agentContext.getStore() ?? ANONYMOUS_AGENT;
}

/**
 * Identity of an HTTP MCP caller, in order of how explicit it is: `?agent=` on the endpoint URL
 * (works for any client that only lets you configure a URL), then the `x-powerboard-agent` header.
 * Neither is authentication — the local MCP endpoint is unauthenticated by design; this is a
 * collaboration label, so treat it as a display name, never as a permission.
 */
export function agentIdentityFromRequest(query: unknown, headers: Record<string, unknown>): AgentIdentity {
  const fromQuery = typeof query === "string" ? query : Array.isArray(query) && typeof query[0] === "string" ? query[0] : undefined;
  const header = headers["x-powerboard-agent"];
  const fromHeader = typeof header === "string" ? header : Array.isArray(header) ? header[0] : undefined;
  return agentIdentity(fromQuery || fromHeader);
}
