import { z } from "zod";

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
  "screenshotOverlay"
] as const;

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

export const ConnectorSchema = z.object({
  id: z.string().min(1),
  fromArtboardId: z.string().min(1),
  toArtboardId: z.string().min(1),
  fromElementId: z.string().optional(),
  toElementId: z.string().optional(),
  label: z.string().optional(),
  style: BoardStyleSchema.default({})
});

export type BoardConnector = z.infer<typeof ConnectorSchema>;

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

export function createDefaultProject(name = "PowerBoard Starter Board"): BoardProject {
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
    tokens: {
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
    },
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

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  return {
    valid: errors === 0,
    summary: { errors, warnings },
    issues,
    hierarchy: inspectBoardHierarchy(project)
  };
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
    case "set_selection":
      next.selection = filterValidSelection(next, operation.selection);
      break;
    default:
      assertNever(operation);
  }

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
    rect: { width: 180, height: 120, style: { fill: "#DBEAFE", radius: 18 } },
    text: { width: 220, height: 44, style: { color: "#111827", fontSize: 26, fontWeight: 760, lineHeight: 32 }, props: { text: "New headline" } },
    image: { width: 240, height: 160, style: { fill: "#E2E8F0", radius: 18, imageFit: "cover" }, props: { alt: "Image" } },
    icon: { width: 48, height: 48, semanticRole: "material icon", style: { fill: "#EFF6FF", color: "#2563EB", radius: 14 }, props: { materialIcon: "add_circle", label: "Add" } },
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
    sparkline: { width: 240, height: 88, semanticRole: "sparkline chart", style: { fill: "transparent", stroke: "#2563EB", strokeWidth: 3, color: "#2563EB" }, props: { values: [24, 38, 32, 58, 48, 72, 66], showArea: true } },
    badge: { width: 108, height: 36, style: { fill: "#DCFCE7", color: "#047857", radius: 999, fontSize: 13, fontWeight: 720 }, props: { text: "Ready" } },
    emptyState: { width: 320, height: 260, style: { fill: "#F8FAFC", color: "#334155", radius: 22, stroke: "#E2E8F0", strokeWidth: 1, padding: 24 }, props: { title: "Nothing here yet", body: "Create a screen or import a screenshot to begin." } },
    paywall: { width: 340, height: 470, style: { fill: "#FFFFFF", color: "#111827", radius: 28, shadow: "0 20px 70px rgba(15, 23, 42, 0.16)", padding: 24 }, props: { title: "Go Pro", price: "$4.99/mo", features: ["Unlimited boards", "Code export", "Agent control"], action: "Start Pro" } },
    table: { width: 520, height: 280, style: { fill: "#FFFFFF", color: "#111827", radius: 18, shadow: "0 14px 40px rgba(15, 23, 42, 0.08)", padding: 18 }, props: { title: "Rows", columns: ["Name", "Status"], rows: [["Home", "Ready"], ["Paywall", "Draft"]] } },
    sticky: { width: 220, height: 160, style: { fill: "#FEF3C7", color: "#78350F", radius: 16, shadow: "0 10px 28px rgba(120, 53, 15, 0.12)", padding: 16 }, props: { text: "Prompt notes go here." } },
    screenshotOverlay: { width: 320, height: 640, locked: true, style: { fill: "#E2E8F0", radius: 24, opacity: 0.65, imageFit: "contain" }, props: { alt: "Screenshot overlay" } }
  };

  return BoardElementSchema.parse({ ...base, ...presets[type] });
}

function titleCase(value: string): string {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}
