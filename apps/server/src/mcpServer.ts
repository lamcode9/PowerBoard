import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { ArtboardSchema, BoardElementSchema, BoardOperation, BoardProjectSchema, ConnectorSchema, createElementFromPreset, createId } from "@powerboard/schema";
import { BoardStore } from "./boardService.js";

interface BoardMcpOptions {
  onBoardChanged?: (boardId: string) => Promise<void> | void;
}

export function createBoardMcpServer(store: BoardStore, options: BoardMcpOptions = {}): McpServer {
  const server = new McpServer({
    name: "powerboard",
    version: "0.1.0"
  });

  const changed = async (boardId: string) => {
    await options.onBoardChanged?.(boardId);
  };

  server.registerTool(
    "list_boards",
    {
      title: "List boards",
      description: "List PowerBoard board projects from the configured source of truth. In cloud mode, this is Supabase."
    },
    async () => text(await store.listBoards())
  );

  server.registerTool(
    "read_board",
    {
      title: "Read board",
      description: "Read a board project as JSON.",
      inputSchema: { boardId: z.string() }
    },
    async ({ boardId }) => text(await store.readBoard(boardId))
  );

  server.registerTool(
    "summarize_board",
    {
      title: "Summarize board",
      description: "Summarize artboards, elements, and flows for a board.",
      inputSchema: { boardId: z.string() }
    },
    async ({ boardId }) => text(await store.summarizeBoard(boardId))
  );

  server.registerTool(
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

  server.registerTool(
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
      const project = await store.applyOperation(boardId, { type: "create_artboard", artboard: parsed });
      await changed(boardId);
      return text(project);
    }
  );

  server.registerTool(
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
      const project = await store.applyOperation(boardId, { type: "update_artboard", artboardId, patch });
      await changed(boardId);
      return text(project);
    }
  );

  server.registerTool(
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
      const project = await store.applyOperation(boardId, { type: "create_variant", sourceArtboardId, name, offsetX: offsetX ?? 460 });
      await changed(boardId);
      return text(project);
    }
  );

  server.registerTool(
    "add_element",
    {
      title: "Add element",
      description: "Add a semantic design element to a board. Provide either a full element or a preset type plus artboardId/x/y.",
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
      const project = await store.applyOperation(boardId, { type: "add_element", element: parsed });
      await changed(boardId);
      return text(project);
    }
  );

  server.registerTool(
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
      const project = await store.applyOperation(boardId, { type: "update_element", elementId, patch });
      await changed(boardId);
      return text(project);
    }
  );

  server.registerTool(
    "delete_element",
    {
      title: "Delete element",
      description: "Delete an element and its descendants.",
      inputSchema: { boardId: z.string(), elementId: z.string() }
    },
    async ({ boardId, elementId }) => {
      const project = await store.applyOperation(boardId, { type: "delete_element", elementId });
      await changed(boardId);
      return text(project);
    }
  );

  server.registerTool(
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
      const project = await store.applyOperation(boardId, { type: "move_resize_element", elementId, x, y, width, height });
      await changed(boardId);
      return text(project);
    }
  );

  server.registerTool(
    "get_selection",
    {
      title: "Get selection",
      description: "Get the browser's current selected ids for a board.",
      inputSchema: { boardId: z.string() }
    },
    async ({ boardId }) => text({ boardId, selection: store.getSelection(boardId) })
  );

  server.registerTool(
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
      await changed(boardId);
      return text(project.selection);
    }
  );

  server.registerTool(
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

  server.registerTool(
    "add_connector",
    {
      title: "Add connector",
      description: "Connect two artboards in the app flow.",
      inputSchema: {
        boardId: z.string(),
        connector: z.unknown()
      }
    },
    async ({ boardId, connector }) => {
      const parsed = ConnectorSchema.parse(connector);
      const project = await store.applyOperation(boardId, { type: "add_connector", connector: parsed });
      await changed(boardId);
      return text(project);
    }
  );

  server.registerTool(
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
      const project = await store.applyOperation(boardId, { type: "add_element", element });
      await changed(boardId);
      return text(project);
    }
  );

  server.registerTool(
    "export_artboard_png",
    {
      title: "Export artboard PNG",
      description: "Export an artboard to a PNG file under the board exports folder.",
      inputSchema: { boardId: z.string(), artboardId: z.string() }
    },
    async ({ boardId, artboardId }) => text(await store.exportArtboardPng(boardId, artboardId))
  );

  server.registerTool(
    "export_react_tailwind",
    {
      title: "Export React Tailwind",
      description: "Export board artboards as implementation-ready React + Tailwind files.",
      inputSchema: { boardId: z.string() }
    },
    async ({ boardId }) => text(await store.exportReactTailwind(boardId))
  );

  server.registerTool(
    "export_board_spec",
    {
      title: "Export board spec",
      description: "Export a Markdown implementation spec plus JSON summary.",
      inputSchema: { boardId: z.string() }
    },
    async ({ boardId }) => text(await store.exportSpec(boardId))
  );

  server.registerTool(
    "validate_board",
    {
      title: "Validate board",
      description: "Validate a board file by id, or validate a provided project object.",
      inputSchema: {
        boardId: z.string().optional(),
        project: z.unknown().optional()
      }
    },
    async ({ boardId, project }) => {
      const parsed = BoardProjectSchema.parse(project ?? (await store.readBoard(required(boardId, "boardId"))));
      return text({ valid: true, id: parsed.id, artboards: parsed.artboards.length, elements: parsed.elements.length });
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
