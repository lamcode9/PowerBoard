import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { ZodError } from "zod";
import {
  ArtboardSchema,
  BoardElementSchema,
  BoardConnector,
  BoardOperation,
  BoardProject,
  BoardProjectSchema,
  ConnectorSchema,
  createElementFromPreset,
  createId,
  OperationSchema,
  POLISH_GRID,
  POLISH_TOLERANCE,
  validateBoardStructure
} from "@powerboard/schema";
import { agentIdentity, AgentIdentity, ANONYMOUS_AGENT, currentAgent, runAsAgent } from "./agentIdentity.js";
import { agentActivityForOperation, agentActivityForSelection, AgentBoardActivity, BoardStore } from "./boardService.js";

/**
 * Geometry problems that make a board look unfinished, as opposed to structurally invalid. Every
 * export tool returns these beside its file path so an agent that never calls validate_board still
 * finds out — the failure has to surface at the moment it believes it is done.
 */
const LAYOUT_DIAGNOSTIC_CODES = new Set([
  "connector-crosses-element",
  "connector-endpoints-collide",
  "connector-label-collides",
  "elements-overlap",
  "element-outside-artboard"
]);

/** Element types that read as diagram nodes rather than app-mockup surfaces. */
const DIAGRAM_NODE_TYPES = new Set(["shape", "sticky", "frame", "card", "group"]);

/**
 * The schema-wide connector default is `curved`, which is right for app-flow arrows between
 * artboards and wrong for a diagram, where elbows are the convention. Rather than fork the schema,
 * apply the diagram convention at the moment of creation — but only when the caller did not state a
 * routing itself, so an explicit choice is never overridden.
 */
function withDiagramDefaults(connector: BoardConnector, project: BoardProject, raw: Record<string, unknown>): BoardConnector {
  if (raw.routing !== undefined) return connector;
  const endpoints = [connector.fromElementId, connector.toElementId];
  if (endpoints.some((id) => !id)) return connector;
  const bothAreNodes = endpoints.every((id) => {
    const element = project.elements.find((candidate) => candidate.id === id);
    return element ? DIAGRAM_NODE_TYPES.has(element.type) : false;
  });
  return bothAreNodes ? { ...connector, routing: "orthogonal" } : connector;
}

function layoutDiagnosticsFor(project: BoardProject): { clean: boolean; issues: string[]; hint?: string } {
  const issues = validateBoardStructure(project)
    .issues.filter((issue) => LAYOUT_DIAGNOSTIC_CODES.has(issue.code))
    .map((issue) => `${issue.code}: ${issue.message}`);
  if (issues.length === 0) return { clean: true, issues };
  return { clean: false, issues, hint: "Run polish_layout on this artboard, then re-export. Anything still listed needs a content change (shorter label, more spacing)." };
}

interface BoardMcpOptions {
  /**
   * Identity of the client on the other end of this connection — resolved once by the transport
   * (URL/header for HTTP, env for stdio) and used for every call that doesn't name an agent itself.
   */
  agent?: AgentIdentity;
  onBoardChanged?: (boardId: string, activity?: AgentBoardActivity) => Promise<void> | void;
  /** Fired after an application-level board deletion so live clients can drop it from the board list. */
  onBoardRemoved?: (boardId: string) => Promise<void> | void;
  /**
   * Fired when any tool *starts* — reads included. `board.changed` only lands after a write, so on its
   * own the canvas reads as idle while an agent is inspecting or between ops. This is the signal that
   * lets the UI say "an agent is working right now" instead of "an agent just finished something".
   */
  onAgentPresence?: (presence: AgentPresence) => void;
  /** Extra live status for get_board_status (e.g. backup health from the HTTP server). */
  statusExtras?: () => Record<string, unknown>;
}

/** A single "an agent is touching this board" heartbeat. `ids` is a best-effort focus hint, not a guarantee. */
export interface AgentPresence {
  boardId: string;
  /** Which agent — one presence lane (and one colour) per id, so simultaneous agents don't overwrite each other. */
  agentId: string;
  agentName: string;
  tool: string;
  ids: string[];
  at: string;
}

/**
 * Id-ish inputs, lifted so a *read* can point the canvas at what the agent is looking at. Writes get
 * exact targets from `agentActivityForOperation`; this is only the hint for everything before that.
 */
const PRESENCE_ID_KEYS = ["artboardId", "elementId", "connectorId", "parentId", "sourceArtboardId", "pageId"] as const;
const PRESENCE_ID_LIST_KEYS = ["ids", "elementIds", "artboardIds", "selection"] as const;

function presenceTargetIds(input: Record<string, unknown> | undefined): string[] {
  if (!input) return [];
  const ids = new Set<string>();
  for (const key of PRESENCE_ID_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value) ids.add(value);
  }
  for (const key of PRESENCE_ID_LIST_KEYS) {
    const value = input[key];
    if (!Array.isArray(value)) continue;
    for (const entry of value) if (typeof entry === "string" && entry) ids.add(entry);
  }
  return [...ids];
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

// Idempotency-key replay cache. Keys live at module scope because HTTP mode creates a
// fresh McpServer per request; the process (one per installed app) is the session.
const idempotencyCache = new Map<string, { at: number; result: ToolResult }>();
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

function idempotencyGet(key: string | undefined, tool: string): ToolResult | undefined {
  if (!key) return undefined;
  const entry = idempotencyCache.get(`${tool}:${key}`);
  if (!entry) return undefined;
  if (Date.now() - entry.at > IDEMPOTENCY_TTL_MS) {
    idempotencyCache.delete(`${tool}:${key}`);
    return undefined;
  }
  return entry.result;
}

function idempotencySet(key: string | undefined, tool: string, result: ToolResult): void {
  if (!key) return;
  if (idempotencyCache.size > 500) {
    const oldest = [...idempotencyCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
    for (const [staleKey] of oldest) idempotencyCache.delete(staleKey);
  }
  idempotencyCache.set(`${tool}:${key}`, { at: Date.now(), result });
}

/**
 * Every tool returns structured, machine-parseable errors (playbook §4): code + message +
 * hint naming the offending input. Agents should treat these as data, not retry blind.
 */
function toolError(tool: string, error: unknown): ToolResult {
  let code = "internal_error";
  let message = error instanceof Error ? error.message : String(error);
  let hint: string | undefined;
  let details: unknown;
  if (error instanceof ZodError || (error instanceof Error && error.name === "ZodError")) {
    code = "validation_failed";
    const issues = (error as ZodError).issues ?? [];
    details = issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    message = "Input failed schema validation.";
    hint = "Fix the listed fields and retry. Use preview_operation to dry-run first.";
  } else if (/not found/i.test(message)) {
    code = "not_found";
    hint = "Check ids with list_boards / inspect_board_hierarchy before writing.";
  } else if (/required/i.test(message)) {
    code = "missing_input";
  } else if (/conflict|does not match|already exists/i.test(message)) {
    code = "conflict";
  }
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { code, tool, message, hint, details } }, null, 2) }]
  };
}

export function createBoardMcpServer(store: BoardStore, options: BoardMcpOptions = {}): McpServer {
  const server = new McpServer({
    name: "powerboard",
    version: "0.3.0"
  });

  // Wrap every handler: structured errors + optional idempotency replay.
  const registerTool = (
    name: string,
    config: { title: string; description: string; inputSchema?: Record<string, unknown> },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool inputs are validated by the SDK against inputSchema
    handler: (input: any) => Promise<ToolResult>
  ) => {
    if (config.inputSchema) {
      config = { ...config, inputSchema: { ...config.inputSchema, ...idempotencyInput } };
    }
    server.registerTool(name, config as never, (async (input: Record<string, unknown> = {}) => {
      // Identity is per call so one connection can act for several agents, falling back to the
      // connection's own identity. Everything downstream reads it from the async context.
      const identity = typeof input?.agentName === "string" && input.agentName.trim() ? agentIdentity(input.agentName) : options.agent ?? ANONYMOUS_AGENT;
      return runAsAgent(identity, async () => {
        const key = typeof input?.idempotencyKey === "string" ? input.idempotencyKey : undefined;
        const presenceBoardId = typeof input?.boardId === "string" ? input.boardId : undefined;
        if (presenceBoardId) {
          options.onAgentPresence?.({
            boardId: presenceBoardId,
            agentId: identity.id,
            agentName: identity.name,
            tool: name,
            ids: presenceTargetIds(input),
            at: new Date().toISOString()
          });
        }
        const cached = idempotencyGet(key, name);
        if (cached) return cached;
        try {
          const result = await handler(input);
          idempotencySet(key, name, result);
          return result;
        } catch (error) {
          return toolError(name, error);
        }
      });
    }) as never);
  };

  const idempotencyInput = {
    idempotencyKey: z.string().optional().describe("Optional replay-protection key: same key returns the first call's result for 10 minutes instead of re-applying."),
    agentName: z
      .string()
      .optional()
      .describe(
        "Optional display name for the agent making this call — shown in the activity feed and on the canvas, and recorded in the op-log. Boards accept several agents at once; a distinct name gives you your own presence lane. Defaults to the name configured on the connection."
      )
  };

  const changed = async (boardId: string, activity?: AgentBoardActivity) => {
    await options.onBoardChanged?.(boardId, activity);
  };

  const applyAgentOperation = async (boardId: string, operation: BoardOperation) => {
    const identity = currentAgent();
    const project = await store.applyOperation(boardId, operation, { source: "agent", actor: identity.name });
    await changed(boardId, agentActivityForOperation(project, operation, identity));
    return project;
  };

  registerTool(
    "list_boards",
    {
      title: "List boards",
      description: "List PowerBoard board projects from the configured source of truth. In cloud mode, this is Supabase."
    },
    async () => text(await store.listBoards())
  );

  registerTool(
    "read_board",
    {
      title: "Read board",
      description: "Read a board project as JSON.",
      inputSchema: { boardId: z.string() }
    },
    async ({ boardId }) => text(await store.readBoard(boardId))
  );

  registerTool(
    "summarize_board",
    {
      title: "Summarize board",
      description: "Summarize artboards, elements, and flows for a board.",
      inputSchema: { boardId: z.string() }
    },
    async ({ boardId }) => text(await store.summarizeBoard(boardId))
  );

  registerTool(
    "create_board",
    {
      title: "Create board",
      description: "Create a new PowerBoard board project in the configured source of truth. In cloud mode, this writes to Supabase.",
      inputSchema: { name: z.string().optional() }
    },
    async ({ name }) => {
      const project = await store.createBoard(name);
      await changed(project.id);
      return text(project);
    }
  );

  registerTool(
    "rename_board",
    {
      title: "Rename board",
      description:
        "Rename a whole board project. Application-level lifecycle action — updates the board's name and updatedAt; not an in-board element operation, so it is not on the board undo stack.",
      inputSchema: { boardId: z.string(), name: z.string().min(1) }
    },
    async ({ boardId, name }) => {
      const project = await store.renameBoard(boardId, name);
      await changed(boardId);
      return text(project);
    }
  );

  registerTool(
    "delete_board",
    {
      title: "Delete board",
      description:
        "Permanently delete a whole board project — its JSON, assets, exports, and history — from the configured source of truth. Application-level lifecycle action: irreversible and NOT covered by board undo (versioned backup snapshots are left on disk as a safety net). Returns { ok, boardId }. Confirm the id with list_boards first.",
      inputSchema: { boardId: z.string() }
    },
    async ({ boardId }) => {
      const removed = await store.deleteBoard(boardId);
      if (!removed) {
        throw new Error(`Board not found: ${boardId}`);
      }
      await options.onBoardRemoved?.(boardId);
      return text({ ok: true, boardId, deleted: true });
    }
  );

  registerTool(
    "list_board_files",
    {
      title: "List board files",
      description:
        "List the files backing a board at the application level: its JSON location, the assets it references (icons, imported screenshots), and the exports generated for it (PNG/SVG/PDF/spec). Pair with list_boards to see everything PowerBoard stores, not just the in-board object model.",
      inputSchema: { boardId: z.string() }
    },
    async ({ boardId }) => text(await store.listBoardFiles(boardId))
  );

  registerTool(
    "create_artboard",
    {
      title: "Create artboard",
      description: "Add an artboard to an existing board.",
      inputSchema: {
        boardId: z.string(),
        artboard: z.unknown()
      }
    },
    async ({ boardId, artboard }) => {
      const parsed = ArtboardSchema.parse(artboard);
      const project = await applyAgentOperation(boardId, { type: "create_artboard", artboard: parsed });
      return text(project);
    }
  );

  registerTool(
    "update_artboard",
    {
      title: "Update artboard",
      description: "Patch an artboard. Use this for names, positions, dimensions, background, lock, and visibility.",
      inputSchema: {
        boardId: z.string(),
        artboardId: z.string(),
        patch: z.record(z.string(), z.unknown())
      }
    },
    async ({ boardId, artboardId, patch }) => {
      const project = await applyAgentOperation(boardId, { type: "update_artboard", artboardId, patch });
      return text(project);
    }
  );

  registerTool(
    "create_variant",
    {
      title: "Create variant",
      description: "Duplicate an artboard and its elements as a new variant.",
      inputSchema: {
        boardId: z.string(),
        sourceArtboardId: z.string(),
        name: z.string().optional(),
        offsetX: z.number().optional()
      }
    },
    async ({ boardId, sourceArtboardId, name, offsetX }) => {
      const project = await applyAgentOperation(boardId, { type: "create_variant", sourceArtboardId, name, offsetX: offsetX ?? 460 });
      return text(project);
    }
  );

  registerTool(
    "add_element",
    {
      title: "Add element",
      description:
        "Add a semantic design element to a board. Provide either a full element or a preset type plus artboardId/x/y. " +
        "For diagram nodes use type 'shape' with props {shape, text, subtitle} — one element carries its own title and caption, so apply_layout can move whole nodes. " +
        "Composing a node out of a frame plus separate text elements looks the same but breaks auto-layout, which moves the frame and leaves the labels behind.",
      inputSchema: {
        boardId: z.string(),
        element: z.unknown().optional(),
        presetType: z.string().optional(),
        artboardId: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional()
      }
    },
    async ({ boardId, element, presetType, artboardId, x, y }) => {
      const parsed = element
        ? BoardElementSchema.parse(element)
        : createElementFromPreset(BoardElementSchema.shape.type.parse(presetType), required(artboardId, "artboardId"), x ?? 24, y ?? 24);
      const project = await applyAgentOperation(boardId, { type: "add_element", element: parsed });
      return text(project);
    }
  );

  registerTool(
    "preview_operation",
    {
      title: "Preview operation",
      description: "Dry-run a board operation without saving it, returning target ids, count changes, hierarchy, and validation diagnostics.",
      inputSchema: {
        boardId: z.string(),
        operation: z.unknown()
      }
    },
    async ({ boardId, operation }) => text(await store.previewOperation(boardId, OperationSchema.parse(operation)))
  );

  registerTool(
    "update_element",
    {
      title: "Update element",
      description: "Patch an element. style, layout, and props are shallow-merged.",
      inputSchema: {
        boardId: z.string(),
        elementId: z.string(),
        patch: z.record(z.string(), z.unknown())
      }
    },
    async ({ boardId, elementId, patch }) => {
      const project = await applyAgentOperation(boardId, { type: "update_element", elementId, patch });
      return text(project);
    }
  );

  registerTool(
    "delete_element",
    {
      title: "Delete element",
      description: "Delete an element and its descendants.",
      inputSchema: { boardId: z.string(), elementId: z.string() }
    },
    async ({ boardId, elementId }) => {
      const project = await applyAgentOperation(boardId, { type: "delete_element", elementId });
      return text(project);
    }
  );

  registerTool(
    "move_resize_element",
    {
      title: "Move or resize element",
      description: "Move and/or resize an element.",
      inputSchema: {
        boardId: z.string(),
        elementId: z.string(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional()
      }
    },
    async ({ boardId, elementId, x, y, width, height }) => {
      const project = await applyAgentOperation(boardId, { type: "move_resize_element", elementId, x, y, width, height });
      return text(project);
    }
  );

  registerTool(
    "get_selection",
    {
      title: "Get selection",
      description: "Get the browser's current selected ids for a board.",
      inputSchema: { boardId: z.string() }
    },
    async ({ boardId }) => text({ boardId, selection: store.getSelection(boardId) })
  );

  registerTool(
    "set_selection",
    {
      title: "Set selection",
      description: "Set selected ids on a board.",
      inputSchema: {
        boardId: z.string(),
        selection: z.array(z.string())
      }
    },
    async ({ boardId, selection }) => {
      const project = await store.setSelection(boardId, selection);
      await changed(boardId, agentActivityForSelection(project, currentAgent()));
      return text(project.selection);
    }
  );

  registerTool(
    "describe_selection",
    {
      title: "Describe selection",
      description: "Describe selected artboards/elements/connectors.",
      inputSchema: { boardId: z.string() }
    },
    async ({ boardId }) => {
      const project = await store.readBoard(boardId);
      const selection = store.getSelection(boardId).length ? store.getSelection(boardId) : project.selection;
      const descriptions = selection.map((id) => {
        const artboard = project.artboards.find((candidate) => candidate.id === id);
        if (artboard) return { kind: "artboard", ...artboard };
        const element = project.elements.find((candidate) => candidate.id === id);
        if (element) return { kind: "element", ...element };
        const connector = project.connectors.find((candidate) => candidate.id === id);
        if (connector) return { kind: "connector", ...connector };
        return { kind: "unknown", id };
      });
      return text(descriptions);
    }
  );

  registerTool(
    "inspect_selection",
    {
      title: "Inspect selection",
      description: "Inspect selected artboards, elements, or connectors with hierarchy paths and computed style.",
      inputSchema: {
        boardId: z.string(),
        selection: z.array(z.string()).optional()
      }
    },
    async ({ boardId, selection }) => text(await store.inspectSelection(boardId, selection))
  );

  registerTool(
    "export_selection_handoff",
    {
      title: "Export selection handoff",
      description: "Return React/Tailwind JSX for selected artboards, or artboards that contain selected elements. PNG export is optional.",
      inputSchema: {
        boardId: z.string(),
        selection: z.array(z.string()).optional(),
        includePng: z.boolean().optional()
      }
    },
    async ({ boardId, selection, includePng }) => text(await store.exportSelectionHandoff(boardId, selection, { includePng: includePng === true }))
  );

  registerTool(
    "inspect_board_hierarchy",
    {
      title: "Inspect board hierarchy",
      description: "Return an agent-readable artboard and element hierarchy with semantic paths.",
      inputSchema: { boardId: z.string() }
    },
    async ({ boardId }) => text(await store.inspectBoardHierarchy(boardId))
  );

  registerTool(
    "add_connector",
    {
      title: "Add connector",
      description:
        "Add a connector between artboards or elements. Connector v2 fields: fromElementId/toElementId (element anchoring), fromPort/toPort (auto|n|s|e|w), routing (straight|orthogonal|curved), arrowStart/arrowEnd (none|arrow|triangle|dot|diamond), waypoints [{x,y}] in page coordinates, cornerRadius (elbow softening; 0 = hard corners), label, labelPosition 0..1, style {stroke, strokeWidth, strokeStyle}. " +
        "strokeStyle is solid|dashed|dotted — use it for dotted-line/secondary relationships instead of encoding them as a lighter colour, or the legend will not match the drawing. " +
        "Orthogonal routes place their cross-bar mid-span and steer around other nodes automatically, and edges converging on one side fan out, so you rarely need waypoints — add them only to force a specific path.",
      inputSchema: {
        boardId: z.string(),
        connector: z.unknown()
      }
    },
    async ({ boardId, connector }) => {
      const parsed = ConnectorSchema.parse(connector);
      const project = await applyAgentOperation(boardId, {
        type: "add_connector",
        connector: withDiagramDefaults(parsed, await store.readBoard(boardId), (connector as Record<string, unknown>) ?? {})
      });
      return text(project);
    }
  );

  registerTool(
    "update_connector",
    {
      title: "Update connector",
      description: "Patch a connector (routing, ports, arrowheads, waypoints, label, style). style is shallow-merged.",
      inputSchema: {
        boardId: z.string(),
        connectorId: z.string(),
        patch: z.record(z.string(), z.unknown())
      }
    },
    async ({ boardId, connectorId, patch }) => {
      const project = await applyAgentOperation(boardId, { type: "update_connector", connectorId, patch });
      return text(project);
    }
  );

  registerTool(
    "delete_connector",
    {
      title: "Delete connector",
      description: "Delete a connector by id.",
      inputSchema: { boardId: z.string(), connectorId: z.string() }
    },
    async ({ boardId, connectorId }) => {
      const project = await applyAgentOperation(boardId, { type: "delete_connector", connectorId });
      return text(project);
    }
  );

  registerTool(
    "delete_artboard",
    {
      title: "Delete artboard",
      description: "Delete an artboard together with its elements, its connectors, and its page references. Irreversible except via undo.",
      inputSchema: { boardId: z.string(), artboardId: z.string() }
    },
    async ({ boardId, artboardId }) => {
      const project = await applyAgentOperation(boardId, { type: "delete_artboard", artboardId });
      return text(project);
    }
  );

  registerTool(
    "apply_layout",
    {
      title: "Apply auto-layout",
      description:
        "Auto-arrange elements: 'tree' (org charts, parent→child connectors), 'flow' (left-to-right process layers), 'distribute-horizontal/vertical', 'align-left/center-x/right/top/center-y/bottom'. Targets elementIds, or all root elements of artboardId.",
      inputSchema: {
        boardId: z.string(),
        layout: z.enum(["tree", "flow", "distribute-horizontal", "distribute-vertical", "align-left", "align-center-x", "align-right", "align-top", "align-center-y", "align-bottom"]),
        artboardId: z.string().optional(),
        elementIds: z.array(z.string()).optional(),
        spacingX: z.number().positive().optional(),
        spacingY: z.number().positive().optional()
      }
    },
    async ({ boardId, layout, artboardId, elementIds, spacingX, spacingY }) => {
      const project = await applyAgentOperation(boardId, { type: "apply_layout", layout, artboardId, elementIds, spacingX: spacingX ?? 80, spacingY: spacingY ?? 64 });
      return text(project);
    }
  );

  registerTool(
    "polish_layout",
    {
      title: "Polish layout",
      description:
        "Auto-correct an existing layout so it reads as presentation-ready: align rows and columns on their centres, unify sizes that were meant to match, even out spacing that was meant to be even, separate overlapping nodes, snap everything to an 8px grid, pull strays back inside the artboard, and repair connector ports left facing the wrong way plus waypoints stranded inside nodes. " +
        "Deliberately conservative — it only tightens what is already nearly aligned, so an intentionally irregular composition survives. Idempotent: polishing twice changes nothing. " +
        "Use this before exporting a poster. It complements apply_layout rather than replacing it: apply_layout computes a layout from scratch (tree/flow), polish_layout tidies the one you have.",
      inputSchema: {
        boardId: z.string(),
        artboardId: z.string().optional(),
        elementIds: z.array(z.string()).optional(),
        grid: z.number().positive().optional(),
        tolerance: z.number().positive().optional()
      }
    },
    async ({ boardId, artboardId, elementIds, grid, tolerance }) => {
      const before = await store.readBoard(boardId);
      const project = await applyAgentOperation(boardId, { type: "polish_layout", artboardId, elementIds, grid: grid ?? POLISH_GRID, tolerance: tolerance ?? POLISH_TOLERANCE });
      // Report what actually moved — a silent "done" gives the agent no way to judge the result.
      const previous = new Map(before.elements.map((element) => [element.id, element]));
      const adjusted = project.elements
        .filter((element) => {
          const original = previous.get(element.id);
          return original && (original.x !== element.x || original.y !== element.y || original.width !== element.width || original.height !== element.height);
        })
        .map((element) => element.name);
      return text({ adjusted: adjusted.length, elements: adjusted, layout: layoutDiagnosticsFor(project), board: project });
    }
  );

  registerTool(
    "batch_operations",
    {
      title: "Batch operations",
      description:
        "Apply multiple operations atomically: all succeed or none are written, one undo entry. Pass expectedUpdatedAt (board metadata.updatedAt you last read) for conflict detection. Prefer this over sequential single ops for multi-step edits.",
      inputSchema: {
        boardId: z.string(),
        operations: z.array(z.unknown()).min(1).max(200),
        expectedUpdatedAt: z.string().optional()
      }
    },
    async ({ boardId, operations, expectedUpdatedAt }) => {
      const parsed = (operations as unknown[]).map((operation, index) => {
        try {
          return OperationSchema.parse(operation);
        } catch (error) {
          throw new Error(`operations[${index}] is invalid: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
      const identity = currentAgent();
      const result = await store.applyOperations(boardId, parsed, { source: "agent", actor: identity.name, expectedUpdatedAt });
      await changed(boardId, agentActivityForOperation(result.project, parsed[parsed.length - 1]!, identity));
      return text({ applied: result.applied, board: result.project });
    }
  );

  registerTool(
    "get_board_status",
    {
      title: "Get board status",
      description: "Health/heartbeat: storage mode, backup health, board counts, undo/redo depth, last agent edit. Call this to confirm the server and board are live before long editing sessions.",
      inputSchema: { boardId: z.string().optional() }
    },
    async ({ boardId }) => {
      const status: Record<string, unknown> = {
        ok: true,
        serverTime: new Date().toISOString(),
        storageMode: store.storageModeStatus(),
        cloudStore: store.cloudStatus(),
        ...options.statusExtras?.()
      };
      if (boardId) {
        const project = await store.readBoard(boardId);
        status.board = {
          id: project.id,
          name: project.name,
          updatedAt: project.metadata.updatedAt,
          artboards: project.artboards.length,
          elements: project.elements.length,
          connectors: project.connectors.length,
          history: await store.historyDepths(boardId),
          lastAgentEditedAt: (project.metadata as Record<string, unknown>).lastAgentEditedAt,
          lastAgentEditedBy: (project.metadata as Record<string, unknown>).lastAgentEditedBy
        };
      }
      return text(status);
    }
  );

  registerTool(
    "board_undo",
    {
      title: "Undo",
      description: "Undo the last board change (persisted history — survives restarts).",
      inputSchema: { boardId: z.string() }
    },
    async ({ boardId }) => {
      const project = await store.undo(boardId);
      await changed(boardId);
      return text(project);
    }
  );

  registerTool(
    "board_redo",
    {
      title: "Redo",
      description: "Redo the last undone board change.",
      inputSchema: { boardId: z.string() }
    },
    async ({ boardId }) => {
      const project = await store.redo(boardId);
      await changed(boardId);
      return text(project);
    }
  );

  registerTool(
    "read_oplog",
    {
      title: "Read operation log",
      description: "Read the board's append-only operation log (most recent last). Useful to see what other editors — human or agent — changed.",
      inputSchema: { boardId: z.string(), limit: z.number().int().positive().max(1000).optional() }
    },
    async ({ boardId, limit }) => text(await store.readOpLog(boardId, limit ?? 100))
  );

  registerTool(
    "export_page_svg",
    {
      title: "Export page SVG",
      description: "Export a whole page (artboards + connectors) as one SVG file.",
      inputSchema: { boardId: z.string(), pageId: z.string().optional() }
    },
    async ({ boardId, pageId }) => text({ ...(await store.exportPageSvg(boardId, pageId)), layout: layoutDiagnosticsFor(await store.readBoard(boardId)) })
  );

  registerTool(
    "export_page_pdf",
    {
      title: "Export page PDF",
      description: "Export a whole page (artboards + connectors) as a single-page PDF.",
      inputSchema: { boardId: z.string(), pageId: z.string().optional() }
    },
    async ({ boardId, pageId }) => text({ ...(await store.exportPagePdf(boardId, pageId)), layout: layoutDiagnosticsFor(await store.readBoard(boardId)) })
  );

  registerTool(
    "export_mermaid",
    {
      title: "Export Mermaid",
      description: "Export the board's connectors + diagram nodes as a Mermaid flowchart (.mmd).",
      inputSchema: { boardId: z.string() }
    },
    async ({ boardId }) => text(await store.exportMermaid(boardId))
  );

  registerTool(
    "import_screenshot_overlay",
    {
      title: "Import screenshot overlay",
      description: "Create a locked screenshot overlay. If dataUrl/fileName are provided, the asset is saved first.",
      inputSchema: {
        boardId: z.string(),
        artboardId: z.string(),
        assetId: z.string().optional(),
        dataUrl: z.string().optional(),
        fileName: z.string().optional(),
        x: z.number().default(0),
        y: z.number().default(0),
        width: z.number().optional(),
        height: z.number().optional(),
        opacity: z.number().min(0).max(1).default(0.65)
      }
    },
    async ({ boardId, artboardId, assetId, dataUrl, fileName, x, y, width, height, opacity }) => {
      let finalAssetId = assetId;
      if (!finalAssetId && dataUrl && fileName) {
        const saved = await store.saveAsset(boardId, { dataUrl, fileName });
        finalAssetId = saved.assetId;
      }
      if (!finalAssetId) {
        throw new Error("Provide assetId or dataUrl + fileName.");
      }
      const board = await store.readBoard(boardId);
      const artboard = board.artboards.find((candidate) => candidate.id === artboardId);
      if (!artboard) throw new Error(`Artboard not found: ${artboardId}`);
      const element = BoardElementSchema.parse({
        id: createId("screenshot"),
        type: "screenshotOverlay",
        name: "Screenshot overlay",
        artboardId,
        parentId: null,
        x,
        y,
        width: width ?? artboard.width,
        height: height ?? artboard.height,
        zIndex: 0,
        locked: true,
        visible: true,
        semanticRole: "screenshot overlay",
        style: { radius: 0, opacity, imageFit: "contain" },
        layout: { mode: "absolute" },
        props: { assetId: finalAssetId, alt: "Imported screenshot overlay" }
      });
      const project = await applyAgentOperation(boardId, { type: "add_element", element });
      return text(project);
    }
  );

  registerTool(
    "export_artboard_png",
    {
      title: "Export artboard PNG",
      description:
        "Export an artboard to a PNG under the board exports folder, including the connectors inside that artboard. Rasterizes at 2x by default for print/deck use — pass scale 1 for a screen-size image, up to 4 for large-format print. " +
        "The result carries the board's layout diagnostics: if `layout.clean` is false, the image has visible problems (lines through nodes, overlaps, clipped elements) — run polish_layout and export again.",
      inputSchema: { boardId: z.string(), artboardId: z.string(), scale: z.number().min(1).max(4).optional() }
    },
    async ({ boardId, artboardId, scale }) => text({ ...(await store.exportArtboardPng(boardId, artboardId, { scale })), layout: layoutDiagnosticsFor(await store.readBoard(boardId)) })
  );

  registerTool(
    "export_react_tailwind",
    {
      title: "Export React Tailwind",
      description: "Export board artboards as implementation-ready React + Tailwind files.",
      inputSchema: { boardId: z.string() }
    },
    async ({ boardId }) => text(await store.exportReactTailwind(boardId))
  );

  registerTool(
    "export_board_spec",
    {
      title: "Export board spec",
      description: "Export a Markdown implementation spec plus JSON summary.",
      inputSchema: { boardId: z.string() }
    },
    async ({ boardId }) => text(await store.exportSpec(boardId))
  );

  registerTool(
    "validate_board",
    {
      title: "Validate board",
      description:
        "Validate a board file by id, or validate a provided project object. Reports structural problems (ids, parent cycles, missing roles) AND layout problems that make a diagram unpresentable: " +
        "connector-crosses-element, connector-endpoints-collide, elements-overlap, element-outside-artboard. " +
        "Clear the layout warnings before exporting a poster — they are exactly what makes an otherwise valid board look wrong.",
      inputSchema: {
        boardId: z.string().optional(),
        project: z.unknown().optional()
      }
    },
    async ({ boardId, project }) => {
      if (project !== undefined) {
        const parsed = BoardProjectSchema.parse(project);
        return text({ id: parsed.id, name: parsed.name, ...validateBoardStructure(parsed) });
      }
      const parsed = await store.readBoard(required(boardId, "boardId"));
      return text({ id: parsed.id, name: parsed.name, ...(await store.validateBoard(parsed.id)) });
    }
  );

  return server;
}

export function operationFromUnknown(value: unknown): BoardOperation {
  return value as BoardOperation;
}

function text(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
      }
    ]
  };
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name} is required.`);
  }
  return value;
}
