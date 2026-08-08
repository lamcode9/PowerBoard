import { z } from "zod";
// Geometry lives in ./connector.ts; it imports only types back, so this stays a one-way runtime edge.
import {
  connectorAnchorSlots,
  connectorEndpointRect,
  connectorGeometry,
  connectorLabelPoint,
  connectorLabelWidth,
  wrapTextToWidth,
  connectorObstacleElements,
  elementWorldRect,
  rectsNest,
  rectsOverlap,
  segmentIntersectsRect
} from "./connector.js";

export const POWERBOARD_SCHEMA_VERSION = 1;

export const artboardTypes = ["mobile", "tablet", "desktop", "web", "custom"] as const;
export const elementTypes = [
  "frame",
  "group",
  "rect",
  "text",
  "image",
  "icon",
  "line",
  "button",
  "input",
  "list",
  "card",
  "dialog",
  "sheet",
  "nav",
  "tabbar",
  "chart",
  "sparkline",
  "badge",
  "emptyState",
  "paywall",
  "table",
  "sticky",
  "screenshotOverlay",
  "shape",
  "ink"
] as const;

// Diagram shape kinds (decision D5: diagrams are element types on the same model, not a fork).
export const shapeKinds = [
  "rectangle",
  "rounded",
  "ellipse",
  "diamond",
  "parallelogram",
  "cylinder",
  "hexagon",
  "triangle",
  "star",
  "cloud",
  "document",
  "arrow-right"
] as const;

/** House grid. Every polished coordinate lands on a multiple of this. */
export const POLISH_GRID = 8;
/** Nodes whose centres sit within this many px are treated as one row/column. */
export const POLISH_TOLERANCE = 28;

export const strokeStyles = ["solid", "dashed", "dotted"] as const;
export type StrokeStyle = (typeof strokeStyles)[number];

export const connectorPorts = ["auto", "n", "s", "e", "w"] as const;
export const connectorRoutings = ["straight", "orthogonal", "curved"] as const;
export const connectorArrowheads = ["none", "arrow", "triangle", "dot", "diamond"] as const;

export const layoutModes = ["absolute", "stack", "grid", "constraints"] as const;

export const DevicePresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(artboardTypes),
  width: z.number().positive(),
  height: z.number().positive(),
  safeAreaTop: z.number().nonnegative().default(0),
  safeAreaBottom: z.number().nonnegative().default(0)
});

export type DevicePreset = z.infer<typeof DevicePresetSchema>;

export const DEVICE_PRESETS = [
  { id: "iphone-se", name: "iPhone SE", type: "mobile", width: 375, height: 667, safeAreaTop: 20, safeAreaBottom: 0 },
  { id: "iphone-13-mini", name: "iPhone 13 Mini", type: "mobile", width: 375, height: 812, safeAreaTop: 50, safeAreaBottom: 34 },
  { id: "iphone-15", name: "iPhone 15", type: "mobile", width: 393, height: 852, safeAreaTop: 54, safeAreaBottom: 34 },
  { id: "iphone-15-pro", name: "iPhone 15 Pro", type: "mobile", width: 393, height: 852, safeAreaTop: 59, safeAreaBottom: 34 },
  { id: "iphone-15-plus", name: "iPhone 15 Plus", type: "mobile", width: 430, height: 932, safeAreaTop: 54, safeAreaBottom: 34 },
  { id: "iphone-15-pro-max", name: "iPhone 15 Pro Max", type: "mobile", width: 430, height: 932, safeAreaTop: 59, safeAreaBottom: 34 },
  { id: "iphone-16", name: "iPhone 16", type: "mobile", width: 393, height: 852, safeAreaTop: 54, safeAreaBottom: 34 },
  { id: "iphone-16-pro", name: "iPhone 16 Pro", type: "mobile", width: 402, height: 874, safeAreaTop: 62, safeAreaBottom: 34 },
  { id: "iphone-16-plus", name: "iPhone 16 Plus", type: "mobile", width: 430, height: 932, safeAreaTop: 54, safeAreaBottom: 34 },
  { id: "iphone-16-pro-max", name: "iPhone 16 Pro Max", type: "mobile", width: 440, height: 956, safeAreaTop: 62, safeAreaBottom: 34 },
  { id: "pixel-8", name: "Pixel 8", type: "mobile", width: 412, height: 915, safeAreaTop: 28, safeAreaBottom: 24 },
  { id: "pixel-8-pro", name: "Pixel 8 Pro", type: "mobile", width: 448, height: 998, safeAreaTop: 28, safeAreaBottom: 24 },
  { id: "pixel-9", name: "Pixel 9", type: "mobile", width: 412, height: 915, safeAreaTop: 28, safeAreaBottom: 24 },
  { id: "pixel-9-pro-xl", name: "Pixel 9 Pro XL", type: "mobile", width: 448, height: 998, safeAreaTop: 28, safeAreaBottom: 24 },
  { id: "galaxy-s24", name: "Galaxy S24", type: "mobile", width: 360, height: 780, safeAreaTop: 24, safeAreaBottom: 24 },
  { id: "galaxy-s24-ultra", name: "Galaxy S24 Ultra", type: "mobile", width: 384, height: 824, safeAreaTop: 24, safeAreaBottom: 24 },
  { id: "android-compact", name: "Android Compact", type: "mobile", width: 360, height: 800, safeAreaTop: 24, safeAreaBottom: 24 },
  { id: "android-large", name: "Android Large", type: "mobile", width: 432, height: 936, safeAreaTop: 24, safeAreaBottom: 24 },
  { id: "ipad", name: "iPad", type: "tablet", width: 820, height: 1180, safeAreaTop: 24, safeAreaBottom: 20 },
  { id: "ipad-mini", name: "iPad Mini", type: "tablet", width: 744, height: 1133, safeAreaTop: 24, safeAreaBottom: 20 },
  { id: "ipad-air-11", name: "iPad Air 11", type: "tablet", width: 820, height: 1180, safeAreaTop: 24, safeAreaBottom: 20 },
  { id: "ipad-pro-11", name: "iPad Pro 11", type: "tablet", width: 834, height: 1194, safeAreaTop: 24, safeAreaBottom: 20 },
  { id: "ipad-pro-13", name: "iPad Pro 13", type: "tablet", width: 1032, height: 1376, safeAreaTop: 24, safeAreaBottom: 20 },
  { id: "surface-pro", name: "Surface Pro", type: "tablet", width: 912, height: 1368, safeAreaTop: 0, safeAreaBottom: 0 },
  { id: "tablet-landscape", name: "Tablet Landscape", type: "tablet", width: 1180, height: 820, safeAreaTop: 0, safeAreaBottom: 0 },
  { id: "macbook-air", name: "MacBook Air 13", type: "desktop", width: 1280, height: 832, safeAreaTop: 0, safeAreaBottom: 0 },
  { id: "macbook-pro-14", name: "MacBook Pro 14", type: "desktop", width: 1512, height: 982, safeAreaTop: 0, safeAreaBottom: 0 },
  { id: "desktop-1280", name: "Desktop 1280", type: "desktop", width: 1280, height: 900, safeAreaTop: 0, safeAreaBottom: 0 },
  { id: "desktop-1440", name: "Desktop 1440", type: "desktop", width: 1440, height: 1024, safeAreaTop: 0, safeAreaBottom: 0 },
  { id: "desktop-1728", name: "Desktop 1728", type: "desktop", width: 1728, height: 1117, safeAreaTop: 0, safeAreaBottom: 0 },
  { id: "desktop-1920", name: "Desktop 1920", type: "desktop", width: 1920, height: 1080, safeAreaTop: 0, safeAreaBottom: 0 },
  { id: "web-mobile", name: "Responsive Web Mobile", type: "web", width: 390, height: 844, safeAreaTop: 0, safeAreaBottom: 0 },
  { id: "web-tablet", name: "Responsive Web Tablet", type: "web", width: 768, height: 1024, safeAreaTop: 0, safeAreaBottom: 0 },
  { id: "web-landing", name: "Web 1200", type: "web", width: 1200, height: 800, safeAreaTop: 0, safeAreaBottom: 0 },
  { id: "web-dashboard", name: "Web Dashboard 1440", type: "web", width: 1440, height: 900, safeAreaTop: 0, safeAreaBottom: 0 },
  { id: "web-wide", name: "Web Wide 1600", type: "web", width: 1600, height: 1000, safeAreaTop: 0, safeAreaBottom: 0 },
  { id: "app-store-phone", name: "App Store Phone Shot", type: "custom", width: 1290, height: 2796, safeAreaTop: 0, safeAreaBottom: 0 },
  { id: "play-store-phone", name: "Play Store Phone Shot", type: "custom", width: 1080, height: 1920, safeAreaTop: 0, safeAreaBottom: 0 },
  { id: "square-social", name: "Square Social", type: "custom", width: 1080, height: 1080, safeAreaTop: 0, safeAreaBottom: 0 },
  { id: "story-social", name: "Story Social", type: "custom", width: 1080, height: 1920, safeAreaTop: 0, safeAreaBottom: 0 }
] satisfies DevicePreset[];

const Numberish = z.number().finite();

export const BoardStyleSchema = z.object({
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: Numberish.nonnegative().optional(),
  // One line-style property for every stroked thing — connectors, shape/frame/rect outlines.
  // Diagrams need "this edge is a dotted-line relationship" as a first-class idea, not a colour hint.
  strokeStyle: z.enum(strokeStyles).optional(),
  color: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  radius: Numberish.nonnegative().optional(),
  shadow: z.string().optional(),
  blur: Numberish.nonnegative().optional(),
  fontFamily: z.string().optional(),
  fontSize: Numberish.positive().optional(),
  fontWeight: z.union([z.string(), z.number()]).optional(),
  lineHeight: Numberish.positive().optional(),
  letterSpacing: Numberish.optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  padding: Numberish.nonnegative().optional(),
  paddingX: Numberish.nonnegative().optional(),
  paddingY: Numberish.nonnegative().optional(),
  gap: Numberish.nonnegative().optional(),
  align: z.enum(["start", "center", "end", "stretch"]).optional(),
  justify: z.enum(["start", "center", "end", "between"]).optional(),
  imageFit: z.enum(["cover", "contain", "fill"]).optional()
});

export type BoardStyle = z.infer<typeof BoardStyleSchema>;

export const ElementLayoutSchema = z.object({
  mode: z.enum(layoutModes).default("absolute"),
  direction: z.enum(["row", "column"]).optional(),
  columns: z.number().int().positive().optional(),
  gap: Numberish.nonnegative().optional(),
  padding: Numberish.nonnegative().optional(),
  align: z.enum(["start", "center", "end", "stretch"]).optional(),
  justify: z.enum(["start", "center", "end", "between"]).optional()
});

export type ElementLayout = z.infer<typeof ElementLayoutSchema>;

/**
 * Patch shape for `set_layout`. Spelled out rather than `ElementLayoutSchema.partial()` because
 * `.partial()` leaves the inner `.default("absolute")` on `mode` in place, so a patch of `{gap: 20}`
 * parsed into `{mode: "absolute", gap: 20}` and silently un-stacked the frame it was tuning.
 */
export const ElementLayoutPatchSchema = z.object({
  mode: z.enum(layoutModes).optional(),
  direction: z.enum(["row", "column"]).optional(),
  columns: z.number().int().positive().optional(),
  gap: Numberish.nonnegative().optional(),
  padding: Numberish.nonnegative().optional(),
  align: z.enum(["start", "center", "end", "stretch"]).optional(),
  justify: z.enum(["start", "center", "end", "between"]).optional()
});

/**
 * Auto-layout, one implementation (D-a). A `stack` parent owns its children's x/y — they become derived
 * state, recomputed at the single write chokepoint in `applyBoardOperation` rather than resolved lazily by
 * each consumer. Canvas, SVG, React, connector geometry and layout diagnostics all keep reading plain x/y
 * and therefore cannot disagree with each other; the alternative (every consumer learns about layout) is
 * exactly how the canvas and the SVG exporter came to disagree about text wrapping.
 *
 * Order is `zIndex` ascending (D-b) — what the renderers already sort by, so canvas, export and layer tree
 * agree for free. Hidden children take no space (D-c), matching Figma and CSS `display:none`. `grid` and
 * `constraints` remain inert schema slots: they are not built, and pretending otherwise is what made
 * `stack` a lie for so long.
 */
export function resolveStackChildren(
  parent: Pick<BoardElement, "width" | "height" | "layout">,
  children: BoardElement[]
): Map<string, { x: number; y: number; width: number; height: number }> {
  const placed = new Map<string, { x: number; y: number; width: number; height: number }>();
  const laid = children.filter((child) => child.visible).sort((a, b) => a.zIndex - b.zIndex);
  if (!laid.length) return placed;

  const layout = parent.layout;
  const row = layout.direction === "row";
  const padding = layout.padding ?? 0;
  const gap = layout.gap ?? 0;
  const align = layout.align ?? "start";
  const justify = layout.justify ?? "start";

  const mainAvailable = (row ? parent.width : parent.height) - padding * 2;
  const crossAvailable = (row ? parent.height : parent.width) - padding * 2;
  const mainSizes = laid.map((child) => (row ? child.width : child.height));
  const totalMain = mainSizes.reduce((sum, size) => sum + size, 0);

  // `between` spends the slack on the gaps; every other mode keeps the gap and moves the block.
  const spreadGap =
    justify === "between" && laid.length > 1 ? Math.max(gap, (mainAvailable - totalMain) / (laid.length - 1)) : gap;
  const contentMain = totalMain + spreadGap * (laid.length - 1);
  let cursor = padding;
  if (justify === "center") cursor = padding + (mainAvailable - contentMain) / 2;
  else if (justify === "end") cursor = padding + (mainAvailable - contentMain);

  for (const child of laid) {
    const mainSize = row ? child.width : child.height;
    let crossSize = row ? child.height : child.width;
    let crossOffset = padding;
    if (align === "stretch") crossSize = Math.max(1, crossAvailable);
    else if (align === "center") crossOffset = padding + (crossAvailable - crossSize) / 2;
    else if (align === "end") crossOffset = padding + (crossAvailable - crossSize);

    placed.set(child.id, {
      x: round2(row ? cursor : crossOffset),
      y: round2(row ? crossOffset : cursor),
      width: round2(row ? child.width : crossSize),
      height: round2(row ? crossSize : child.height)
    });
    cursor += mainSize + spreadGap;
  }
  return placed;
}

/**
 * Apply every `stack` parent's layout to its children, outermost first so a nested stack is positioned
 * inside an already-placed parent. Called once at the end of `applyBoardOperation`; safe to call on any
 * project (a board with no stacks is untouched).
 */
export function reflowStackLayouts(project: BoardProject): void {
  const childrenByParent = new Map<string, BoardElement[]>();
  for (const element of project.elements) {
    if (!element.parentId) continue;
    const siblings = childrenByParent.get(element.parentId) ?? [];
    siblings.push(element);
    childrenByParent.set(element.parentId, siblings);
  }

  const depth = (element: BoardElement): number => {
    let steps = 0;
    let parentId = element.parentId;
    const seen = new Set<string>([element.id]);
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      steps++;
      parentId = project.elements.find((candidate) => candidate.id === parentId)?.parentId ?? null;
    }
    return steps;
  };

  const stacks = project.elements
    .filter((element) => element.layout.mode === "stack" && childrenByParent.has(element.id))
    .sort((a, b) => depth(a) - depth(b));

  for (const parent of stacks) {
    const placed = resolveStackChildren(parent, childrenByParent.get(parent.id) ?? []);
    for (const child of childrenByParent.get(parent.id) ?? []) {
      const frame = placed.get(child.id);
      if (!frame) continue;
      child.x = frame.x;
      child.y = frame.y;
      child.width = frame.width;
      child.height = frame.height;
    }
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const AssetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  src: z.string().min(1)
});

export type BoardAsset = z.infer<typeof AssetSchema>;

export const ArtboardSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(artboardTypes),
  x: Numberish,
  y: Numberish,
  width: Numberish.positive(),
  height: Numberish.positive(),
  background: z.string().default("#F7F8FA"),
  devicePreset: z.string().optional(),
  // Frameless artboards render without device chrome/shadow — diagram canvases, sections.
  frameless: z.boolean().default(false),
  locked: z.boolean().default(false),
  visible: z.boolean().default(true)
});

export type Artboard = z.infer<typeof ArtboardSchema>;

export const BoardElementSchema = z.object({
  id: z.string().min(1),
  type: z.enum(elementTypes),
  name: z.string().min(1),
  artboardId: z.string().min(1),
  parentId: z.string().nullable().default(null),
  x: Numberish,
  y: Numberish,
  width: Numberish.positive(),
  height: Numberish.positive(),
  zIndex: z.number().int().default(0),
  locked: z.boolean().default(false),
  visible: z.boolean().default(true),
  semanticRole: z.string().optional(),
  style: BoardStyleSchema.default({}),
  layout: ElementLayoutSchema.default({ mode: "absolute" }),
  props: z.record(z.string(), z.unknown()).default({})
});

export type BoardElement = z.infer<typeof BoardElementSchema>;

// Connector v2: one connector system for app flows AND diagram edges (D5). Ports pin the
// endpoint to a side; waypoints are user-dragged elbow points in page coordinates.
export const ConnectorSchema = z.object({
  id: z.string().min(1),
  fromArtboardId: z.string().min(1),
  toArtboardId: z.string().min(1),
  fromElementId: z.string().optional(),
  toElementId: z.string().optional(),
  fromPort: z.enum(connectorPorts).default("auto"),
  toPort: z.enum(connectorPorts).default("auto"),
  routing: z.enum(connectorRoutings).default("curved"),
  arrowStart: z.enum(connectorArrowheads).default("none"),
  arrowEnd: z.enum(connectorArrowheads).default("arrow"),
  waypoints: z.array(z.object({ x: Numberish, y: Numberish })).default([]),
  // Elbow softening for orthogonal routes. Undefined = the CONNECTOR_CORNER_RADIUS house default;
  // 0 = hard corners for schematic/technical diagrams that want them.
  cornerRadius: Numberish.nonnegative().optional(),
  label: z.string().optional(),
  labelPosition: z.number().min(0).max(1).default(0.5),
  style: BoardStyleSchema.default({})
});

export type BoardConnector = z.infer<typeof ConnectorSchema>;

export const commentAuthorKinds = ["user", "agent"] as const;

export const CommentMessageSchema = z.object({
  id: z.string().min(1),
  author: z.string().min(1),
  authorKind: z.enum(commentAuthorKinds).default("user"),
  text: z.string().min(1).max(4000),
  createdAt: z.string()
});

export type CommentMessage = z.infer<typeof CommentMessageSchema>;

// Comments are annotations, not canvas objects: a thread anchors to one element, carries a flat
// message list, and never appears in any export (renderers iterate elements + connectors only).
// They are the human↔agent feedback channel — an agent reads them over MCP, fixes, replies, resolves.
export const CommentThreadSchema = z.object({
  id: z.string().min(1),
  elementId: z.string().min(1),
  resolved: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(CommentMessageSchema).min(1)
});

export type CommentThread = z.infer<typeof CommentThreadSchema>;

export const DesignTokensSchema = z.object({
  colors: z.record(z.string(), z.string()).default({}),
  fonts: z.record(z.string(), z.string()).default({}),
  radii: z.record(z.string(), z.number()).default({}),
  shadows: z.record(z.string(), z.string()).default({}),
  spacing: z.record(z.string(), z.number()).default({})
});

export type DesignTokens = z.infer<typeof DesignTokensSchema>;

export const BoardProjectSchema = z
  .object({
    schemaVersion: z.literal(POWERBOARD_SCHEMA_VERSION),
    id: z.string().min(1),
    name: z.string().min(1),
    pages: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          artboardIds: z.array(z.string()).default([])
        })
      )
      .default([{ id: "page_main", name: "Main", artboardIds: [] }]),
    artboards: z.array(ArtboardSchema).default([]),
    elements: z.array(BoardElementSchema).default([]),
    connectors: z.array(ConnectorSchema).default([]),
    // No schemaVersion bump: `.default([])` is the migration — every stored board parses forward.
    comments: z.array(CommentThreadSchema).default([]),
    assets: z.array(AssetSchema).default([]),
    tokens: DesignTokensSchema.default({ colors: {}, fonts: {}, radii: {}, shadows: {}, spacing: {} }),
    selection: z.array(z.string()).default([]),
    metadata: z
      .object({
        createdAt: z.string(),
        updatedAt: z.string(),
        createdBy: z.string().default("PowerBoard")
      })
      .passthrough()
  })
  .superRefine((project, ctx) => {
    const ids = new Set<string>();
    const checkUnique = (id: string, path: (string | number)[]) => {
      if (ids.has(id)) {
        ctx.addIssue({ code: "custom", message: `Duplicate id: ${id}`, path });
      }
      ids.add(id);
    };

    project.artboards.forEach((artboard, index) => checkUnique(artboard.id, ["artboards", index, "id"]));
    project.elements.forEach((element, index) => checkUnique(element.id, ["elements", index, "id"]));
    project.connectors.forEach((connector, index) => checkUnique(connector.id, ["connectors", index, "id"]));
    project.assets.forEach((asset, index) => checkUnique(asset.id, ["assets", index, "id"]));
    project.comments.forEach((thread, index) => {
      checkUnique(thread.id, ["comments", index, "id"]);
      thread.messages.forEach((message, messageIndex) => checkUnique(message.id, ["comments", index, "messages", messageIndex, "id"]));
    });

    const artboardIds = new Set(project.artboards.map((artboard) => artboard.id));
    const elementIds = new Set(project.elements.map((element) => element.id));
    const assetIds = new Set(project.assets.map((asset) => asset.id));

    project.pages.forEach((page, pageIndex) => {
      page.artboardIds.forEach((artboardId, artboardIndex) => {
        if (!artboardIds.has(artboardId)) {
          ctx.addIssue({
            code: "custom",
            message: `Unknown artboard id: ${artboardId}`,
            path: ["pages", pageIndex, "artboardIds", artboardIndex]
          });
        }
      });
    });

    project.elements.forEach((element, index) => {
      if (!artboardIds.has(element.artboardId)) {
        ctx.addIssue({ code: "custom", message: `Unknown artboard id: ${element.artboardId}`, path: ["elements", index, "artboardId"] });
      }
      if (element.parentId && !elementIds.has(element.parentId)) {
        ctx.addIssue({ code: "custom", message: `Unknown parent id: ${element.parentId}`, path: ["elements", index, "parentId"] });
      }
      if ((element.type === "image" || element.type === "screenshotOverlay") && typeof element.props.assetId === "string" && !assetIds.has(element.props.assetId)) {
        ctx.addIssue({ code: "custom", message: `Unknown asset id: ${element.props.assetId}`, path: ["elements", index, "props", "assetId"] });
      }
    });

    project.connectors.forEach((connector, index) => {
      if (!artboardIds.has(connector.fromArtboardId)) {
        ctx.addIssue({ code: "custom", message: `Unknown from artboard id: ${connector.fromArtboardId}`, path: ["connectors", index, "fromArtboardId"] });
      }
      if (!artboardIds.has(connector.toArtboardId)) {
        ctx.addIssue({ code: "custom", message: `Unknown to artboard id: ${connector.toArtboardId}`, path: ["connectors", index, "toArtboardId"] });
      }
      if (connector.fromElementId && !elementIds.has(connector.fromElementId)) {
        ctx.addIssue({ code: "custom", message: `Unknown from element id: ${connector.fromElementId}`, path: ["connectors", index, "fromElementId"] });
      }
      if (connector.toElementId && !elementIds.has(connector.toElementId)) {
        ctx.addIssue({ code: "custom", message: `Unknown to element id: ${connector.toElementId}`, path: ["connectors", index, "toElementId"] });
      }
    });

    project.comments.forEach((thread, index) => {
      if (!elementIds.has(thread.elementId)) {
        ctx.addIssue({ code: "custom", message: `Unknown element id: ${thread.elementId}`, path: ["comments", index, "elementId"] });
      }
    });
  });

export type BoardProject = z.infer<typeof BoardProjectSchema>;

export type BoardValidationSeverity = "error" | "warning";

export interface BoardValidationIssue {
  severity: BoardValidationSeverity;
  code: string;
  message: string;
  artboardId?: string;
  elementId?: string;
  parentId?: string;
}

export interface BoardHierarchyNode {
  id: string;
  name: string;
  type: BoardElement["type"];
  semanticRole?: string;
  path: string;
  depth: number;
  artboardId: string;
  parentId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  locked: boolean;
  visible: boolean;
  children: BoardHierarchyNode[];
}

export interface BoardHierarchyArtboard {
  id: string;
  name: string;
  type: Artboard["type"];
  path: string;
  width: number;
  height: number;
  locked: boolean;
  visible: boolean;
  children: BoardHierarchyNode[];
}

export interface BoardValidationReport {
  valid: boolean;
  summary: {
    errors: number;
    warnings: number;
  };
  issues: BoardValidationIssue[];
  hierarchy: BoardHierarchyArtboard[];
}

export const OperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_artboard"), artboard: ArtboardSchema }),
  z.object({ type: z.literal("update_artboard"), artboardId: z.string(), patch: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("create_variant"), sourceArtboardId: z.string(), artboardId: z.string().optional(), name: z.string().optional(), offsetX: z.number().default(460) }),
  z.object({ type: z.literal("add_element"), element: BoardElementSchema }),
  z.object({ type: z.literal("update_element"), elementId: z.string(), patch: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("delete_element"), elementId: z.string() }),
  z.object({ type: z.literal("move_resize_element"), elementId: z.string(), x: Numberish.optional(), y: Numberish.optional(), width: Numberish.positive().optional(), height: Numberish.positive().optional() }),
  z.object({ type: z.literal("group_elements"), group: BoardElementSchema, elementIds: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("add_connector"), connector: ConnectorSchema }),
  z.object({ type: z.literal("update_connector"), connectorId: z.string(), patch: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("delete_connector"), connectorId: z.string() }),
  z.object({ type: z.literal("delete_artboard"), artboardId: z.string() }),
  z.object({
    type: z.literal("apply_layout"),
    layout: z.enum([
      "tree",
      "flow",
      "distribute-horizontal",
      "distribute-vertical",
      "align-left",
      "align-center-x",
      "align-right",
      "align-top",
      "align-center-y",
      "align-bottom"
    ]),
    artboardId: z.string().optional(),
    elementIds: z.array(z.string()).optional(),
    spacingX: Numberish.positive().default(80),
    spacingY: Numberish.positive().default(64)
  }),
  z.object({
    type: z.literal("polish_layout"),
    artboardId: z.string().optional(),
    elementIds: z.array(z.string()).optional(),
    grid: Numberish.positive().default(POLISH_GRID),
    /** How far apart two nodes may sit and still be treated as "meant to line up". */
    tolerance: Numberish.positive().default(POLISH_TOLERANCE)
  }),
  // Merging patch on purpose: setting `gap` must not silently clear `direction`, which a wholesale
  // `update_element` layout patch would do.
  z.object({ type: z.literal("set_layout"), elementId: z.string(), layout: ElementLayoutPatchSchema }),
  // Reordering renumbers a whole sibling run, which has to be ONE operation: N `update_element`s would
  // be N undo entries, so a single drag would take N presses of ⌘Z to put back.
  z.object({ type: z.literal("reorder_child"), elementId: z.string(), toIndex: z.number().int().nonnegative() }),
  // Comment ops: annotations, not canvas objects — they never touch `selection`, so leaving a
  // comment mid-edit doesn't yank the user's (or an agent's) selection away.
  z.object({ type: z.literal("add_comment"), thread: CommentThreadSchema }),
  z.object({ type: z.literal("reply_comment"), threadId: z.string(), message: CommentMessageSchema }),
  // One op for resolve AND reopen so both directions share undo, broadcast, and MCP plumbing.
  z.object({ type: z.literal("set_comment_resolved"), threadId: z.string(), resolved: z.boolean() }),
  z.object({ type: z.literal("delete_comment"), threadId: z.string() }),
  z.object({ type: z.literal("set_selection"), selection: z.array(z.string()) })
]);

export type BoardOperation = z.infer<typeof OperationSchema>;

export function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36).slice(-5);
  return `${prefix}_${time}_${random}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

// The one place comment ids + timestamps are stamped, so the browser and the MCP handlers
// cannot drift on shape. `author` defaults to "You" for user comments purely as stored display
// text; agents pass their identity name.
export function createCommentMessage(text: string, author: string, authorKind: CommentMessage["authorKind"]): CommentMessage {
  return CommentMessageSchema.parse({ id: createId("cmsg"), author, authorKind, text, createdAt: nowIso() });
}

export function createCommentThread(elementId: string, text: string, author: string, authorKind: CommentMessage["authorKind"]): CommentThread {
  const at = nowIso();
  return CommentThreadSchema.parse({
    id: createId("comment"),
    elementId,
    resolved: false,
    createdAt: at,
    updatedAt: at,
    messages: [createCommentMessage(text, author, authorKind)]
  });
}

export const boardTemplates = ["blank", "mobile", "web", "diagram", "starter"] as const;
export type BoardTemplate = (typeof boardTemplates)[number];

const DEFAULT_TOKENS = {
  colors: {
    canvas: "#EEF2F7",
    ink: "#101828",
    accent: "#2563EB",
    success: "#059669",
    warning: "#D97706"
  },
  fonts: { sans: "Inter, ui-sans-serif, system-ui" },
  radii: { sm: 8, md: 14, lg: 22 },
  shadows: { panel: "0 18px 50px rgba(15, 23, 42, 0.10)" },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24 }
} as const;

/** Build a minimal board: one artboard (or diagram canvas), no seeded content. */
function createMinimalProject(name: string, template: Exclude<BoardTemplate, "starter">): BoardProject {
  const createdAt = nowIso();
  const artboard: Artboard =
    template === "mobile"
      ? { id: createId("art"), name: "Screen", type: "mobile", x: 160, y: 120, width: 393, height: 852, background: "#FFFFFF", devicePreset: "iphone-15", frameless: false, locked: false, visible: true }
      : template === "web"
        ? { id: createId("art"), name: "Page", type: "web", x: 160, y: 120, width: 1440, height: 900, background: "#FFFFFF", devicePreset: "web-landing", frameless: false, locked: false, visible: true }
        : { id: createId("art"), name: "Canvas", type: "custom", x: 120, y: 96, width: 1800, height: 1200, background: "#FBFCFE", frameless: true, locked: false, visible: true };
  return BoardProjectSchema.parse({
    schemaVersion: POWERBOARD_SCHEMA_VERSION,
    id: "board_default",
    name,
    pages: [{ id: "page_main", name: "Main", artboardIds: [artboard.id] }],
    artboards: [artboard],
    elements: [],
    connectors: [],
    assets: [],
    tokens: DEFAULT_TOKENS,
    selection: [],
    metadata: { createdAt, updatedAt: createdAt, createdBy: "PowerBoard" }
  });
}

export function createDefaultProject(name = "PowerBoard Starter Board", template: BoardTemplate = "starter"): BoardProject {
  if (template !== "starter") return createMinimalProject(name, template);
  const createdAt = nowIso();
  const mobile: Artboard = {
    id: "art_home_mobile",
    name: "Mobile Home",
    type: "mobile",
    x: 120,
    y: 90,
    width: 393,
    height: 852,
    background: "#F5F7FB",
    devicePreset: "iphone-15",
    frameless: false,
    locked: false,
    visible: true
  };
  const desktop: Artboard = {
    id: "art_dashboard_web",
    name: "Web Dashboard",
    type: "web",
    x: 620,
    y: 90,
    width: 1200,
    height: 800,
    background: "#F8FAFC",
    devicePreset: "web-landing",
    frameless: false,
    locked: false,
    visible: true
  };

  const elements: BoardElement[] = [
    {
      id: "el_mobile_header_frame",
      type: "frame",
      name: "Mobile Home / Header Frame",
      artboardId: mobile.id,
      parentId: null,
      x: 24,
      y: 58,
      width: 345,
      height: 64,
      zIndex: 1,
      locked: false,
      visible: true,
      semanticRole: "screen section",
      style: { fill: "transparent", stroke: "#BFDBFE", strokeWidth: 1, radius: 18 },
      layout: { mode: "absolute" },
      props: { hierarchyOnly: true }
    },
    {
      id: "el_mobile_title",
      type: "text",
      name: "Mobile Home / Header Title",
      artboardId: mobile.id,
      parentId: "el_mobile_header_frame",
      x: 4,
      y: 10,
      width: 240,
      height: 44,
      zIndex: 1,
      locked: false,
      visible: true,
      semanticRole: "heading",
      style: { color: "#101828", fontSize: 28, fontWeight: 760, lineHeight: 34 },
      layout: { mode: "absolute" },
      props: { text: "Today" }
    },
    {
      id: "el_mobile_summary_frame",
      type: "frame",
      name: "Mobile Home / Summary Frame",
      artboardId: mobile.id,
      parentId: null,
      x: 24,
      y: 132,
      width: 345,
      height: 152,
      zIndex: 2,
      locked: false,
      visible: true,
      semanticRole: "screen section",
      style: { fill: "transparent", stroke: "#BFDBFE", strokeWidth: 1, radius: 24 },
      layout: { mode: "absolute" },
      props: { hierarchyOnly: true }
    },
    {
      id: "el_mobile_card",
      type: "card",
      name: "Mobile Home / Safe-to-Spend Card",
      artboardId: mobile.id,
      parentId: "el_mobile_summary_frame",
      x: 0,
      y: 0,
      width: 345,
      height: 152,
      zIndex: 1,
      locked: false,
      visible: true,
      semanticRole: "summary card",
      style: { fill: "#FFFFFF", color: "#101828", radius: 24, shadow: "0 18px 50px rgba(15, 23, 42, 0.10)", padding: 22 },
      layout: { mode: "stack", direction: "column", gap: 12 },
      props: { eyebrow: "Safe to spend", title: "$2,480", subtitle: "After bills and savings" }
    },
    {
      id: "el_mobile_action_frame",
      type: "frame",
      name: "Mobile Home / Primary Action Frame",
      artboardId: mobile.id,
      parentId: null,
      x: 24,
      y: 728,
      width: 345,
      height: 96,
      zIndex: 3,
      locked: false,
      visible: true,
      semanticRole: "screen section",
      style: { fill: "transparent", stroke: "#BFDBFE", strokeWidth: 1, radius: 20 },
      layout: { mode: "absolute" },
      props: { hierarchyOnly: true }
    },
    {
      id: "el_mobile_button",
      type: "button",
      name: "Mobile Home / Add Transaction Button",
      artboardId: mobile.id,
      parentId: "el_mobile_action_frame",
      x: 0,
      y: 20,
      width: 345,
      height: 56,
      zIndex: 1,
      locked: false,
      visible: true,
      semanticRole: "primary button",
      style: { fill: "#111827", color: "#FFFFFF", radius: 18, fontSize: 16, fontWeight: 720 },
      layout: { mode: "absolute" },
      props: { text: "Add transaction" }
    },
    {
      id: "el_web_sidebar_frame",
      type: "frame",
      name: "Web Dashboard / Sidebar Frame",
      artboardId: desktop.id,
      parentId: null,
      x: 0,
      y: 0,
      width: 240,
      height: 800,
      zIndex: 1,
      locked: false,
      visible: true,
      semanticRole: "navigation region",
      style: { fill: "transparent" },
      layout: { mode: "absolute" },
      props: { hierarchyOnly: true }
    },
    {
      id: "el_web_nav",
      type: "nav",
      name: "Web Dashboard / Sidebar Nav",
      artboardId: desktop.id,
      parentId: "el_web_sidebar_frame",
      x: 0,
      y: 0,
      width: 240,
      height: 800,
      zIndex: 1,
      locked: false,
      visible: true,
      semanticRole: "side navigation",
      style: { fill: "#101828", color: "#FFFFFF", padding: 24 },
      layout: { mode: "stack", direction: "column", gap: 18 },
      props: { title: "Board", items: ["Canvas", "Components", "Exports"] }
    },
    {
      id: "el_web_content_frame",
      type: "frame",
      name: "Web Dashboard / Main Content Frame",
      artboardId: desktop.id,
      parentId: null,
      x: 264,
      y: 112,
      width: 872,
      height: 420,
      zIndex: 2,
      locked: false,
      visible: true,
      semanticRole: "content region",
      style: { fill: "transparent", stroke: "#BFDBFE", strokeWidth: 1, radius: 24 },
      layout: { mode: "absolute" },
      props: { hierarchyOnly: true }
    },
    {
      id: "el_web_table",
      type: "table",
      name: "Web Dashboard / Work Queue Table",
      artboardId: desktop.id,
      parentId: "el_web_content_frame",
      x: 24,
      y: 36,
      width: 824,
      height: 340,
      zIndex: 1,
      locked: false,
      visible: true,
      semanticRole: "data table",
      style: { fill: "#FFFFFF", color: "#111827", radius: 18, shadow: "0 16px 45px rgba(15, 23, 42, 0.08)", padding: 20 },
      layout: { mode: "stack", direction: "column", gap: 12 },
      props: {
        title: "Implementation queue",
        columns: ["Screen", "Status", "Owner"],
        rows: [
          ["Mobile Home", "Ready", "Codex"],
          ["Paywall", "Draft", "Design"],
          ["Export", "Ready", "Codex"]
        ]
      }
    }
  ];

  return BoardProjectSchema.parse({
    schemaVersion: POWERBOARD_SCHEMA_VERSION,
    id: "board_default",
    name,
    pages: [{ id: "page_main", name: "Main", artboardIds: [mobile.id, desktop.id] }],
    artboards: [mobile, desktop],
    elements,
    connectors: [{ id: "conn_mobile_web", fromArtboardId: mobile.id, toArtboardId: desktop.id, label: "Dashboard handoff", style: { stroke: "#2563EB" } }],
    assets: [],
    tokens: DEFAULT_TOKENS,
    selection: [],
    metadata: { createdAt, updatedAt: createdAt, createdBy: "PowerBoard" }
  });
}

export function validateBoardProject(input: unknown): BoardProject {
  return BoardProjectSchema.parse(input);
}

export function validateBoardStructure(input: BoardProject): BoardValidationReport {
  const project = BoardProjectSchema.parse(input);
  const issues: BoardValidationIssue[] = [];
  const artboardIds = new Set(project.artboards.map((artboard) => artboard.id));
  const elementById = new Map(project.elements.map((element) => [element.id, element]));
  const pagedArtboardIds = new Set(project.pages.flatMap((page) => page.artboardIds));
  const seenPageArtboardIds = new Set<string>();

  for (const page of project.pages) {
    for (const artboardId of page.artboardIds) {
      if (seenPageArtboardIds.has(artboardId)) {
        issues.push({
          severity: "warning",
          code: "artboard-on-multiple-pages",
          message: `Artboard appears more than once in pages: ${artboardId}`,
          artboardId
        });
      }
      seenPageArtboardIds.add(artboardId);
    }
  }

  for (const artboard of project.artboards) {
    if (!pagedArtboardIds.has(artboard.id)) {
      issues.push({
        severity: "warning",
        code: "artboard-not-on-page",
        message: `Artboard is valid but not reachable from any page: ${artboard.name}`,
        artboardId: artboard.id
      });
    }
  }

  for (const element of project.elements) {
    if (!artboardIds.has(element.artboardId)) continue;
    if (!readNonEmptyString(element.semanticRole)) {
      issues.push({
        severity: "warning",
        code: "missing-semantic-role",
        message: `Element has no semantic role: ${element.name}`,
        artboardId: element.artboardId,
        elementId: element.id
      });
    }

    if (element.parentId) {
      const parent = elementById.get(element.parentId);
      if (parent && parent.artboardId !== element.artboardId) {
        issues.push({
          severity: "error",
          code: "parent-on-different-artboard",
          message: `Element parent is on a different artboard: ${element.name}`,
          artboardId: element.artboardId,
          elementId: element.id,
          parentId: parent.id
        });
      }
      if (hasParentCycle(element, elementById)) {
        issues.push({
          severity: "error",
          code: "cyclic-parent-chain",
          message: `Element parent chain contains a cycle: ${element.name}`,
          artboardId: element.artboardId,
          elementId: element.id,
          parentId: element.parentId
        });
      }
    }

    if (element.type === "icon" && !readNonEmptyString(element.props.materialIcon ?? element.props.icon)) {
      issues.push({
        severity: "warning",
        code: "icon-missing-material-name",
        message: `Icon is missing props.materialIcon: ${element.name}`,
        artboardId: element.artboardId,
        elementId: element.id
      });
    }

    if (element.type === "line") {
      const direction = readNonEmptyString(element.props.direction) ?? "horizontal";
      if (!["horizontal", "vertical", "diagonal-up", "diagonal-down"].includes(direction)) {
        issues.push({
          severity: "warning",
          code: "line-unknown-direction",
          message: `Line direction is not recognized: ${direction}`,
          artboardId: element.artboardId,
          elementId: element.id
        });
      }
    }

    if (element.type === "shape") {
      const kind = readNonEmptyString(element.props.shape) ?? "rectangle";
      if (!(shapeKinds as readonly string[]).includes(kind)) {
        issues.push({
          severity: "warning",
          code: "shape-unknown-kind",
          message: `Shape kind is not recognized (falls back to rectangle): ${kind}`,
          artboardId: element.artboardId,
          elementId: element.id
        });
      }
    }

    if (element.type === "ink" && readPointArray(element.props.points).length < 2) {
      issues.push({
        severity: "warning",
        code: "ink-needs-points",
        message: `Ink stroke has fewer than two points: ${element.name}`,
        artboardId: element.artboardId,
        elementId: element.id
      });
    }

    if (element.type === "sparkline" && readNumberArray(element.props.values).length < 2) {
      issues.push({
        severity: "warning",
        code: "sparkline-needs-values",
        message: `Sparkline needs at least two numeric values: ${element.name}`,
        artboardId: element.artboardId,
        elementId: element.id
      });
    }
  }

  issues.push(...layoutDiagnostics(project));

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  return {
    valid: errors === 0,
    summary: { errors, warnings },
    issues,
    hierarchy: inspectBoardHierarchy(project)
  };
}

/**
 * Geometry diagnostics: the difference between a board that parses and a board that presents.
 * Structural validation alone will happily sign off on a diagram whose edges cut through its own
 * nodes — which is exactly how a non-presentation-ready chart gets exported. Everything here is a
 * warning: geometry is judgement, and a deliberate crossing shouldn't fail a board.
 */
function layoutDiagnostics(project: BoardProject): BoardValidationIssue[] {
  const issues: BoardValidationIssue[] = [];
  const artboardById = new Map(project.artboards.map((artboard) => [artboard.id, artboard]));

  // Root elements that stray outside their own artboard get clipped in every export.
  for (const element of project.elements) {
    const artboard = artboardById.get(element.artboardId);
    if (!artboard || element.parentId || !element.visible) continue;
    if (element.x < -1 || element.y < -1 || element.x + element.width > artboard.width + 1 || element.y + element.height > artboard.height + 1) {
      issues.push({
        severity: "warning",
        code: "element-outside-artboard",
        message: `Element extends past its artboard and will be clipped on export: ${element.name}`,
        artboardId: element.artboardId,
        elementId: element.id
      });
    }
  }

  // Diagnose the geometry the renderers will actually draw — same obstacles, same fan-out slots —
  // or validation flags collisions the canvas already resolved.
  const slots = connectorAnchorSlots(project);
  const anchorPoints = new Map<string, string[]>();
  for (const connector of project.connectors) {
    const fromRect = connectorEndpointRect(project, connector.fromArtboardId, connector.fromElementId);
    const toRect = connectorEndpointRect(project, connector.toArtboardId, connector.toElementId);
    if (!fromRect || !toRect) continue;

    const obstacles = connectorObstacleElements(project, connector);
    const geometry = connectorGeometry(fromRect, toRect, connector, {
      obstacles: obstacles.map(({ rect }) => rect),
      toSlot: slots.get(connector.id)
    });
    const blocked = obstacles.filter(({ rect }) =>
      geometry.samples.some((point, index) => index > 0 && segmentIntersectsRect(geometry.samples[index - 1]!, point, rect))
    );
    if (blocked.length) {
      issues.push({
        severity: "warning",
        code: "connector-crosses-element",
        message: `Connector passes through ${blocked.map(({ element }) => element.name).join(", ")}: ${connector.label ?? connector.id}. Move a node, add a waypoint, or re-run apply_layout.`,
        elementId: connector.id
      });
    }

    if (connector.label) {
      const width = connectorLabelWidth(connector.label);
      const placed = connectorLabelPoint(geometry.samples, connector.labelPosition, width, [...obstacles.map(({ rect }) => rect), fromRect, toRect]);
      if (!placed.fits) {
        issues.push({
          severity: "warning",
          code: "connector-label-collides",
          message: `No room on this connector for the label "${connector.label}" — it will overlap a node. Shorten it, space the nodes further apart, or drop the label.`,
          elementId: connector.id
        });
      }
    }

    // Two edges landing on the same pixel read as one edge.
    const key = `${Math.round(geometry.end.x)}:${Math.round(geometry.end.y)}`;
    anchorPoints.set(key, [...(anchorPoints.get(key) ?? []), connector.id]);
  }

  for (const [, connectorIds] of anchorPoints) {
    if (connectorIds.length < 2) continue;
    issues.push({
      severity: "warning",
      code: "connector-endpoints-collide",
      message: `Connectors terminate at the same point and overlap: ${connectorIds.join(", ")}`,
      elementId: connectorIds[0]
    });
  }

  // Sibling nodes that overlap. Containers legitimately enclose their contents, so nesting is fine.
  const roots = project.elements.filter((element) => !element.parentId && element.visible && (element.type === "shape" || element.type === "frame" || element.type === "card" || element.type === "sticky"));
  for (let i = 0; i < roots.length; i++) {
    for (let j = i + 1; j < roots.length; j++) {
      const a = roots[i]!;
      const b = roots[j]!;
      if (a.artboardId !== b.artboardId) continue;
      const rectA = elementWorldRect(project, a);
      const rectB = elementWorldRect(project, b);
      if (!rectA || !rectB) continue;
      if (rectsNest(rectA, rectB)) continue;
      if (rectsOverlap(rectA, rectB, 2)) {
        issues.push({
          severity: "warning",
          code: "elements-overlap",
          message: `Nodes overlap: ${a.name} and ${b.name}`,
          artboardId: a.artboardId,
          elementId: a.id
        });
      }
    }
  }

  issues.push(...textOverflowDiagnostics(project));
  return issues;
}

/**
 * Text that will not fit its own box once wrapped. Deferred until 2026-08-07 because the SVG exporter
 * emitted one unwrapped `<text>` per element, so *every* long label overflowed and the diagnostic would
 * have been noise. Now that the exporters wrap on the same measurement this uses, a hit here is a real
 * authoring problem — the node is too small for its label — and the agent can act on it.
 */
function textOverflowDiagnostics(project: BoardProject): BoardValidationIssue[] {
  const issues: BoardValidationIssue[] = [];
  for (const element of project.elements) {
    if (!element.visible) continue;
    const content = elementTextContent(element);
    if (!content) continue;

    const fontSize = typeof element.style.fontSize === "number" ? element.style.fontSize : 14;
    const fontWeight = Number(element.style.fontWeight ?? 600);
    const inner = Math.max(24, element.width - content.horizontalPadding);
    const lines = wrapTextToWidth(content.text, inner, fontSize, fontWeight);
    // First line costs its glyph height; only the *extra* lines cost a full line-height. Charging
    // line-height to a single line flagged 11 perfectly good labels on the real board — including a
    // 15px letter in an 18px box — because authors legitimately size a text box snug to its glyphs.
    const needed = fontSize + (lines.length - 1) * fontSize * 1.35 + content.verticalPadding;
    if (needed <= element.height + 1) continue;

    issues.push({
      severity: "warning",
      code: "text-overflows-box",
      message: `Text does not fit ${element.name}: "${truncateForMessage(content.text)}" needs ${Math.ceil(needed)}px of height in a ${Math.round(element.height)}px box (${lines.length} lines at ${fontSize}px). Grow the element, shorten the text, or reduce the font size.`,
      artboardId: element.artboardId,
      elementId: element.id
    });
  }
  return issues;
}

/** The one string an element actually renders, plus the padding its renderer reserves around it. */
function elementTextContent(element: BoardElement): { text: string; horizontalPadding: number; verticalPadding: number } | undefined {
  const read = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  switch (element.type) {
    case "text":
      return read(element.props.text) ? { text: read(element.props.text), horizontalPadding: 0, verticalPadding: 0 } : undefined;
    case "shape": {
      const label = read(element.props.text);
      return label ? { text: label, horizontalPadding: 24, verticalPadding: 8 } : undefined;
    }
    case "sticky": {
      const note = read(element.props.text);
      return note ? { text: note, horizontalPadding: 32, verticalPadding: 32 } : undefined;
    }
    default:
      return undefined;
  }
}

function truncateForMessage(text: string): string {
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

export function inspectBoardHierarchy(input: BoardProject): BoardHierarchyArtboard[] {
  const project = BoardProjectSchema.parse(input);
  const elementById = new Map(project.elements.map((element) => [element.id, element]));
  const childrenByParentId = new Map<string, BoardElement[]>();
  for (const element of project.elements) {
    if (!element.parentId) continue;
    const list = childrenByParentId.get(element.parentId) ?? [];
    list.push(element);
    childrenByParentId.set(element.parentId, list);
  }

  return project.artboards.map((artboard) => {
    const visited = new Set<string>();
    const rootElements = project.elements
      .filter((element) => {
        if (element.artboardId !== artboard.id) return false;
        if (!element.parentId) return true;
        const parent = elementById.get(element.parentId);
        return !parent || parent.artboardId !== artboard.id;
      })
      .sort(byLayerOrder);
    const children = rootElements.map((element) => buildHierarchyNode(element, artboard.name, 1, childrenByParentId, visited, new Set()));
    const detached = project.elements
      .filter((element) => element.artboardId === artboard.id && !visited.has(element.id))
      .sort(byLayerOrder)
      .map((element) => buildHierarchyNode(element, `${artboard.name} / Detached`, 1, childrenByParentId, visited, new Set()));

    return {
      id: artboard.id,
      name: artboard.name,
      type: artboard.type,
      path: artboard.name,
      width: artboard.width,
      height: artboard.height,
      locked: artboard.locked,
      visible: artboard.visible,
      children: [...children, ...detached]
    };
  });
}

export function applyBoardOperation(project: BoardProject, rawOperation: BoardOperation): BoardProject {
  const operation = OperationSchema.parse(rawOperation);
  const next: BoardProject = structuredClone(project);

  switch (operation.type) {
    case "create_artboard":
      next.artboards.push(operation.artboard);
      ensureMainPage(next).artboardIds.push(operation.artboard.id);
      next.selection = [operation.artboard.id];
      break;
    case "update_artboard": {
      const index = next.artboards.findIndex((artboard) => artboard.id === operation.artboardId);
      if (index === -1) {
        throw new Error(`Artboard not found: ${operation.artboardId}`);
      }
      next.artboards[index] = ArtboardSchema.parse({ ...next.artboards[index]!, ...operation.patch });
      next.selection = [operation.artboardId];
      break;
    }
    case "create_variant": {
      const source = next.artboards.find((artboard) => artboard.id === operation.sourceArtboardId);
      if (!source) {
        throw new Error(`Artboard not found: ${operation.sourceArtboardId}`);
      }
      const artboardId = operation.artboardId ?? createId("art");
      const clone: Artboard = {
        ...source,
        id: artboardId,
        name: operation.name ?? `${source.name} Variant`,
        x: source.x + operation.offsetX,
        y: source.y
      };
      const sourceElements = next.elements.filter((element) => element.artboardId === source.id);
      const idMap = new Map<string, string>();
      for (const element of sourceElements) {
        idMap.set(element.id, createId(element.type));
      }
      const clonedElements = sourceElements.map((element) => ({
        ...structuredClone(element),
        id: idMap.get(element.id)!,
        artboardId,
        parentId: element.parentId ? idMap.get(element.parentId) ?? null : null,
        name: `${element.name} Copy`
      }));
      next.artboards.push(clone);
      next.elements.push(...clonedElements);
      ensureMainPage(next).artboardIds.push(clone.id);
      next.selection = [clone.id];
      break;
    }
    case "add_element":
      next.elements.push(operation.element);
      next.selection = [operation.element.id];
      break;
    case "update_element": {
      const index = next.elements.findIndex((element) => element.id === operation.elementId);
      if (index === -1) {
        throw new Error(`Element not found: ${operation.elementId}`);
      }
      next.elements[index] = mergeElementPatch(next.elements[index]!, operation.patch);
      next.selection = [operation.elementId];
      break;
    }
    case "delete_element": {
      const childIds = collectDescendantIds(next.elements, operation.elementId);
      const idsToDelete = new Set([operation.elementId, ...childIds]);
      next.elements = next.elements.filter((element) => !idsToDelete.has(element.id));
      next.connectors = next.connectors.filter((connector) => !idsToDelete.has(connector.fromElementId ?? "") && !idsToDelete.has(connector.toElementId ?? ""));
      next.comments = next.comments.filter((thread) => !idsToDelete.has(thread.elementId));
      next.selection = next.selection.filter((id) => !idsToDelete.has(id));
      break;
    }
    case "move_resize_element": {
      const index = next.elements.findIndex((element) => element.id === operation.elementId);
      if (index === -1) {
        throw new Error(`Element not found: ${operation.elementId}`);
      }
      next.elements[index] = {
        ...next.elements[index]!,
        x: operation.x ?? next.elements[index]!.x,
        y: operation.y ?? next.elements[index]!.y,
        width: operation.width ?? next.elements[index]!.width,
        height: operation.height ?? next.elements[index]!.height
      };
      next.selection = [operation.elementId];
      break;
    }
    case "group_elements": {
      const ids = new Set(operation.elementIds);
      next.elements.push(operation.group);
      next.elements = next.elements.map((element) =>
        ids.has(element.id)
          ? {
              ...element,
              parentId: operation.group.id,
              x: element.x - operation.group.x,
              y: element.y - operation.group.y
            }
          : element
      );
      next.selection = [operation.group.id];
      break;
    }
    case "add_connector":
      next.connectors.push(operation.connector);
      next.selection = [operation.connector.id];
      break;
    case "update_connector": {
      const index = next.connectors.findIndex((connector) => connector.id === operation.connectorId);
      if (index === -1) {
        throw new Error(`Connector not found: ${operation.connectorId}`);
      }
      const existing = next.connectors[index]!;
      const merged = { ...existing, ...operation.patch } as BoardConnector;
      if (operation.patch.style && typeof operation.patch.style === "object" && !Array.isArray(operation.patch.style)) {
        merged.style = { ...existing.style, ...(operation.patch.style as Record<string, unknown>) } as BoardStyle;
      }
      // Endpoint element ids are optional; an explicit null in the patch detaches them.
      // (JSON transport drops `undefined`, so null is the only way to clear — used by swap-direction.)
      if (operation.patch.fromElementId === null) delete (merged as Record<string, unknown>).fromElementId;
      if (operation.patch.toElementId === null) delete (merged as Record<string, unknown>).toElementId;
      next.connectors[index] = ConnectorSchema.parse(merged);
      next.selection = [operation.connectorId];
      break;
    }
    case "delete_connector": {
      const before = next.connectors.length;
      next.connectors = next.connectors.filter((connector) => connector.id !== operation.connectorId);
      if (next.connectors.length === before) {
        throw new Error(`Connector not found: ${operation.connectorId}`);
      }
      next.selection = next.selection.filter((id) => id !== operation.connectorId);
      break;
    }
    case "delete_artboard": {
      const exists = next.artboards.some((artboard) => artboard.id === operation.artboardId);
      if (!exists) {
        throw new Error(`Artboard not found: ${operation.artboardId}`);
      }
      const removedElementIds = new Set(next.elements.filter((element) => element.artboardId === operation.artboardId).map((element) => element.id));
      next.artboards = next.artboards.filter((artboard) => artboard.id !== operation.artboardId);
      next.elements = next.elements.filter((element) => element.artboardId !== operation.artboardId);
      next.connectors = next.connectors.filter(
        (connector) =>
          connector.fromArtboardId !== operation.artboardId &&
          connector.toArtboardId !== operation.artboardId &&
          !removedElementIds.has(connector.fromElementId ?? "") &&
          !removedElementIds.has(connector.toElementId ?? "")
      );
      next.comments = next.comments.filter((thread) => !removedElementIds.has(thread.elementId));
      next.pages = next.pages.map((page) => ({ ...page, artboardIds: page.artboardIds.filter((id) => id !== operation.artboardId) }));
      next.selection = next.selection.filter((id) => id !== operation.artboardId && !removedElementIds.has(id));
      break;
    }
    case "apply_layout": {
      applyAutoLayout(next, operation);
      break;
    }
    case "polish_layout": {
      applyPolishLayout(next, operation);
      break;
    }
    case "set_layout": {
      const index = next.elements.findIndex((element) => element.id === operation.elementId);
      if (index === -1) {
        throw new Error(`Element not found: ${operation.elementId}`);
      }
      const existing = next.elements[index]!;
      // Drop undefined keys before merging: JSON and the MCP handler both send absent fields as
      // explicit `undefined`, which would overwrite a real value and then fall back to the schema
      // default — patching `gap` alone silently reset `mode` to "absolute".
      const patch = Object.fromEntries(Object.entries(operation.layout).filter(([, value]) => value !== undefined));
      next.elements[index] = BoardElementSchema.parse({
        ...existing,
        layout: ElementLayoutSchema.parse({ ...existing.layout, ...patch })
      });
      next.selection = [operation.elementId];
      break;
    }
    case "reorder_child": {
      const element = next.elements.find((candidate) => candidate.id === operation.elementId);
      if (!element) {
        throw new Error(`Element not found: ${operation.elementId}`);
      }
      // Filtered from `next`, so these are live references — renumbering them renumbers the project.
      const siblings = next.elements
        .filter((candidate) => candidate.parentId === element.parentId && candidate.artboardId === element.artboardId)
        .sort((a, b) => a.zIndex - b.zIndex);
      const from = siblings.findIndex((candidate) => candidate.id === element.id);
      const to = Math.max(0, Math.min(siblings.length - 1, operation.toIndex));
      if (from !== -1 && from !== to) {
        siblings.splice(to, 0, siblings.splice(from, 1)[0]!);
        siblings.forEach((sibling, index) => {
          sibling.zIndex = index;
        });
      }
      next.selection = [operation.elementId];
      break;
    }
    case "add_comment": {
      if (!next.elements.some((element) => element.id === operation.thread.elementId)) {
        throw new Error(`Element not found: ${operation.thread.elementId}`);
      }
      next.comments.push(operation.thread);
      break;
    }
    case "reply_comment": {
      const thread = next.comments.find((candidate) => candidate.id === operation.threadId);
      if (!thread) {
        throw new Error(`Comment not found: ${operation.threadId}`);
      }
      thread.messages.push(operation.message);
      thread.updatedAt = operation.message.createdAt;
      break;
    }
    case "set_comment_resolved": {
      const thread = next.comments.find((candidate) => candidate.id === operation.threadId);
      if (!thread) {
        throw new Error(`Comment not found: ${operation.threadId}`);
      }
      thread.resolved = operation.resolved;
      thread.updatedAt = nowIso();
      break;
    }
    case "delete_comment": {
      const before = next.comments.length;
      next.comments = next.comments.filter((thread) => thread.id !== operation.threadId);
      if (next.comments.length === before) {
        throw new Error(`Comment not found: ${operation.threadId}`);
      }
      break;
    }
    case "set_selection":
      next.selection = filterValidSelection(next, operation.selection);
      break;
    default:
      assertNever(operation);
  }

  // D-a: the one place auto-layout is resolved. Every writer — browser, MCP, migration — passes here.
  reflowStackLayouts(next);
  next.metadata.updatedAt = nowIso();
  return sanitizeProjectSelection(BoardProjectSchema.parse(next));
}

export function sanitizeProjectSelection(project: BoardProject): BoardProject {
  const selection = filterValidSelection(project, project.selection);
  return selection.length === project.selection.length && selection.every((id, index) => id === project.selection[index]) ? project : { ...project, selection };
}

export function filterValidSelection(project: BoardProject, selection: string[]): string[] {
  const validIds = new Set([
    ...project.artboards.map((artboard) => artboard.id),
    ...project.elements.map((element) => element.id),
    ...project.connectors.map((connector) => connector.id)
  ]);
  const seen = new Set<string>();
  return selection.filter((id) => {
    if (!validIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

type LayoutOperation = Extract<BoardOperation, { type: "apply_layout" }>;

/**
 * Deterministic auto-layout (Phase 4): tree for org charts, flow for left-to-right process
 * diagrams, plus align/distribute. Mutates element x/y in place on the draft project.
 */
function applyAutoLayout(project: BoardProject, operation: LayoutOperation): void {
  const targets = resolveLayoutTargets(project, operation);
  if (targets.length === 0) {
    throw new Error("apply_layout found no target elements. Pass elementIds or an artboardId with root elements.");
  }
  const byId = new Map(targets.map((element) => [element.id, element]));

  switch (operation.layout) {
    case "align-left": {
      const minX = Math.min(...targets.map((element) => element.x));
      for (const element of targets) element.x = minX;
      break;
    }
    case "align-right": {
      const maxRight = Math.max(...targets.map((element) => element.x + element.width));
      for (const element of targets) element.x = maxRight - element.width;
      break;
    }
    case "align-center-x": {
      const minX = Math.min(...targets.map((element) => element.x));
      const maxRight = Math.max(...targets.map((element) => element.x + element.width));
      const center = (minX + maxRight) / 2;
      for (const element of targets) element.x = center - element.width / 2;
      break;
    }
    case "align-top": {
      const minY = Math.min(...targets.map((element) => element.y));
      for (const element of targets) element.y = minY;
      break;
    }
    case "align-bottom": {
      const maxBottom = Math.max(...targets.map((element) => element.y + element.height));
      for (const element of targets) element.y = maxBottom - element.height;
      break;
    }
    case "align-center-y": {
      const minY = Math.min(...targets.map((element) => element.y));
      const maxBottom = Math.max(...targets.map((element) => element.y + element.height));
      const center = (minY + maxBottom) / 2;
      for (const element of targets) element.y = center - element.height / 2;
      break;
    }
    case "distribute-horizontal": {
      if (targets.length < 3) break;
      const sorted = [...targets].sort((a, b) => a.x - b.x);
      const first = sorted[0]!;
      const last = sorted[sorted.length - 1]!;
      const span = last.x + last.width - first.x;
      const totalWidth = sorted.reduce((sum, element) => sum + element.width, 0);
      const gap = (span - totalWidth) / (sorted.length - 1);
      let cursor = first.x;
      for (const element of sorted) {
        element.x = cursor;
        cursor += element.width + gap;
      }
      break;
    }
    case "distribute-vertical": {
      if (targets.length < 3) break;
      const sorted = [...targets].sort((a, b) => a.y - b.y);
      const first = sorted[0]!;
      const last = sorted[sorted.length - 1]!;
      const span = last.y + last.height - first.y;
      const totalHeight = sorted.reduce((sum, element) => sum + element.height, 0);
      const gap = (span - totalHeight) / (sorted.length - 1);
      let cursor = first.y;
      for (const element of sorted) {
        element.y = cursor;
        cursor += element.height + gap;
      }
      break;
    }
    case "tree":
      layoutTree(project, targets, byId, operation.spacingX, operation.spacingY);
      break;
    case "flow":
      layoutFlow(project, targets, byId, operation.spacingX, operation.spacingY);
      break;
    default:
      assertNever(operation.layout as never);
  }

  project.selection = targets.map((element) => element.id);
}

type PolishOperation = Extract<BoardOperation, { type: "polish_layout" }>;

/**
 * Normalize an existing layout instead of recomputing one — `apply_layout` computes, `polish_layout`
 * tidies, and the two never overlap. Every pass is deliberately conservative: it tightens what is
 * *already nearly* aligned, sized or evenly spaced, so a deliberately irregular composition survives
 * untouched while sloppiness gets cleaned up. Deterministic and idempotent — polishing twice is a
 * no-op, which is what lets it run safely before every export.
 */
function applyPolishLayout(project: BoardProject, operation: PolishOperation): void {
  const targets = resolvePolishTargets(project, operation);
  if (targets.length === 0) {
    throw new Error("polish_layout found no target elements. Pass elementIds or an artboardId with root elements.");
  }
  const { grid, tolerance } = operation;

  // Sizes settle first, onto a 2×grid rhythm. That makes every half-height a whole grid step, which
  // is what lets centre-alignment land on the grid without a follow-up snap — and a follow-up snap
  // is precisely what made an earlier version drift 8px every time it ran.
  snapSizes(targets, grid);

  // Rows first, then columns: rows only touch y and columns only touch x, so they cannot fight.
  // Each node belongs to exactly one alignment group — its strongest. Aligning rows and then columns
  // independently lets the second pass undo the first: a card in a tidy row of five gets dragged out
  // of line by one unrelated node that happens to share its centre-x. Largest group wins, so the row
  // of five keeps its member and the incidental pair of two is dropped.
  for (const group of strongestGroups(targets, tolerance)) {
    const along = group.axis === "row" ? "x" : "y";
    const across = group.axis === "row" ? "y" : "x";
    // Spacing is *measured before* sizes change and *applied after*. Unifying sizes grows nodes
    // around their centres, which eats the gaps — judging regularity on the post-growth numbers
    // reads an even row as ragged and leaves neighbours touching.
    const spacing = measureSpacing(group.members, along, grid);
    alignCentres(group.members, across, grid);
    unifySize(group.members, "height", grid);
    unifySize(group.members, "width", grid);
    applySpacing(group.members, along, grid, spacing);
  }

  snapPositions(targets, grid);
  separateOverlaps(targets, grid);
  containInArtboards(project, targets, grid);
  repairConnectors(project);

  project.selection = targets.map((element) => element.id);
}

function resolvePolishTargets(project: BoardProject, operation: PolishOperation): BoardElement[] {
  if (operation.elementIds?.length) {
    const wanted = new Set(operation.elementIds);
    return project.elements.filter((element) => wanted.has(element.id));
  }
  if (operation.artboardId) {
    return project.elements.filter(
      (element) => element.artboardId === operation.artboardId && !element.parentId && element.visible && element.type !== "screenshotOverlay" && !element.locked
    );
  }
  return [];
}

const centreOf = (element: BoardElement, axis: "x" | "y"): number =>
  axis === "y" ? element.y + element.height / 2 : element.x + element.width / 2;

/**
 * Greedy single-pass clustering along one axis — nodes at the same visual level land together.
 *
 * Sharing a centre line is not enough on its own. A 2300-wide section band and a 432-wide card can
 * share a centre-x without being a column in any meaningful sense, and treating them as one drags
 * the card halfway down the artboard. Membership therefore also requires comparable cross-axis size,
 * and excludes any pair where one encloses the other — a container and its contents are never peers.
 */
function clusterByCentre(targets: BoardElement[], axis: "x" | "y", tolerance: number): BoardElement[][] {
  const crossSize = axis === "x" ? ("width" as const) : ("height" as const);
  const sorted = [...targets].sort((a, b) => centreOf(a, axis) - centreOf(b, axis));
  const groups: BoardElement[][] = [];
  for (const element of sorted) {
    const current = groups[groups.length - 1];
    const previous = current?.[current.length - 1];
    const comparable =
      previous !== undefined &&
      centreOf(element, axis) - centreOf(previous, axis) <= tolerance &&
      Math.max(element[crossSize], previous[crossSize]) / Math.max(1, Math.min(element[crossSize], previous[crossSize])) <= 1.5 &&
      !current!.some((member) => rectsNest(rectOf(member), rectOf(element)));
    if (comparable) current!.push(element);
    else groups.push([element]);
  }
  return groups.filter((group) => group.length > 1);
}

const rectOf = (element: BoardElement) => ({ x: element.x, y: element.y, width: element.width, height: element.height });

/**
 * Resolve rows and columns into a single non-overlapping assignment: biggest groups claim their
 * members first, and a group that has fewer than two members left is dropped. Rows win ties because
 * horizontal runs are the more common intent in both diagrams and mockups.
 */
function strongestGroups(targets: BoardElement[], tolerance: number): Array<{ axis: "row" | "column"; members: BoardElement[] }> {
  const candidates = [
    ...clusterByCentre(targets, "y", tolerance).map((members) => ({ axis: "row" as const, members })),
    ...clusterByCentre(targets, "x", tolerance).map((members) => ({ axis: "column" as const, members }))
  ].sort((a, b) => b.members.length - a.members.length || (a.axis === "row" ? -1 : 1));

  const claimed = new Set<string>();
  const resolved: Array<{ axis: "row" | "column"; members: BoardElement[] }> = [];
  for (const candidate of candidates) {
    const free = candidate.members.filter((element) => !claimed.has(element.id));
    if (free.length < 2) continue;
    for (const element of free) claimed.add(element.id);
    resolved.push({ axis: candidate.axis, members: free });
  }
  return resolved;
}

/**
 * Every member of the group lands on one shared, grid-snapped centre line. Because sizes are already
 * multiples of 2×grid, `centre - size/2` is itself grid-aligned — so the result needs no further
 * rounding, and running this again recomputes the identical centre. That is what makes polish
 * idempotent, and idempotence is what makes it safe to run before every export.
 */
function alignCentres(group: BoardElement[], axis: "x" | "y", grid: number): void {
  const centre = snap(group.reduce((sum, element) => sum + centreOf(element, axis), 0) / group.length, grid);
  for (const element of group) {
    if (axis === "y") element.y = centre - element.height / 2;
    else element.x = centre - element.width / 2;
  }
}

/**
 * Nodes within 15% of each other were almost certainly meant to match — a 118 next to a 120 is a
 * mistake, a 120 next to a 400 is a decision. Only the near-misses get unified, and only upward so
 * no content is ever squeezed.
 */
function unifySize(group: BoardElement[], dimension: "width" | "height", grid: number): void {
  const sizes = group.map((element) => element[dimension]);
  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  if (min <= 0 || max / min > 1.15 || max === min) return;
  const unified = snapSize(max, grid);
  for (const element of group) {
    if (dimension === "height") {
      element.y = centreOf(element, "y") - unified / 2;
      element.height = unified;
    } else {
      element.x = centreOf(element, "x") - unified / 2;
      element.width = unified;
    }
  }
}

interface Spacing {
  /** Was the run already evenly spaced, i.e. is even spacing what the author was reaching for? */
  even: boolean;
  /** The gap to use when it was. */
  target: number;
}

/**
 * Judge spacing regularity from the geometry as the author left it, before any resizing.
 *
 * The test is how much the gaps vary *relative to the size of the things being spaced*, not the
 * ratio between them. Gaps of 16 and 53 between 432-wide cards are the same intended gap typed
 * carelessly; a ratio test calls that 3.3× and wrongly protects it. A real grouping decision shows
 * up as a break comparable to a whole node — and that is what survives.
 */
function measureSpacing(group: BoardElement[], axis: "x" | "y", grid: number): Spacing {
  const gaps = gapsAlong(group, axis);
  if (gaps.length < 2) return { even: false, target: grid * 2 };
  const size = axis === "x" ? ("width" as const) : ("height" as const);
  const spread = Math.max(...gaps) - Math.min(...gaps);
  const even = Math.min(...gaps) >= 0 && spread <= 0.5 * median(group.map((element) => element[size]));
  return { even, target: Math.max(grid * 2, snap(median(gaps), grid)) };
}

function gapsAlong(group: BoardElement[], axis: "x" | "y"): number[] {
  const size = axis === "x" ? ("width" as const) : ("height" as const);
  const sorted = [...group].sort((a, b) => a[axis] - b[axis]);
  const gaps: number[] = [];
  for (let index = 1; index < sorted.length; index++) {
    gaps.push(sorted[index]![axis] - (sorted[index - 1]![axis] + sorted[index - 1]![size]));
  }
  return gaps;
}

/**
 * Re-space a run. An evenly-spaced run is rebuilt on its median gap, anchored at the leading node so
 * the block does not drift. A deliberately irregular one keeps its rhythm — but either way no two
 * neighbours are left touching or overlapping, which resizing on its own can easily cause.
 */
function applySpacing(group: BoardElement[], axis: "x" | "y", grid: number, spacing: Spacing): void {
  const size = axis === "x" ? ("width" as const) : ("height" as const);
  const sorted = [...group].sort((a, b) => a[axis] - b[axis]);
  const minimum = grid * 2;
  let cursor = sorted[0]![axis] + sorted[0]![size];
  for (let index = 1; index < sorted.length; index++) {
    const element = sorted[index]!;
    if (spacing.even) {
      element[axis] = cursor + spacing.target;
    } else if (element[axis] - cursor < minimum) {
      element[axis] = cursor + minimum;
    }
    cursor = element[axis] + element[size];
  }
}

/** Push overlapping siblings apart along whichever axis needs the least movement. */
function separateOverlaps(targets: BoardElement[], grid: number): void {
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const a = targets[i]!;
        const b = targets[j]!;
        if (a.artboardId !== b.artboardId) continue;
        const rectA = { x: a.x, y: a.y, width: a.width, height: a.height };
        const rectB = { x: b.x, y: b.y, width: b.width, height: b.height };
        // A container legitimately encloses its contents — that is nesting, not a collision.
        if (rectsNest(rectA, rectB) || !rectsOverlap(rectA, rectB, 2)) continue;
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        const push = snap(Math.min(overlapX, overlapY) / 2 + grid, grid);
        if (overlapX <= overlapY) {
          const direction = centreOf(a, "x") <= centreOf(b, "x") ? -1 : 1;
          a.x += push * direction;
          b.x -= push * direction;
        } else {
          const direction = centreOf(a, "y") <= centreOf(b, "y") ? -1 : 1;
          a.y += push * direction;
          b.y -= push * direction;
        }
        moved = true;
      }
    }
    if (!moved) return;
  }
}

function snapPositions(targets: BoardElement[], grid: number): void {
  for (const element of targets) {
    element.x = snap(element.x, grid);
    element.y = snap(element.y, grid);
  }
}

function snapSizes(targets: BoardElement[], grid: number): void {
  for (const element of targets) {
    element.width = snapSize(element.width, grid);
    element.height = snapSize(element.height, grid);
  }
}

/**
 * Sizes land on a 2×grid rhythm and only ever round *up* — growing a node can never clip its text,
 * whereas shrinking one silently can.
 */
function snapSize(value: number, grid: number): number {
  const step = grid * 2;
  return Math.max(step, Math.ceil(value / step) * step);
}

/** Pull strays back inside their artboard so nothing is silently clipped on export. */
function containInArtboards(project: BoardProject, targets: BoardElement[], grid: number): void {
  const artboardById = new Map(project.artboards.map((artboard) => [artboard.id, artboard]));
  for (const element of targets) {
    const artboard = artboardById.get(element.artboardId);
    if (!artboard || element.width > artboard.width || element.height > artboard.height) continue;
    element.x = snap(Math.min(Math.max(element.x, 0), artboard.width - element.width), grid);
    element.y = snap(Math.min(Math.max(element.y, 0), artboard.height - element.height), grid);
  }
}

/**
 * Connector hygiene after nodes move: a port pinned to the side now facing *away* from its partner
 * drags the line the long way round, and a waypoint left stranded inside a node forces the spine
 * through it. Both are artefacts of editing, never intent, so both are cleared.
 */
function repairConnectors(project: BoardProject): void {
  const nodeRects = project.elements
    .filter((element) => element.visible && !element.parentId)
    .map((element) => elementWorldRect(project, element))
    .filter((rect): rect is NonNullable<typeof rect> => Boolean(rect));

  for (const connector of project.connectors) {
    const fromRect = connectorEndpointRect(project, connector.fromArtboardId, connector.fromElementId);
    const toRect = connectorEndpointRect(project, connector.toArtboardId, connector.toElementId);
    if (!fromRect || !toRect) continue;

    connector.waypoints = connector.waypoints.filter((point) => !nodeRects.some((rect) => pointInsideRect(point, rect)));

    if (connector.fromPort !== "auto" && facesAway(fromRect, toRect, connector.fromPort)) connector.fromPort = "auto";
    if (connector.toPort !== "auto" && facesAway(toRect, fromRect, connector.toPort)) connector.toPort = "auto";
  }
}

function facesAway(rect: { x: number; y: number; width: number; height: number }, other: { x: number; y: number; width: number; height: number }, port: "n" | "s" | "e" | "w"): boolean {
  const dx = other.x + other.width / 2 - (rect.x + rect.width / 2);
  const dy = other.y + other.height / 2 - (rect.y + rect.height / 2);
  if (port === "n") return dy > rect.height / 2;
  if (port === "s") return dy < -rect.height / 2;
  if (port === "w") return dx > rect.width / 2;
  return dx < -rect.width / 2;
}

function pointInsideRect(point: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }): boolean {
  return point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height;
}

function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function resolveLayoutTargets(project: BoardProject, operation: LayoutOperation): BoardElement[] {
  if (operation.elementIds?.length) {
    const wanted = new Set(operation.elementIds);
    return project.elements.filter((element) => wanted.has(element.id));
  }
  if (operation.artboardId) {
    return project.elements.filter((element) => element.artboardId === operation.artboardId && !element.parentId && element.type !== "screenshotOverlay");
  }
  return [];
}

function connectorEdges(project: BoardProject, byId: Map<string, BoardElement>): Array<{ from: string; to: string }> {
  return project.connectors
    .filter((connector) => connector.fromElementId && connector.toElementId && byId.has(connector.fromElementId) && byId.has(connector.toElementId))
    .map((connector) => ({ from: connector.fromElementId!, to: connector.toElementId! }));
}

function layoutTree(project: BoardProject, targets: BoardElement[], byId: Map<string, BoardElement>, spacingX: number, spacingY: number): void {
  const edges = connectorEdges(project, byId);
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const edge of edges) {
    const list = childrenOf.get(edge.from) ?? [];
    if (!list.includes(edge.to)) list.push(edge.to);
    childrenOf.set(edge.from, list);
    hasParent.add(edge.to);
  }
  const roots = targets.filter((element) => !hasParent.has(element.id));
  const originX = Math.min(...targets.map((element) => element.x));
  const originY = Math.min(...targets.map((element) => element.y));

  const widthCache = new Map<string, number>();
  const subtreeWidth = (id: string, trail: Set<string>): number => {
    if (widthCache.has(id)) return widthCache.get(id)!;
    if (trail.has(id)) return byId.get(id)?.width ?? 0;
    trail.add(id);
    const node = byId.get(id)!;
    const children = (childrenOf.get(id) ?? []).filter((child) => !trail.has(child));
    const childrenWidth = children.reduce((sum, child, index) => sum + subtreeWidth(child, trail) + (index > 0 ? spacingX : 0), 0);
    const width = Math.max(node.width, childrenWidth);
    widthCache.set(id, width);
    return width;
  };

  const placed = new Set<string>();
  const place = (id: string, left: number, y: number): void => {
    if (placed.has(id)) return;
    placed.add(id);
    const node = byId.get(id)!;
    const width = subtreeWidth(id, new Set());
    node.x = left + (width - node.width) / 2;
    node.y = y;
    let childLeft = left;
    for (const child of childrenOf.get(id) ?? []) {
      if (placed.has(child)) continue;
      place(child, childLeft, y + node.height + spacingY);
      childLeft += subtreeWidth(child, new Set()) + spacingX;
    }
  };

  let rootLeft = originX;
  for (const root of roots.length ? roots : targets.slice(0, 1)) {
    place(root.id, rootLeft, originY);
    rootLeft += subtreeWidth(root.id, new Set()) + spacingX * 2;
  }
  // Isolated nodes (no connectors) line up in a row under the trees.
  const isolatedY = Math.max(...targets.filter((element) => placed.has(element.id)).map((element) => element.y + element.height), originY) + spacingY;
  let isolatedX = originX;
  for (const element of targets) {
    if (placed.has(element.id)) continue;
    element.x = isolatedX;
    element.y = isolatedY;
    isolatedX += element.width + spacingX;
  }
}

function layoutFlow(project: BoardProject, targets: BoardElement[], byId: Map<string, BoardElement>, spacingX: number, spacingY: number): void {
  const edges = connectorEdges(project, byId);
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  }
  // Longest-path layering with a cycle guard.
  const layerOf = new Map<string, number>();
  const layerFor = (id: string, trail: Set<string>): number => {
    if (layerOf.has(id)) return layerOf.get(id)!;
    if (trail.has(id)) return 0;
    trail.add(id);
    const parents = incoming.get(id) ?? [];
    const layer = parents.length ? Math.max(...parents.map((parent) => layerFor(parent, trail))) + 1 : 0;
    layerOf.set(id, layer);
    return layer;
  };
  for (const element of targets) layerFor(element.id, new Set());

  const originX = Math.min(...targets.map((element) => element.x));
  const originY = Math.min(...targets.map((element) => element.y));
  const layers = new Map<number, BoardElement[]>();
  for (const element of targets) {
    const layer = layerOf.get(element.id) ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), element]);
  }
  let x = originX;
  const layerKeys = [...layers.keys()].sort((a, b) => a - b);
  const totalHeights = layerKeys.map((key) => {
    const nodes = layers.get(key)!;
    return nodes.reduce((sum, node) => sum + node.height, 0) + spacingY * (nodes.length - 1);
  });
  const maxColumnHeight = Math.max(...totalHeights);
  for (let index = 0; index < layerKeys.length; index++) {
    const nodes = layers.get(layerKeys[index]!)!.sort((a, b) => a.y - b.y);
    let y = originY + (maxColumnHeight - totalHeights[index]!) / 2;
    const columnWidth = Math.max(...nodes.map((node) => node.width));
    for (const node of nodes) {
      node.x = x + (columnWidth - node.width) / 2;
      node.y = y;
      y += node.height + spacingY;
    }
    x += columnWidth + spacingX;
  }
}

function ensureMainPage(project: BoardProject): BoardProject["pages"][number] {
  if (project.pages.length === 0) {
    project.pages.push({ id: "page_main", name: "Main", artboardIds: [] });
  }
  return project.pages[0]!;
}

function mergeElementPatch(element: BoardElement, patch: Record<string, unknown>): BoardElement {
  const merged = { ...element, ...patch } as BoardElement;
  if (patch.style && typeof patch.style === "object" && !Array.isArray(patch.style)) {
    merged.style = { ...element.style, ...(patch.style as Record<string, unknown>) } as BoardStyle;
  }
  if (patch.layout && typeof patch.layout === "object" && !Array.isArray(patch.layout)) {
    merged.layout = { ...element.layout, ...(patch.layout as Record<string, unknown>) } as ElementLayout;
  }
  if (patch.props && typeof patch.props === "object" && !Array.isArray(patch.props)) {
    merged.props = { ...element.props, ...(patch.props as Record<string, unknown>) };
  }
  return BoardElementSchema.parse(merged);
}

function collectDescendantIds(elements: BoardElement[], parentId: string): string[] {
  const directChildren = elements.filter((element) => element.parentId === parentId).map((element) => element.id);
  return directChildren.flatMap((id) => [id, ...collectDescendantIds(elements, id)]);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled operation: ${JSON.stringify(value)}`);
}

function buildHierarchyNode(
  element: BoardElement,
  parentPath: string,
  depth: number,
  childrenByParentId: Map<string, BoardElement[]>,
  visited: Set<string>,
  ancestors: Set<string>
): BoardHierarchyNode {
  const path = appendHierarchyPath(parentPath, element.name);
  if (ancestors.has(element.id)) {
    visited.add(element.id);
    return hierarchyNode(element, path, depth, []);
  }

  visited.add(element.id);
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(element.id);
  const children = (childrenByParentId.get(element.id) ?? [])
    .filter((child) => child.artboardId === element.artboardId)
    .sort(byLayerOrder)
    .map((child) => buildHierarchyNode(child, path, depth + 1, childrenByParentId, visited, nextAncestors));

  return hierarchyNode(element, path, depth, children);
}

function hierarchyNode(element: BoardElement, path: string, depth: number, children: BoardHierarchyNode[]): BoardHierarchyNode {
  return {
    id: element.id,
    name: element.name,
    type: element.type,
    semanticRole: element.semanticRole,
    path,
    depth,
    artboardId: element.artboardId,
    parentId: element.parentId,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    zIndex: element.zIndex,
    locked: element.locked,
    visible: element.visible,
    children
  };
}

function appendHierarchyPath(parentPath: string, childName: string): string {
  const parentSegments = splitHierarchyPath(parentPath);
  const childSegments = splitHierarchyPath(childName);
  let common = 0;
  while (common < parentSegments.length && common < childSegments.length && parentSegments[common] === childSegments[common]) {
    common += 1;
  }
  const uniqueChildSegments = childSegments.slice(common);
  return [...parentSegments, ...(uniqueChildSegments.length ? uniqueChildSegments : [childName])].join(" / ");
}

function splitHierarchyPath(value: string): string[] {
  return value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasParentCycle(element: BoardElement, elementById: Map<string, BoardElement>): boolean {
  const seen = new Set<string>([element.id]);
  let current: BoardElement | undefined = element;
  while (current?.parentId) {
    if (seen.has(current.parentId)) return true;
    seen.add(current.parentId);
    current = elementById.get(current.parentId);
  }
  return false;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

/** Ink points are [x, y] pairs normalized to the element box (0..1). */
export function readPointArray(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [];
  const points: Array<[number, number]> = [];
  for (const item of value) {
    if (Array.isArray(item) && typeof item[0] === "number" && typeof item[1] === "number" && Number.isFinite(item[0]) && Number.isFinite(item[1])) {
      points.push([item[0], item[1]]);
    }
  }
  return points;
}

function byLayerOrder(a: BoardElement, b: BoardElement): number {
  return a.zIndex - b.zIndex || a.y - b.y || a.x - b.x || a.name.localeCompare(b.name);
}

export function createElementFromPreset(type: BoardElement["type"], artboardId: string, x: number, y: number): BoardElement {
  const id = createId(type);
  const base = {
    id,
    type,
    name: titleCase(type),
    artboardId,
    parentId: null,
    x,
    y,
    width: 220,
    height: 64,
    zIndex: 10,
    locked: false,
    visible: true,
    semanticRole: type,
    style: {},
    layout: { mode: "absolute" as const },
    props: {}
  };

  const presets: Record<BoardElement["type"], Partial<BoardElement>> = {
    frame: { width: 260, height: 180, style: { fill: "transparent", stroke: "#94A3B8", strokeWidth: 1, radius: 14 }, props: { hierarchyOnly: true } },
    group: { width: 260, height: 180, style: { fill: "transparent", stroke: "#94A3B8", strokeWidth: 1, radius: 14 }, props: { hierarchyOnly: true } },
    rect: { width: 180, height: 120, style: { fill: "#F7F6F3", radius: 18 } },
    text: { width: 220, height: 44, style: { color: "#111827", fontSize: 26, fontWeight: 760, lineHeight: 32 }, props: { text: "New headline" } },
    image: { width: 240, height: 160, style: { fill: "#E2E8F0", radius: 18, imageFit: "cover" }, props: { alt: "Image" } },
    icon: { width: 48, height: 48, semanticRole: "material icon", style: { fill: "#F7F6F3", color: "#44403C", radius: 14 }, props: { materialIcon: "add_circle", label: "Add" } },
    line: { width: 220, height: 24, semanticRole: "divider", style: { fill: "transparent", stroke: "#64748B", strokeWidth: 2, opacity: 1 }, props: { direction: "horizontal", lineCap: "round" } },
    button: { width: 220, height: 56, style: { fill: "#111827", color: "#FFFFFF", radius: 16, fontSize: 15, fontWeight: 720 }, props: { text: "Continue" } },
    input: { width: 280, height: 58, style: { fill: "#FFFFFF", stroke: "#CBD5E1", strokeWidth: 1, color: "#334155", radius: 14, fontSize: 15 }, props: { label: "Email", placeholder: "you@example.com" } },
    list: { width: 320, height: 236, style: { fill: "#FFFFFF", color: "#111827", radius: 18, shadow: "0 14px 40px rgba(15, 23, 42, 0.08)", padding: 16 }, props: { title: "Recent activity", items: ["Design home screen", "Trace paywall", "Export spec"] } },
    card: { width: 300, height: 150, style: { fill: "#FFFFFF", color: "#111827", radius: 22, shadow: "0 18px 50px rgba(15, 23, 42, 0.10)", padding: 20 }, props: { eyebrow: "Metric", title: "$2,480", subtitle: "Ready to use" } },
    dialog: { width: 320, height: 220, style: { fill: "#FFFFFF", color: "#111827", radius: 24, shadow: "0 24px 70px rgba(15, 23, 42, 0.20)", padding: 22 }, props: { title: "Confirm change", body: "Review the details before applying this update.", action: "Apply" } },
    sheet: { width: 340, height: 360, style: { fill: "#FFFFFF", color: "#111827", radius: 28, shadow: "0 -18px 60px rgba(15, 23, 42, 0.18)", padding: 24 }, props: { title: "Bottom sheet", body: "A compact action surface." } },
    nav: { width: 320, height: 72, style: { fill: "#FFFFFF", color: "#111827", radius: 20, shadow: "0 12px 36px rgba(15, 23, 42, 0.08)", padding: 16 }, props: { title: "Overview", items: ["Home", "Inbox", "Settings"] } },
    tabbar: { width: 320, height: 72, style: { fill: "#FFFFFF", color: "#64748B", radius: 24, shadow: "0 12px 36px rgba(15, 23, 42, 0.10)" }, props: { items: ["Home", "Search", "Profile"], active: "Home" } },
    chart: { width: 320, height: 210, style: { fill: "#FFFFFF", color: "#111827", radius: 20, shadow: "0 14px 40px rgba(15, 23, 42, 0.08)", padding: 18 }, props: { title: "Trend", values: [28, 46, 34, 72, 58, 84] } },
    sparkline: { width: 240, height: 88, semanticRole: "sparkline chart", style: { fill: "transparent", stroke: "#44403C", strokeWidth: 3, color: "#44403C" }, props: { values: [24, 38, 32, 58, 48, 72, 66], showArea: true } },
    badge: { width: 108, height: 36, style: { fill: "#DCFCE7", color: "#047857", radius: 999, fontSize: 13, fontWeight: 720 }, props: { text: "Ready" } },
    emptyState: { width: 320, height: 260, style: { fill: "#F8FAFC", color: "#334155", radius: 22, stroke: "#E2E8F0", strokeWidth: 1, padding: 24 }, props: { title: "Nothing here yet", body: "Create a screen or import a screenshot to begin." } },
    paywall: { width: 340, height: 470, style: { fill: "#FFFFFF", color: "#111827", radius: 28, shadow: "0 20px 70px rgba(15, 23, 42, 0.16)", padding: 24 }, props: { title: "Go Pro", price: "$4.99/mo", features: ["Unlimited boards", "Code export", "Agent control"], action: "Start Pro" } },
    table: { width: 520, height: 280, style: { fill: "#FFFFFF", color: "#111827", radius: 18, shadow: "0 14px 40px rgba(15, 23, 42, 0.08)", padding: 18 }, props: { title: "Rows", columns: ["Name", "Status"], rows: [["Home", "Ready"], ["Paywall", "Draft"]] } },
    sticky: { width: 220, height: 160, style: { fill: "#FEF3C7", color: "#78350F", radius: 16, shadow: "0 10px 28px rgba(120, 53, 15, 0.12)", padding: 16 }, props: { text: "Prompt notes go here." } },
    screenshotOverlay: { width: 320, height: 640, locked: true, style: { fill: "#E2E8F0", radius: 24, opacity: 0.65, imageFit: "contain" }, props: { alt: "Screenshot overlay" } },
    shape: { width: 180, height: 100, semanticRole: "diagram shape", style: { fill: "#F7F6F3", stroke: "#44403C", strokeWidth: 1.5, color: "#44403C", radius: 10, fontSize: 14, fontWeight: 600, textAlign: "center" }, props: { shape: "rectangle", text: "Step" } },
    ink: { width: 240, height: 160, semanticRole: "freehand ink", style: { fill: "transparent", stroke: "#334155", strokeWidth: 2.5 }, props: { points: [] } }
  };

  return BoardElementSchema.parse({ ...base, ...presets[type] });
}

function titleCase(value: string): string {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

export * from "./connector.js";
