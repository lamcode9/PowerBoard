import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Activity,
  AlertTriangle,
  ArchiveRestore,
  ArrowLeftRight,
  ArrowRight,
  Bot,
  Box,
  BoxSelect,
  BringToFront,
  Cable,
  Check,
  ChevronDown,
  ChevronRight,
  CloudOff,
  Command as CommandIcon,
  Component,
  Copy,
  Download,
  Expand,
  Eye,
  EyeOff,
  FileCode2,
  FileText,
  Focus,
  Frame,
  GitBranch,
  Group,
  Home,
  Image as ImageIcon,
  Keyboard,
  Layers3,
  LayoutTemplate,
  Lock,
  LockOpen,
  Maximize2,
  Minimize2,
  Minus,
  Monitor,
  Moon,
  MousePointer2,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PenTool,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Send,
  Shapes,
  Smartphone,
  Spline,
  Sparkles,
  StickyNote,
  Sun,
  Table,
  Tablet,
  Trash2,
  Type,
  Undo2,
  Upload,
  WifiOff,
  Wand2,
  Workflow,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type { Artboard, BoardConnector, BoardElement, BoardOperation, BoardProject, BoardTemplate } from "@powerboard/schema";
import {
  arrowheadIsFilled,
  arrowheadPath,
  connectorAnchorSlots,
  connectorEndpointRect,
  connectorGeometry,
  connectorLabelPoint,
  connectorLabelWidth,
  connectorObstacles,
  createElementFromPreset,
  createId,
  DEVICE_PRESETS,
  readPointArray,
  POLISH_GRID,
  POLISH_TOLERANCE,
  shapeKinds,
  strokeDashPattern,
  strokeStyles,
  type Rect
} from "@powerboard/schema";
import {
  applyOperation,
  backupNow,
  createBoard,
  deleteBoard,
  exportMermaid,
  exportReactTailwind,
  exportSpec,
  getHealth,
  listBoards,
  readBoard,
  redo,
  setSelection as postSelection,
  undo,
  type ApiHealth,
  uploadAsset,
  type BoardSummary
} from "./api";
import { agentRgb } from "./agentColor";
import { cameraTransform, panCamera, zoomCameraAroundPoint, type Camera, type ViewportPoint } from "./canvasCamera";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { AgentFeed, type AgentFeedEntry } from "./components/AgentFeed";
import { RestoreDialog } from "./components/RestoreDialog";
import { ExportDialog, type ExportTarget } from "./components/ExportDialog";
import { ShortcutOverlay } from "./components/ShortcutOverlay";

const componentTypes: BoardElement["type"][] = [
  "icon",
  "button",
  "card",
  "line",
  "sparkline",
  "dialog",
  "sheet",
  "nav",
  "tabbar",
  "input",
  "list",
  "table",
  "chart",
  "badge",
  "emptyState",
  "paywall",
  "sticky",
  "text",
  "rect"
];

type ResizeHandle = "nw" | "ne" | "sw" | "se";

type DragState = {
  id: string;
  target: "element" | "artboard";
  mode: "move" | "resize";
  handle?: ResizeHandle;
  startX: number;
  startY: number;
  original: Pick<BoardElement | Artboard, "x" | "y" | "width" | "height">;
  latest: Pick<BoardElement | Artboard, "x" | "y" | "width" | "height">;
};

type PanState = {
  startX: number;
  startY: number;
  cameraX: number;
  cameraY: number;
};

type GestureLikeEvent = Event & {
  scale?: number;
  clientX?: number;
  clientY?: number;
};

type GestureState = {
  startZoom: number;
  focalPoint: ViewportPoint;
};

type AgentActivity = {
  source: "agent";
  kind: "operation" | "selection";
  ids: string[];
  operationType?: string;
  at: string;
  agentId?: string;
  agentName?: string;
};

/**
 * "This agent has the board right now" — fed by the `agent.presence` heartbeat (every MCP tool, reads
 * included) and by landed edits. `phase` is what the canvas animates: `reading` breathes, `editing`
 * tightens. Expires after {@link AGENT_PRESENCE_TTL_MS} of silence.
 *
 * Kept per agent, not per board: several agents can hold one board at once, and a single slot would
 * make the last ping erase whoever else is working — the collaborator you can't see is worse than no
 * signal at all.
 */
type AgentPresence = {
  agentId: string;
  agentName: string;
  tool: string;
  ids: string[];
  phase: "reading" | "editing";
  /** epoch ms of the last ping — the sweeper expires lanes off this rather than one timer per agent. */
  at: number;
};

/** Matches the server's fallback identity: an agent that never gave a name still gets one stable lane. */
const ANONYMOUS_AGENT_ID = "agent";

/** Long enough to bridge the gap between tool calls in a burst, short enough that a stall reads as done. */
const AGENT_PRESENCE_TTL_MS = 5000;
const AGENT_PRESENCE_SWEEP_MS = 500;

type DragPreview = {
  id: string;
  target: DragState["target"];
  patch: Pick<BoardElement | Artboard, "x" | "y" | "width" | "height">;
};

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const INITIAL_ZOOM = 0.8;
const BUTTON_ZOOM_FACTOR = 1.25;
// Trackpad pinch on macOS Chromium/Electron arrives as ctrl+wheel; this sensitivity
// makes one comfortable pinch cover a meaningful zoom range instead of crawling.
const WHEEL_ZOOM_SENSITIVITY = 0.0075;
const MAX_WHEEL_ZOOM_DELTA = 48;
const GESTURE_ZOOM_DAMPING = 0.62;
const GESTURE_WHEEL_SUPPRESSION_MS = 260;
// Per-event zoom clamp: keeps a single fast flick from teleporting the zoom, but is
// generous enough that pinch/⌘-scroll feels immediate (was 1.04 — that made zoom feel broken).
const MAX_INPUT_ZOOM_FACTOR = 1.6;
const CANVAS_WIDTH = 80000;
const CANVAS_HEIGHT = 56000;
const CANVAS_ORIGIN_X = 24000;
const CANVAS_ORIGIN_Y = 16000;
// Mirrors the export renderer's scene padding (packages/renderers renderPageSvg / renderSelectionSvg)
// so the dialog's size readout matches the file. The server still reports the authoritative numbers.
const EXPORT_PAGE_PAD = 60;
const EXPORT_SELECTION_PAD = 32;

type RouteState = { view: "home" } | { view: "board"; boardId: string };
type RouteMode = "push" | "replace" | "none";
type CanvasTool = "select" | "connect" | "ink";
type PaletteMode = "mockup" | "diagram";
type Theme = "light" | "dark";
type MarqueeState = { startX: number; startY: number; x: number; y: number; width: number; height: number };
type SnapGuides = { vertical: number[]; horizontal: number[] };
type InkDraft = { artboardId: string; points: Array<[number, number]> };
const NO_GUIDES: SnapGuides = { vertical: [], horizontal: [] };
const SNAP_THRESHOLD = 6;
const THEME_STORAGE_KEY = "powerboard.theme";
const PANE_PREFS_KEY = "powerboard.panes";
const LEFT_PANE_MIN = 220;
const LEFT_PANE_MAX = 400;
const LEFT_PANE_DEFAULT = 264;
const RIGHT_PANE_MIN = 252;
const RIGHT_PANE_MAX = 440;
const RIGHT_PANE_DEFAULT = 292;

type PanePrefs = { leftWidth: number; rightWidth: number; leftOpen: boolean; rightOpen: boolean };

/** UI-chrome preference only (never board data — see persistence P0 rule). */
function readPanePrefs(): PanePrefs {
  const fallback: PanePrefs = { leftWidth: LEFT_PANE_DEFAULT, rightWidth: RIGHT_PANE_DEFAULT, leftOpen: true, rightOpen: true };
  try {
    const raw = window.localStorage.getItem(PANE_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PanePrefs>;
    return {
      leftWidth: clamp(Number(parsed.leftWidth) || LEFT_PANE_DEFAULT, LEFT_PANE_MIN, LEFT_PANE_MAX),
      rightWidth: clamp(Number(parsed.rightWidth) || RIGHT_PANE_DEFAULT, RIGHT_PANE_MIN, RIGHT_PANE_MAX),
      leftOpen: parsed.leftOpen !== false,
      rightOpen: parsed.rightOpen !== false
    };
  } catch {
    return fallback;
  }
}

type ConnectDraft = { fromId: string; startX: number; startY: number; x: number; y: number; moved: boolean };
const DIAGRAM_SHAPES: Array<{ kind: (typeof shapeKinds)[number]; label: string }> = [
  { kind: "rectangle", label: "Process" },
  { kind: "rounded", label: "Start / End" },
  { kind: "diamond", label: "Decision" },
  { kind: "parallelogram", label: "Input / Output" },
  { kind: "cylinder", label: "Database" },
  { kind: "ellipse", label: "Ellipse" },
  { kind: "hexagon", label: "Prepare" },
  { kind: "document", label: "Document" },
  { kind: "cloud", label: "Cloud" },
  { kind: "triangle", label: "Triangle" },
  { kind: "star", label: "Star" },
  { kind: "arrow-right", label: "Arrow" }
];
/** Curated frame sizes for the Insert menu — one click each, no buried dropdown. */
const INSERT_FRAME_PRESET_IDS = ["iphone-15-pro", "iphone-16-pro-max", "pixel-9", "ipad", "ipad-pro-11", "macbook-air", "desktop-1440", "web-dashboard"];
const INSERT_FRAME_PRESETS = INSERT_FRAME_PRESET_IDS
  .map((id) => DEVICE_PRESETS.find((preset) => preset.id === id))
  .filter((preset): preset is (typeof DEVICE_PRESETS)[number] => Boolean(preset));

type ElementIndexes = {
  canvasRootsByArtboard: Map<string, BoardElement[]>;
  canvasChildrenByParent: Map<string, BoardElement[]>;
  layerRootsByArtboard: Map<string, BoardElement[]>;
  layerChildrenByParent: Map<string, BoardElement[]>;
};

const EMPTY_ELEMENT_INDEXES: ElementIndexes = {
  canvasRootsByArtboard: new Map(),
  canvasChildrenByParent: new Map(),
  layerRootsByArtboard: new Map(),
  layerChildrenByParent: new Map()
};

export function App() {
  const [project, setProject] = useState<BoardProject | null>(null);
  const [boardSummaries, setBoardSummaries] = useState<BoardSummary[]>([]);
  const [boardPreviews, setBoardPreviews] = useState<Record<string, BoardProject>>({});
  const [boardsLoading, setBoardsLoading] = useState(true);
  const [homeOpen, setHomeOpen] = useState(() => readRoute()?.view !== "board");
  const [storageStatus, setStorageStatus] = useState<ApiHealth | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [presetId, setPresetId] = useState(DEVICE_PRESETS[0]!.id);
  const [newBoardDialogOpen, setNewBoardDialogOpen] = useState(false);
  const [newBoardName, setNewBoardName] = useState("Untitled PowerBoard Board");
  const [boardPendingDelete, setBoardPendingDelete] = useState<BoardSummary | null>(null);
  const [deletingBoard, setDeletingBoard] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pan, setPan] = useState<PanState | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [status, setStatusMessage] = useState("Starting workspace...");
  const [statusTone, setStatusTone] = useState<"info" | "error">("info");
  const [boardsError, setBoardsError] = useState<string | null>(null);
  // Any ordinary status update clears an error tone; a failed write must fail LOUD (persistence P0).
  function setStatus(message: string) {
    setStatusMessage(message);
    setStatusTone("info");
  }
  function failLoud(message: string) {
    console.error(`[PowerBoard] ${message}`);
    setStatusMessage(message);
    setStatusTone("error");
  }
  const [agentActiveUntilById, setAgentActiveUntilById] = useState<Record<string, number>>({});
  // Backup is a reassurance surface, not a working one — the status bar already reports the last
  // snapshot. Collapsed by default so it stops taking 200px above the fold from the inspector.
  const [collapsedPanels, setCollapsedPanels] = useState<Record<string, boolean>>({ backup: true });
  const [panePrefs, setPanePrefs] = useState<PanePrefs>(readPanePrefs);
  const leftPaneOpen = panePrefs.leftOpen;
  const rightPaneOpen = panePrefs.rightOpen;
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [paletteMode, setPaletteMode] = useState<PaletteMode>("mockup");
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [agentFeed, setAgentFeed] = useState<AgentFeedEntry[]>([]);
  const [agentPresences, setAgentPresences] = useState<Record<string, AgentPresence>>({});
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuides>(NO_GUIDES);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [connectDraft, setConnectDraft] = useState<ConnectDraft | null>(null);
  const [inkDraft, setInkDraft] = useState<InkDraft | null>(null);
  const connectDraftRef = useRef<ConnectDraft | null>(null);
  const paneResizeRef = useRef<{ side: "left" | "right"; startX: number; startWidth: number } | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const inkDraftRef = useRef<InkDraft | null>(null);
  const toolRef = useRef<CanvasTool>("select");
  const actionsRef = useRef<Record<string, () => void>>({});
  const nudgeRef = useRef<((dx: number, dy: number) => void) | null>(null);
  const lastGuidesKeyRef = useRef("|");
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasPlaneRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: INITIAL_ZOOM });
  const zoomStateFrameRef = useRef<number | null>(null);
  const initialViewportPositionedRef = useRef(false);
  const gestureStateRef = useRef<GestureState | null>(null);
  const lastNativeGestureAtRef = useRef(0);
  const lastViewportPointRef = useRef<ViewportPoint | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);
  const agentActivityTimersRef = useRef<number[]>([]);
  const projectRef = useRef<BoardProject | null>(null);
  const selectedIdsRef = useRef<string[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const pendingDragPreviewRef = useRef<DragPreview | null>(null);
  const dragPreviewFrameRef = useRef<number | null>(null);
  const operationQueueRef = useRef<Promise<BoardProject | null>>(Promise.resolve(null));
  const previewSeqRef = useRef(0);
  const selectionSeqRef = useRef(0);
  const navigationSeqRef = useRef(0);
  const routeViewRef = useRef<{ homeOpen: boolean; projectId: string | null }>({ homeOpen: readRoute()?.view !== "board", projectId: null });

  useEffect(() => {
    return () => {
      if (zoomStateFrameRef.current !== null) {
        window.cancelAnimationFrame(zoomStateFrameRef.current);
      }
      if (dragPreviewFrameRef.current !== null) {
        window.cancelAnimationFrame(dragPreviewFrameRef.current);
      }
      for (const timer of agentActivityTimersRef.current) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    routeViewRef.current = { homeOpen, projectId: project?.id ?? null };
  }, [homeOpen, project?.id]);

  useEffect(() => {
    const onRouteChange = () => {
      const route = readRoute();
      const current = routeViewRef.current;
      if (route?.view === "board") {
        if (!current.homeOpen && current.projectId === route.boardId) return;
        void openBoard(route.boardId, "none");
        return;
      }
      if (current.homeOpen) return;
      void showHome("none");
    };
    window.addEventListener("popstate", onRouteChange);
    window.addEventListener("hashchange", onRouteChange);
    return () => {
      window.removeEventListener("popstate", onRouteChange);
      window.removeEventListener("hashchange", onRouteChange);
    };
  }, []);

  useEffect(() => {
    if (!project || homeOpen || initialViewportPositionedRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    initialViewportPositionedRef.current = true;
    window.requestAnimationFrame(() => {
      applyCamera({
        x: -((CANVAS_ORIGIN_X - 90) * cameraRef.current.zoom),
        y: -((CANVAS_ORIGIN_Y - 80) * cameraRef.current.zoom),
        zoom: cameraRef.current.zoom
      });
    });
  }, [project?.id, homeOpen]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme preference is a nicety; never block on storage.
    }
  }, [theme]);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  useEffect(() => {
    inkDraftRef.current = inkDraft;
  }, [inkDraft]);

  // Poll health while a board is open so the backup badge stays honest.
  useEffect(() => {
    if (homeOpen || !project) return;
    const timer = window.setInterval(() => {
      void refreshStorageStatus().catch(() => undefined);
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [homeOpen, project?.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const actions = actionsRef.current;
      if (event.code === "Space") {
        event.preventDefault();
        setSpaceDown(true);
      }
      if (event.key === "Escape") {
        actions.escape?.();
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) {
        if (event.key === "?" || (event.shiftKey && event.key === "/")) {
          event.preventDefault();
          actions.shortcuts?.();
          return;
        }
        if (event.key.toLowerCase() === "f") {
          event.preventDefault();
          actions.focusMode?.();
          return;
        }
        if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          actions.deleteSelection?.();
          return;
        }
        if (event.key.startsWith("Arrow")) {
          event.preventDefault();
          const step = event.shiftKey ? 10 : 1;
          const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
          const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
          nudgeRef.current?.(dx, dy);
          return;
        }
        return;
      }
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        zoomAtViewportCenter(cameraRef.current.zoom * BUTTON_ZOOM_FACTOR);
      }
      if (event.key === "-") {
        event.preventDefault();
        zoomAtViewportCenter(cameraRef.current.zoom / BUTTON_ZOOM_FACTOR);
      }
      if (event.key === "0") {
        event.preventDefault();
        zoomAtViewportCenter(1);
        setStatus("Zoom 100%");
      }
      if (event.key === "1" || event.key === "9") {
        event.preventDefault();
        actions.fitAll?.();
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        actions.commandPalette?.();
      }
      if (event.key.toLowerCase() === "e" && event.shiftKey) {
        event.preventDefault();
        actions.exportImage?.();
      }
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) actions.redo?.();
        else actions.undo?.();
      }
      if (event.key.toLowerCase() === "d") {
        event.preventDefault();
        actions.duplicate?.();
      }
      if (event.key.toLowerCase() === "g" && !event.shiftKey) {
        event.preventDefault();
        actions.group?.();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpaceDown(false);
        setPan(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (!project || homeOpen) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onWheel = (event: WheelEvent) => {
      const suppressDuplicateWheel = performance.now() - lastNativeGestureAtRef.current < GESTURE_WHEEL_SUPPRESSION_MS;
      if (suppressDuplicateWheel) return;
      rememberViewportPoint(event);
      const shouldZoom = event.ctrlKey || event.metaKey || event.altKey;
      event.preventDefault();
      const wheel = normalizeWheelDeltas(event);
      if (shouldZoom) {
        const primaryDelta = Math.abs(wheel.y) >= Math.abs(wheel.x) ? wheel.y : wheel.x;
        const cappedDelta = clamp(primaryDelta, -MAX_WHEEL_ZOOM_DELTA, MAX_WHEEL_ZOOM_DELTA);
        const rawFactor = Math.exp(-cappedDelta * WHEEL_ZOOM_SENSITIVITY);
        const factor = clamp(rawFactor, 1 / MAX_INPUT_ZOOM_FACTOR, MAX_INPUT_ZOOM_FACTOR);
        zoomAroundViewportPoint(cameraRef.current.zoom * factor, resolveViewportPoint(event));
        return;
      }

      const horizontal = event.shiftKey && Math.abs(wheel.x) < Math.abs(wheel.y) ? wheel.y : wheel.x;
      applyCamera(panCamera(cameraRef.current, -horizontal, -wheel.y));
    };

    const onGestureStart = (event: GestureLikeEvent) => {
      event.preventDefault();
      lastNativeGestureAtRef.current = performance.now();
      rememberViewportPoint(event);
      gestureStateRef.current = {
        startZoom: cameraRef.current.zoom,
        focalPoint: resolveViewportPoint(event)
      };
    };

    const onGestureChange = (event: GestureLikeEvent) => {
      event.preventDefault();
      lastNativeGestureAtRef.current = performance.now();
      rememberViewportPoint(event);
      const gesture = gestureStateRef.current ?? { startZoom: cameraRef.current.zoom, focalPoint: resolveViewportPoint(event) };
      const rawScale = clamp(event.scale ?? 1, 0.55, 1.8);
      const dampedScale = Math.pow(rawScale, GESTURE_ZOOM_DAMPING);
      zoomAroundViewportPoint(gesture.startZoom * dampedScale, resolveViewportPoint(event, gesture.focalPoint));
    };

    const onGestureEnd = (event: GestureLikeEvent) => {
      event.preventDefault();
      lastNativeGestureAtRef.current = performance.now();
      gestureStateRef.current = null;
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false });
    viewport.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false });
    viewport.addEventListener("gestureend", onGestureEnd as EventListener, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("gesturestart", onGestureStart as EventListener);
      viewport.removeEventListener("gesturechange", onGestureChange as EventListener);
      viewport.removeEventListener("gestureend", onGestureEnd as EventListener);
    };
  }, [project?.id, homeOpen]);

  useEffect(() => {
    const boardId = project?.id;
    const socketUrl = boardId && !homeOpen && shouldConnectLiveSocket(storageStatus) ? liveSocketUrl(boardId) : null;
    if (!socketUrl) return;
    const ws = new WebSocket(socketUrl);
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as {
        type?: string;
        project?: BoardProject;
        selection?: string[];
        agentActivity?: unknown;
        tool?: string;
        ids?: unknown;
        agentId?: string;
        agentName?: string;
      };
      if (message.type === "board.changed" && message.project) {
        projectRef.current = message.project;
        setProject(message.project);
        selectedIdsRef.current = message.project.selection;
        setSelectedIds(message.project.selection);
        rememberBoard(message.project);
        if (isAgentActivity(message.agentActivity)) {
          const activity = message.agentActivity;
          flashAgentActivity(activity);
          recordAgentFeed(activity, message.project);
          markAgentPresence({
            agentId: activity.agentId ?? ANONYMOUS_AGENT_ID,
            agentName: activity.agentName ?? readString((message.project.metadata as Record<string, unknown>).lastAgentEditedBy, "Agent"),
            tool: activity.operationType ?? "edit",
            ids: activity.ids,
            phase: "editing"
          });
        }
      }
      if (message.type === "agent.presence" && typeof message.tool === "string") {
        const ids = Array.isArray(message.ids) ? message.ids.filter((id): id is string => typeof id === "string") : [];
        markAgentPresence({
          agentId: message.agentId ?? ANONYMOUS_AGENT_ID,
          agentName: message.agentName ?? "Agent",
          tool: message.tool,
          ids,
          phase: "reading"
        });
      }
      if (message.type === "selection.changed" && message.selection) {
        selectedIdsRef.current = message.selection;
        setSelectedIds(message.selection);
      }
    };
    ws.onerror = () => {
      if (projectRef.current?.id === boardId) {
        setStatus("Live sync unavailable; cloud saves still work");
      }
    };
    return () => ws.close();
  }, [project?.id, homeOpen, storageStatus?.cloudStore, storageStatus?.storageMode]);

  const elementIndexes = useMemo(() => (project ? buildElementIndexes(project) : EMPTY_ELEMENT_INDEXES), [project]);
  const agentActiveIds = useMemo(() => new Set(Object.keys(agentActiveUntilById)), [agentActiveUntilById]);
  const lastAgentEditedAtIso = useMemo(() => (project ? readLastAgentEditedAt(project) : null), [project]);

  const selectedElement = useMemo(() => {
    if (!project || selectedIds.length !== 1) return null;
    return project.elements.find((element) => element.id === selectedIds[0]) ?? null;
  }, [project, selectedIds]);

  const selectedArtboard = useMemo(() => {
    if (!project || selectedIds.length !== 1) return null;
    return project.artboards.find((artboard) => artboard.id === selectedIds[0]) ?? null;
  }, [project, selectedIds]);

  const selectedConnector = useMemo(() => {
    if (!project || selectedIds.length !== 1) return null;
    return project.connectors.find((connector) => connector.id === selectedIds[0]) ?? null;
  }, [project, selectedIds]);

  const activeArtboard = useMemo(() => {
    if (!project) return null;
    const selectedArtboardId =
      selectedArtboard?.id ??
      selectedElement?.artboardId ??
      selectedIds.map((id) => project.elements.find((element) => element.id === id)?.artboardId).find(Boolean);
    return project.artboards.find((artboard) => artboard.id === selectedArtboardId) ?? project.artboards[0] ?? null;
  }, [project, selectedArtboard, selectedElement, selectedIds]);

  /** World-plane bounds of the selection — anchors the floating selection toolbar. */
  const selectionBounds = useMemo(() => {
    if (!project || !selectedIds.length) return null;
    return boundsForSelection(project, selectedIds);
  }, [project, selectedIds]);

  /**
   * What the Export dialog can render, most specific first. Sizes here are the 1x estimate for the
   * live readout — the server is the authority and its real numbers replace these after a render.
   */
  const exportTargets = useMemo<ExportTarget[]>(() => {
    if (!project) return [];
    const page = project.pages[0];
    const selectionSize = boundsForSelection(project, selectedIds);
    const projectSize = boundsForProject(project);
    const frame = selectedArtboard ?? activeArtboard;
    const selectionCount = selectedIds.length;
    return [
      {
        scope: "selection",
        label: selectionCount > 1 ? `Selection (${selectionCount})` : "Selection",
        detail: selectionCount ? "Cropped to what you have selected" : "Nothing selected",
        ids: selectedIds,
        width: selectionSize ? selectionSize.width + EXPORT_SELECTION_PAD * 2 : 0,
        height: selectionSize ? selectionSize.height + EXPORT_SELECTION_PAD * 2 : 0,
        disabledReason: selectionCount ? undefined : "Select a frame or element on the canvas first."
      },
      {
        scope: "artboard",
        label: "Frame",
        detail: frame ? frame.name : "No frame on this board",
        artboardId: frame?.id,
        width: frame?.width ?? 0,
        height: frame?.height ?? 0,
        disabledReason: frame ? undefined : "This board has no frames yet."
      },
      {
        scope: "page",
        label: "Page",
        detail: projectSize ? `Every frame and connector${page ? ` on ${page.name}` : ""}` : "No visible frames",
        pageId: page?.id,
        width: projectSize ? projectSize.width + EXPORT_PAGE_PAD * 2 : 0,
        height: projectSize ? projectSize.height + EXPORT_PAGE_PAD * 2 : 0,
        disabledReason: projectSize ? undefined : "Nothing visible to export."
      }
    ];
  }, [project, selectedIds, selectedArtboard, activeArtboard]);

  /** Presence lanes, oldest arrival first so the badge row doesn't reshuffle on every ping. */
  const livePresences = useMemo(() => Object.values(agentPresences).sort((a, b) => a.agentId.localeCompare(b.agentId)), [agentPresences]);

  /** One reticle per agent that has a locatable target — an agent with no target keeps the veil but drops the lock. */
  const agentReticles = useMemo(() => {
    if (!project) return [];
    return livePresences
      .map((presence) => {
        if (!presence.ids.length) return null;
        const bounds = boundsForSelection(project, presence.ids);
        return bounds ? { ...presence, bounds } : null;
      })
      .filter((entry): entry is AgentPresence & { bounds: Bounds } => entry !== null);
  }, [project, livePresences]);

  /**
   * One sweep expires every stale lane, rather than a timer per agent: with several agents pinging in
   * bursts, per-agent timers churn far faster than they help. Parked entirely while nobody is here.
   */
  const anyAgentPresent = livePresences.length > 0;
  useEffect(() => {
    if (!anyAgentPresent) return;
    const interval = window.setInterval(() => {
      const cutoff = Date.now() - AGENT_PRESENCE_TTL_MS;
      setAgentPresences((current) => {
        const next = Object.fromEntries(Object.entries(current).filter(([, presence]) => presence.at > cutoff));
        return Object.keys(next).length === Object.keys(current).length ? current : next;
      });
    }, AGENT_PRESENCE_SWEEP_MS);
    return () => window.clearInterval(interval);
  }, [anyAgentPresent]);

  const selectedElementCount = useMemo(
    () => (project ? selectedIds.filter((id) => project.elements.some((element) => element.id === id)).length : 0),
    [project, selectedIds]
  );

  /**
   * Extend one agent's "working" window, leaving every other agent's lane untouched. A tool call with
   * no id-ish input keeps that agent's previous target so its reticle holds the lock instead of
   * blinking out between calls in a burst.
   */
  function markAgentPresence(next: Omit<AgentPresence, "at">) {
    setAgentPresences((current) => {
      const previous = current[next.agentId];
      return { ...current, [next.agentId]: { ...next, ids: next.ids.length ? next.ids : previous?.ids ?? [], at: Date.now() } };
    });
  }

  function flashAgentActivity(activity: AgentActivity) {
    const ids = uniqueStrings(activity.ids);
    if (!ids.length) return;
    const expiresAt = Date.now() + 2600;
    setAgentActiveUntilById((current) => {
      const next = { ...current };
      for (const id of ids) next[id] = expiresAt;
      return next;
    });
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setAgentActiveUntilById((current) => {
        let changed = false;
        const next = { ...current };
        for (const [id, expiry] of Object.entries(current)) {
          if (expiry <= now) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, 2700);
    agentActivityTimersRef.current.push(timer);
    setStatus(agentActivityStatus(activity));
  }

  function recordAgentFeed(activity: AgentActivity, boardAfter: BoardProject) {
    // Prefer the identity that came with the event: board metadata only remembers the *last* writer,
    // which is the wrong name for an entry that landed while another agent was also editing.
    const actor = activity.agentName ?? readString((boardAfter.metadata as Record<string, unknown>).lastAgentEditedBy, "Agent");
    const namesById = new Map<string, string>([
      ...boardAfter.artboards.map((artboard) => [artboard.id, artboard.name] as const),
      ...boardAfter.elements.map((element) => [element.id, element.name] as const)
    ]);
    const named = activity.ids.map((id) => namesById.get(id)).filter((name): name is string => Boolean(name));
    const targetText = named.length ? ` — ${named.slice(0, 2).join(", ")}${named.length > 2 ? ` +${named.length - 2}` : ""}` : "";
    setAgentFeed((current) =>
      [
        {
          id: `${activity.at}-${Math.random().toString(36).slice(2, 7)}`,
          at: activity.at,
          actor,
          agentId: activity.agentId ?? ANONYMOUS_AGENT_ID,
          message: `${agentActivityStatus(activity)}${targetText}`,
          targets: activity.ids
        },
        ...current
      ].slice(0, 50)
    );
  }

  function rememberBoard(nextProject: BoardProject) {
    setBoardPreviews((current) => ({ ...current, [nextProject.id]: nextProject }));
    setBoardSummaries((current) => upsertBoardSummary(current, nextProject));
  }

  async function refreshBoards(): Promise<BoardSummary[]> {
    setBoardsLoading(true);
    try {
      const boards = await listBoards();
      setBoardSummaries(boards);
      setBoardsError(null);
      const previewSeq = ++previewSeqRef.current;
      void loadBoardPreviews(boards, previewSeq);
      return boards;
    } catch (error) {
      // A load failure must read as a load failure — never as an empty account.
      setBoardsError(error instanceof Error ? error.message : "Could not reach the workspace");
      throw error;
    } finally {
      setBoardsLoading(false);
    }
  }

  async function loadBoardPreviews(boards: BoardSummary[], previewSeq: number) {
    for (const board of boards) {
      try {
        const preview = await readBoard(board.id);
        if (previewSeq !== previewSeqRef.current) return;
        setBoardPreviews((current) => ({ ...current, [board.id]: preview }));
      } catch {
        // Board cards can still open from summaries if one preview is temporarily unavailable.
      }
    }
  }

  async function refreshStorageStatus() {
    const health = await getHealth();
    setStorageStatus(health);
    return health;
  }

  async function openBoard(boardId: string, routeMode: RouteMode = "push") {
    const seq = beginNavigation();
    try {
      const next = await readBoard(boardId);
      if (!isCurrentNavigation(seq)) return;
      initialViewportPositionedRef.current = false;
      clearDrag();
      setPan(null);
      projectRef.current = next;
      setProject(next);
      selectedIdsRef.current = next.selection;
      setSelectedIds(next.selection);
      setHomeOpen(false);
      rememberBoard(next);
      writeRoute({ view: "board", boardId }, routeMode);
      setStatus(`Opened ${next.name}`);
    } catch (error) {
      if (!isCurrentNavigation(seq)) return;
      setStatus(error instanceof Error ? error.message : "Could not open board");
    }
  }

  async function createNewBoard() {
    setNewBoardName("Untitled PowerBoard Board");
    setNewBoardDialogOpen(true);
    setStatus("Name the new board");
  }

  async function submitNewBoard(rawName: string, template: BoardTemplate) {
    const name = rawName.trim() || "Untitled PowerBoard Board";
    const seq = beginNavigation();
    try {
      const next = await createBoard(name, template);
      if (!isCurrentNavigation(seq)) return;
      initialViewportPositionedRef.current = false;
      projectRef.current = next;
      setProject(next);
      selectedIdsRef.current = next.selection;
      setSelectedIds(next.selection);
      setNewBoardDialogOpen(false);
      setHomeOpen(false);
      rememberBoard(next);
      writeRoute({ view: "board", boardId: next.id }, "push");
      setStatus(`Created ${next.name}`);
    } catch (error) {
      if (!isCurrentNavigation(seq)) return;
      failLoud(error instanceof Error ? error.message : "Could not create board");
    }
  }

  function cancelNewBoard() {
    setNewBoardDialogOpen(false);
    setStatus(homeOpen ? "Boards" : project?.name ?? "PowerBoard");
  }

  function requestDeleteBoard(board: BoardSummary) {
    setBoardPendingDelete(board);
    setStatus(`Delete ${board.name}?`);
  }

  function cancelDeleteBoard() {
    if (deletingBoard) return;
    setBoardPendingDelete(null);
    setStatus(homeOpen ? "Boards" : project?.name ?? "PowerBoard");
  }

  async function confirmDeleteBoard() {
    const board = boardPendingDelete;
    if (!board || deletingBoard) return;
    setDeletingBoard(true);
    try {
      await deleteBoard(board.id);
      setBoardSummaries((current) => current.filter((candidate) => candidate.id !== board.id));
      setBoardPreviews((current) => {
        const next = { ...current };
        delete next[board.id];
        return next;
      });
      setBoardPendingDelete(null);
      setStatus(`Deleted ${board.name}`);
      // If the deleted board is the one currently open, fall back to the home view.
      if (projectRef.current?.id === board.id) {
        await showHome("replace");
      }
    } catch (error) {
      failLoud(error instanceof Error ? error.message : "Could not delete board");
    } finally {
      setDeletingBoard(false);
    }
  }

  async function showHome(routeMode: RouteMode = "push") {
    const seq = beginNavigation();
    clearDrag();
    setPan(null);
    setHomeOpen(true);
    selectedIdsRef.current = [];
    setSelectedIds([]);
    writeRoute({ view: "home" }, routeMode);
    setStatus("Boards");
    await Promise.all([refreshBoards(), refreshStorageStatus()]).catch((error) => {
      if (!isCurrentNavigation(seq)) return;
      setStatus(error instanceof Error ? error.message : "Could not refresh boards");
    });
  }

  async function boot() {
    const seq = beginNavigation();
    try {
      const route = readRoute();
      const [boards] = await Promise.all([refreshBoards(), refreshStorageStatus()]);
      const routeBoard = route?.view === "board" ? await readBoard(route.boardId).catch(() => null) : null;
      if (!isCurrentNavigation(seq)) return;
      if (route?.view === "board" && routeBoard) {
        projectRef.current = routeBoard;
        setProject(routeBoard);
        selectedIdsRef.current = routeBoard.selection;
        setSelectedIds(routeBoard.selection);
        rememberBoard(routeBoard);
        setHomeOpen(false);
        setStatus(`Opened ${routeBoard.name}`);
      } else {
        if (route?.view === "board" && !routeBoard) {
          setStatus(`Board not found: ${route.boardId}`);
        } else {
          setStatus("Boards");
        }
        if (!projectRef.current && boards.length === 0) {
          setProject(null);
        }
        selectedIdsRef.current = [];
        setSelectedIds([]);
        setHomeOpen(true);
        writeRoute({ view: "home" }, "replace");
      }
    } catch (error) {
      if (!isCurrentNavigation(seq)) return;
      setStatus(error instanceof Error ? error.message : "Could not start workspace");
    }
  }

  function beginNavigation(): number {
    navigationSeqRef.current += 1;
    return navigationSeqRef.current;
  }

  function isCurrentNavigation(seq: number): boolean {
    return seq === navigationSeqRef.current;
  }

  async function runOperation(operation: BoardOperation) {
    const boardId = projectRef.current?.id;
    if (!boardId) return;
    try {
      setStatus("Saving...");
      const next = await queueOperation(boardId, operation);
      if (next && projectRef.current?.id === boardId) {
        setStatus("Saved");
      }
    } catch (error) {
      failLoud(error instanceof Error ? error.message : "Operation failed — your last change may not be saved");
    }
  }

  async function queueOperation(boardId: string, operation: BoardOperation): Promise<BoardProject | null> {
    const queued = operationQueueRef.current
      .catch(() => null)
      .then(async () => {
        const next = await applyOperation(boardId, operation);
        if (projectRef.current?.id === boardId) {
          projectRef.current = next;
          setProject(next);
          selectedIdsRef.current = next.selection;
          setSelectedIds(next.selection);
          rememberBoard(next);
        }
        return next;
      });
    operationQueueRef.current = queued.catch(() => null);
    return queued;
  }

  async function select(ids: string[], additive = false) {
    const boardId = projectRef.current?.id;
    if (!boardId) return;
    const nextSelection = additive ? toggleSelection(selectedIdsRef.current, ids[0]!) : ids;
    selectedIdsRef.current = nextSelection;
    setSelectedIds(nextSelection);
    const seq = ++selectionSeqRef.current;
    await postSelection(boardId, nextSelection).catch((error) => {
      if (seq === selectionSeqRef.current) {
        setStatus(error instanceof Error ? error.message : "Selection sync failed");
      }
    });
  }

  function updateLocalElement(id: string, patch: Partial<BoardElement>) {
    setProject((current) => {
      if (!current) return current;
      const next = {
        ...current,
        elements: current.elements.map((element) => (element.id === id ? { ...element, ...patch } : element))
      };
      projectRef.current = next;
      return next;
    });
  }

  function updateLocalArtboard(id: string, patch: Partial<Artboard>) {
    setProject((current) => {
      if (!current) return current;
      const next = {
        ...current,
        artboards: current.artboards.map((artboard) => (artboard.id === id ? { ...artboard, ...patch } : artboard))
      };
      projectRef.current = next;
      return next;
    });
  }

  function beginDrag(state: DragState) {
    dragRef.current = state;
    setDrag(state);
  }

  function clearDrag() {
    dragRef.current = null;
    pendingDragPreviewRef.current = null;
    setDrag(null);
  }

  function scheduleDragPreview(preview: DragPreview) {
    pendingDragPreviewRef.current = preview;
    if (dragPreviewFrameRef.current !== null) return;
    dragPreviewFrameRef.current = window.requestAnimationFrame(() => {
      dragPreviewFrameRef.current = null;
      const pending = pendingDragPreviewRef.current;
      if (!pending) return;
      if (pending.target === "artboard") {
        updateLocalArtboard(pending.id, pending.patch);
        return;
      }
      updateLocalElement(pending.id, pending.patch);
    });
  }

  function onCanvasPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (pan) {
      applyCamera({
        ...cameraRef.current,
        x: pan.cameraX + event.clientX - pan.startX,
        y: pan.cameraY + event.clientY - pan.startY
      });
      return;
    }
    if (marqueeRef.current) {
      updateMarquee(event);
      return;
    }
    if (connectDraftRef.current) {
      updateConnectDraft(event);
      return;
    }
    if (inkDraftRef.current) {
      updateInkDraft(event);
      return;
    }
    const activeDrag = dragRef.current;
    if (!activeDrag || !projectRef.current) return;
    const currentZoom = cameraRef.current.zoom;
    const dx = (event.clientX - activeDrag.startX) / currentZoom;
    const dy = (event.clientY - activeDrag.startY) / currentZoom;
    const minSize = activeDrag.target === "artboard" ? 120 : 24;
    let patch: Partial<Pick<BoardElement, "x" | "y" | "width" | "height">>;
    if (activeDrag.mode === "move") {
      const snapped = computeSnap(activeDrag, Math.round(activeDrag.original.x + dx), Math.round(activeDrag.original.y + dy));
      setGuidesIfChanged(snapped.guides);
      patch = clampMove(activeDrag, snapped.x, snapped.y);
    } else {
      patch = resizePatch(activeDrag, dx, dy, minSize);
    }
    const latest = { ...activeDrag.latest, ...patch };
    dragRef.current = { ...activeDrag, latest };
    scheduleDragPreview({ id: activeDrag.id, target: activeDrag.target, patch: latest });
  }

  /** Keep root elements fully inside their frame so a drag can never lose them off-canvas. */
  function clampMove(activeDrag: DragState, x: number, y: number): { x: number; y: number } {
    if (activeDrag.target !== "element") return { x, y };
    const current = projectRef.current;
    const element = current?.elements.find((candidate) => candidate.id === activeDrag.id);
    if (!element || element.parentId) return { x, y };
    const artboard = current?.artboards.find((candidate) => candidate.id === element.artboardId);
    if (!artboard) return { x, y };
    const width = activeDrag.latest.width;
    const height = activeDrag.latest.height;
    return {
      x: clamp(x, 0, Math.max(0, artboard.width - width)),
      y: clamp(y, 0, Math.max(0, artboard.height - height))
    };
  }

  /** Resize from any corner: the opposite edge stays pinned, min-size clamps toward the anchor. */
  function resizePatch(activeDrag: DragState, dx: number, dy: number, minSize: number): Partial<Pick<BoardElement, "x" | "y" | "width" | "height">> {
    const { x, y, width, height } = activeDrag.original;
    const handle = activeDrag.handle ?? "se";
    const right = x + width;
    const bottom = y + height;
    let nextX = x;
    let nextY = y;
    let nextWidth: number;
    let nextHeight: number;
    if (handle.includes("w")) {
      nextWidth = Math.max(minSize, Math.round(width - dx));
      nextX = right - nextWidth;
    } else {
      nextWidth = Math.max(minSize, Math.round(width + dx));
    }
    if (handle.includes("n")) {
      nextHeight = Math.max(minSize, Math.round(height - dy));
      nextY = bottom - nextHeight;
    } else {
      nextHeight = Math.max(minSize, Math.round(height + dy));
    }
    return { x: nextX, y: nextY, width: nextWidth, height: nextHeight };
  }

  function setGuidesIfChanged(guides: SnapGuides) {
    const key = `${guides.vertical.join(",")}|${guides.horizontal.join(",")}`;
    if (lastGuidesKeyRef.current === key) return;
    lastGuidesKeyRef.current = key;
    setSnapGuides(guides);
  }

  /** Snap moved frames/root elements to sibling edges + centers (alignment guides). */
  function computeSnap(activeDrag: DragState, proposedX: number, proposedY: number): { x: number; y: number; guides: SnapGuides } {
    const current = projectRef.current;
    if (!current) return { x: proposedX, y: proposedY, guides: NO_GUIDES };
    const threshold = SNAP_THRESHOLD / cameraRef.current.zoom;
    const { width, height } = activeDrag.latest;

    let candidatesX: number[] = [];
    let candidatesY: number[] = [];
    let worldOffsetX = CANVAS_ORIGIN_X;
    let worldOffsetY = CANVAS_ORIGIN_Y;

    if (activeDrag.target === "artboard") {
      for (const artboard of current.artboards) {
        if (artboard.id === activeDrag.id || !artboard.visible) continue;
        candidatesX.push(artboard.x, artboard.x + artboard.width / 2, artboard.x + artboard.width);
        candidatesY.push(artboard.y, artboard.y + artboard.height / 2, artboard.y + artboard.height);
      }
    } else {
      const element = current.elements.find((candidate) => candidate.id === activeDrag.id);
      if (!element || element.parentId) return { x: proposedX, y: proposedY, guides: NO_GUIDES };
      const artboard = current.artboards.find((candidate) => candidate.id === element.artboardId);
      if (!artboard) return { x: proposedX, y: proposedY, guides: NO_GUIDES };
      worldOffsetX += artboard.x;
      worldOffsetY += artboard.y;
      candidatesX.push(0, artboard.width / 2, artboard.width);
      candidatesY.push(0, artboard.height / 2, artboard.height);
      for (const sibling of current.elements) {
        if (sibling.id === element.id || sibling.parentId || sibling.artboardId !== element.artboardId || !sibling.visible) continue;
        candidatesX.push(sibling.x, sibling.x + sibling.width / 2, sibling.x + sibling.width);
        candidatesY.push(sibling.y, sibling.y + sibling.height / 2, sibling.y + sibling.height);
      }
    }

    const anchorsX = [0, width / 2, width];
    const anchorsY = [0, height / 2, height];
    let snappedX = proposedX;
    let snappedY = proposedY;
    let bestDx = threshold;
    let bestDy = threshold;
    const guides: SnapGuides = { vertical: [], horizontal: [] };

    for (const candidate of candidatesX) {
      for (const anchor of anchorsX) {
        const delta = Math.abs(proposedX + anchor - candidate);
        if (delta < bestDx) {
          bestDx = delta;
          snappedX = Math.round(candidate - anchor);
          guides.vertical = [worldOffsetX + candidate];
        }
      }
    }
    for (const candidate of candidatesY) {
      for (const anchor of anchorsY) {
        const delta = Math.abs(proposedY + anchor - candidate);
        if (delta < bestDy) {
          bestDy = delta;
          snappedY = Math.round(candidate - anchor);
          guides.horizontal = [worldOffsetY + candidate];
        }
      }
    }
    return { x: snappedX, y: snappedY, guides };
  }

  async function onCanvasPointerUp(event: React.PointerEvent<HTMLElement>) {
    if (pan) {
      setPan(null);
      return;
    }
    if (marqueeRef.current) {
      finishMarquee();
      return;
    }
    if (connectDraftRef.current) {
      finishConnectDraft(event);
      return;
    }
    if (inkDraftRef.current) {
      await finishInkDraft();
      return;
    }
    const activeDrag = dragRef.current;
    if (!activeDrag || !projectRef.current) return;
    clearDrag();
    setGuidesIfChanged(NO_GUIDES);
    if (boundsEqual(activeDrag.original, activeDrag.latest)) return;
    if (activeDrag.target === "element") {
      await runOperation({
        type: "move_resize_element",
        elementId: activeDrag.id,
        x: activeDrag.latest.x,
        y: activeDrag.latest.y,
        width: activeDrag.latest.width,
        height: activeDrag.latest.height
      });
      return;
    }
    await runOperation({
      type: "update_artboard",
      artboardId: activeDrag.id,
      patch: { x: activeDrag.latest.x, y: activeDrag.latest.y, width: activeDrag.latest.width, height: activeDrag.latest.height }
    });
  }

  async function addArtboard(requestedPresetId?: string) {
    if (!project) return;
    const preset = DEVICE_PRESETS.find((candidate) => candidate.id === (requestedPresetId ?? presetId)) ?? DEVICE_PRESETS[0]!;
    if (requestedPresetId) setPresetId(requestedPresetId);
    const position = nextArtboardPosition(project, activeArtboard);
    const artboard: Artboard = {
      id: createId("art"),
      name: preset.name,
      type: preset.type,
      x: position.x,
      y: position.y,
      width: preset.width,
      height: preset.height,
      background: preset.type === "desktop" || preset.type === "web" ? "#F8FAFC" : "#F5F7FB",
      devicePreset: preset.id,
      frameless: false,
      locked: false,
      visible: true
    };
    await runOperation({ type: "create_artboard", artboard });
  }

  async function addComponent(type: BoardElement["type"]) {
    const artboard = await ensureInsertionArtboard();
    const current = projectRef.current;
    if (!current || !artboard) {
      setStatus("Add a frame or canvas first");
      return;
    }
    const element = createElementFromPreset(type, artboard.id, 0, 0);
    const pos = placementInArtboard(artboard, element.width, element.height);
    element.x = pos.x;
    element.y = pos.y;
    element.name = uniqueElementName(current, artboard.id, `${artboard.name} / ${labelFor(type)}`);
    element.zIndex = Math.max(0, ...current.elements.filter((candidate) => candidate.artboardId === artboard.id).map((candidate) => candidate.zIndex)) + 1;
    await insertElement(element);
  }

  async function updateSelectedElement(patch: Record<string, unknown>) {
    if (!selectedElement) return;
    await runOperation({ type: "update_element", elementId: selectedElement.id, patch });
  }

  async function deleteSelection() {
    if (!project) return;
    const elementIds = selectedIds.filter((id) => project.elements.some((element) => element.id === id));
    const connectorIds = selectedIds.filter((id) => project.connectors.some((connector) => connector.id === id));
    const artboardIds = selectedIds.filter((id) => project.artboards.some((artboard) => artboard.id === id));
    const total = elementIds.length + connectorIds.length + artboardIds.length;
    if (!total) {
      setStatus("Select something to delete");
      return;
    }
    for (const elementId of elementIds) {
      await runOperation({ type: "delete_element", elementId });
    }
    for (const connectorId of connectorIds) {
      await runOperation({ type: "delete_connector", connectorId });
    }
    for (const artboardId of artboardIds) {
      await runOperation({ type: "delete_artboard", artboardId });
    }
    setStatus(`Deleted ${total} ${pluralize(total, "item")} — ⌘Z to undo`);
  }

  async function groupSelection() {
    if (!project) return;
    if (selectedIds.length < 2) {
      setStatus("Select at least two elements to group");
      return;
    }
    const elements = project.elements.filter((element) => selectedIds.includes(element.id));
    if (!elements.length) return;
    const artboardId = elements[0]!.artboardId;
    if (elements.some((element) => element.artboardId !== artboardId)) {
      setStatus("Group elements from one frame at a time");
      return;
    }
    const minX = Math.min(...elements.map((element) => element.x));
    const minY = Math.min(...elements.map((element) => element.y));
    const maxX = Math.max(...elements.map((element) => element.x + element.width));
    const maxY = Math.max(...elements.map((element) => element.y + element.height));
    const group = createElementFromPreset("group", artboardId, minX, minY);
    group.width = maxX - minX;
    group.height = maxY - minY;
    group.name = uniqueElementName(project, artboardId, groupNameForSelection(project, artboardId, elements));
    group.semanticRole = "component group";
    group.zIndex = Math.max(...elements.map((element) => element.zIndex)) + 1;
    await runOperation({ type: "group_elements", group, elementIds: elements.map((element) => element.id) });
  }

  async function duplicateSelection() {
    if (!project) return;
    if (!selectedIds.length) {
      setStatus("Select something to duplicate");
      return;
    }
    const selectedArtboards = project.artboards.filter((artboard) => selectedIds.includes(artboard.id));
    if (selectedArtboards.length === 1 && selectedIds.length === 1) {
      await runOperation({
        type: "create_variant",
        sourceArtboardId: selectedArtboards[0]!.id,
        name: `${selectedArtboards[0]!.name} Copy`,
        offsetX: selectedArtboards[0]!.width + 120
      });
      return;
    }

    const rootElements = selectedElementRoots(project, selectedIds);
    if (!rootElements.length) {
      setStatus("Select elements to duplicate, or one frame to create a variant");
      return;
    }
    const sourceElements = rootElements.flatMap((element) => [element, ...elementDescendants(project, element.id)]);
    const idMap = new Map(sourceElements.map((element) => [element.id, createId(element.type)]));
    const clonedElements = sourceElements.map((element) => ({
      ...structuredClone(element),
      id: idMap.get(element.id)!,
      parentId: element.parentId && idMap.has(element.parentId) ? idMap.get(element.parentId)! : element.parentId,
      x: element.parentId && idMap.has(element.parentId) ? element.x : element.x + 28,
      y: element.parentId && idMap.has(element.parentId) ? element.y : element.y + 28,
      name: uniqueElementName(project, element.artboardId, `${element.name} Copy`),
      zIndex: element.zIndex + 1
    }));

    let nextProject: BoardProject | null = project;
    setStatus("Duplicating...");
    for (const element of clonedElements) {
      nextProject = await queueOperation(nextProject.id, { type: "add_element", element });
      if (!nextProject) return;
    }
    rememberBoard(nextProject);
    const nextSelection = rootElements.map((element) => idMap.get(element.id)!).filter(Boolean);
    selectedIdsRef.current = nextSelection;
    setSelectedIds(nextSelection);
    await postSelection(project.id, nextSelection).catch(() => undefined);
    setStatus(`Duplicated ${rootElements.length} ${rootElements.length === 1 ? "element" : "elements"}`);
  }

  async function connectArtboards() {
    if (!project) return;
    const artboardIds = selectedIds.filter((id) => project.artboards.some((artboard) => artboard.id === id));
    const [from, to] = artboardIds.length >= 2 ? artboardIds : project.artboards.slice(0, 2).map((artboard) => artboard.id);
    if (!from || !to || from === to) {
      setStatus("Select two frames to connect");
      return;
    }
    await runOperation({
      type: "add_connector",
      connector: {
        id: createId("conn"),
        fromArtboardId: from,
        toArtboardId: to,
        fromPort: "auto",
        toPort: "auto",
        routing: "curved",
        arrowStart: "none",
        arrowEnd: "arrow",
        waypoints: [],
        label: "Flow",
        labelPosition: 0.5,
        style: { stroke: "#44403C" }
      }
    });
  }

  async function nudgeSelection(dx: number, dy: number) {
    const current = projectRef.current;
    if (!current || (!dx && !dy)) return;
    const elements = current.elements.filter((element) => selectedIdsRef.current.includes(element.id) && !element.locked);
    for (const element of elements) {
      await runOperation({ type: "move_resize_element", elementId: element.id, x: element.x + dx, y: element.y + dy });
    }
  }

  async function runLayout(layout: "tree" | "flow" | "distribute-horizontal" | "distribute-vertical" | "align-left" | "align-center-x" | "align-right" | "align-top" | "align-center-y" | "align-bottom") {
    const current = projectRef.current;
    if (!current) return;
    const elementIds = selectedIdsRef.current.filter((id) => current.elements.some((element) => element.id === id));
    if (!elementIds.length && !activeArtboard) {
      setStatus("Select elements (or a frame) to lay out");
      return;
    }
    await runOperation({
      type: "apply_layout",
      layout,
      elementIds: elementIds.length ? elementIds : undefined,
      artboardId: elementIds.length ? undefined : activeArtboard?.id,
      spacingX: 80,
      spacingY: 64
    });
    setStatus(`Applied ${layout.replace(/-/g, " ")} layout`);
  }

  /** One-click version of the auto-corrector agents get through MCP — same operation, same result. */
  async function runPolish() {
    const current = projectRef.current;
    if (!current) return;
    const elementIds = selectedIdsRef.current.filter((id) => current.elements.some((element) => element.id === id));
    if (!elementIds.length && !activeArtboard) {
      setStatus("Select elements (or open a frame) to tidy up");
      return;
    }
    await runOperation({
      type: "polish_layout",
      elementIds: elementIds.length ? elementIds : undefined,
      artboardId: elementIds.length ? undefined : activeArtboard?.id,
      grid: POLISH_GRID,
      tolerance: POLISH_TOLERANCE
    });
    setStatus("Tidied up — aligned, evened out and snapped to the grid");
  }

  async function addShape(kind: (typeof shapeKinds)[number], label: string) {
    const artboard = await ensureInsertionArtboard();
    const current = projectRef.current;
    if (!current || !artboard) {
      setStatus("Add a canvas first");
      return;
    }
    const element = createElementFromPreset("shape", artboard.id, 0, 0);
    element.props = { ...element.props, shape: kind, text: label };
    const pos = placementInArtboard(artboard, element.width, element.height);
    element.x = pos.x;
    element.y = pos.y;
    element.name = uniqueElementName(current, artboard.id, `${artboard.name} / ${label}`);
    element.zIndex = Math.max(0, ...current.elements.filter((candidate) => candidate.artboardId === artboard.id).map((candidate) => candidate.zIndex)) + 1;
    await insertElement(element);
  }

  async function addDiagramCanvas() {
    if (!project) return;
    const position = nextArtboardPosition(project, activeArtboard);
    const artboard: Artboard = {
      id: createId("art"),
      name: uniqueArtboardName(project, "Diagram Canvas"),
      type: "custom",
      x: position.x,
      y: position.y,
      width: 1600,
      height: 1100,
      background: theme === "dark" ? "#1B2432" : "#FBFCFE",
      frameless: true,
      locked: false,
      visible: true
    };
    await runOperation({ type: "create_artboard", artboard });
    setStatus("Diagram canvas added — drop shapes and connect them");
  }

  function resolveConnectorEnd(id: string): { artboardId: string; elementId?: string } | null {
    const current = projectRef.current;
    if (!current) return null;
    const artboard = current.artboards.find((candidate) => candidate.id === id);
    if (artboard) return { artboardId: artboard.id };
    const element = current.elements.find((candidate) => candidate.id === id);
    if (element) return { artboardId: element.artboardId, elementId: element.id };
    return null;
  }

  async function createConnectorBetween(fromId: string, toId: string) {
    const from = resolveConnectorEnd(fromId);
    const to = resolveConnectorEnd(toId);
    if (!from || !to || fromId === toId) {
      setStatus("Connector cancelled");
      return;
    }
    const isDiagram = Boolean(from.elementId || to.elementId);
    const connectorId = createId("conn");
    await runOperation({
      type: "add_connector",
      connector: {
        id: connectorId,
        fromArtboardId: from.artboardId,
        toArtboardId: to.artboardId,
        fromElementId: from.elementId,
        toElementId: to.elementId,
        fromPort: "auto",
        toPort: "auto",
        routing: isDiagram ? "orthogonal" : "curved",
        arrowStart: "none",
        arrowEnd: "arrow",
        waypoints: [],
        labelPosition: 0.5,
        style: { stroke: "#44403C" }
      }
    });
    await select([connectorId]).catch(() => undefined);
    setStatus("Connected — drag again for another, or press Esc for the select tool");
  }

  /** Connector tool pointer-down on a shape/frame: start a live drag, or complete a click-click pair. */
  function onConnectDown(targetId: string, event: { clientX: number; clientY: number }) {
    if (!resolveConnectorEnd(targetId)) return;
    if (connectFromId && connectFromId !== targetId) {
      const fromId = connectFromId;
      setConnectFromId(null);
      void createConnectorBetween(fromId, targetId);
      return;
    }
    const world = worldPointFromClient(event.clientX, event.clientY);
    if (!world) return;
    const draft: ConnectDraft = { fromId: targetId, startX: world.x, startY: world.y, x: world.x, y: world.y, moved: false };
    connectDraftRef.current = draft;
    setConnectDraft(draft);
    setConnectFromId(targetId);
    setStatus("Connector: drag to a target shape (or click it)");
  }

  function updateConnectDraft(event: React.PointerEvent<HTMLElement>) {
    const draft = connectDraftRef.current;
    const world = worldPointFromClient(event.clientX, event.clientY);
    if (!draft || !world) return;
    const moved = draft.moved || Math.hypot(world.x - draft.startX, world.y - draft.startY) > 6;
    const next = { ...draft, x: world.x, y: world.y, moved };
    connectDraftRef.current = next;
    setConnectDraft(next);
  }

  /** Topmost (smallest) visible element under a world point, falling back to the frame. */
  function connectTargetAtWorldPoint(world: { x: number; y: number }): string | null {
    const current = projectRef.current;
    if (!current) return null;
    let best: { id: string; area: number } | null = null;
    for (const element of current.elements) {
      if (!element.visible) continue;
      const bounds = elementWorldBounds(current, element);
      if (!bounds) continue;
      if (world.x < bounds.x || world.x > bounds.x + bounds.width || world.y < bounds.y || world.y > bounds.y + bounds.height) continue;
      const area = bounds.width * bounds.height;
      if (!best || area < best.area) best = { id: element.id, area };
    }
    if (best) return best.id;
    return artboardAtWorldPoint(world)?.id ?? null;
  }

  function finishConnectDraft(event: React.PointerEvent<HTMLElement>) {
    const draft = connectDraftRef.current;
    connectDraftRef.current = null;
    setConnectDraft(null);
    if (!draft) return;
    if (!draft.moved) {
      // A plain click keeps the source armed for click-click connecting.
      setStatus("Connector: now click or drag to the target shape");
      return;
    }
    const world = worldPointFromClient(event.clientX, event.clientY);
    const targetId = world ? connectTargetAtWorldPoint(world) : null;
    setConnectFromId(null);
    if (!targetId || targetId === draft.fromId) {
      setStatus("Connector cancelled — drag from one shape to another");
      return;
    }
    void createConnectorBetween(draft.fromId, targetId);
  }

  async function commitTextEdit(elementId: string, textValue: string) {
    setEditingTextId(null);
    const element = projectRef.current?.elements.find((candidate) => candidate.id === elementId);
    if (!element || readString(element.props.text, "") === textValue) return;
    await runOperation({ type: "update_element", elementId, patch: { props: { text: textValue } } });
  }

  function worldPointFromClient(clientX: number, clientY: number): { x: number; y: number } | null {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    const camera = cameraRef.current;
    return {
      x: (clientX - rect.left - camera.x) / camera.zoom,
      y: (clientY - rect.top - camera.y) / camera.zoom
    };
  }

  function artboardAtWorldPoint(point: { x: number; y: number }): Artboard | null {
    const current = projectRef.current;
    if (!current) return null;
    // Iterate topmost-last so overlapping frames pick the most recently added.
    for (let index = current.artboards.length - 1; index >= 0; index--) {
      const artboard = current.artboards[index]!;
      if (!artboard.visible || artboard.locked) continue;
      const x = CANVAS_ORIGIN_X + artboard.x;
      const y = CANVAS_ORIGIN_Y + artboard.y;
      if (point.x >= x && point.x <= x + artboard.width && point.y >= y && point.y <= y + artboard.height) {
        return artboard;
      }
    }
    return null;
  }

  /** World-plane point (includes CANVAS_ORIGIN) at the center of the visible viewport. */
  function viewportCenterWorldPoint(): { x: number; y: number } | null {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    return worldPointFromClient(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  /** The frame new content should land in: whatever is under the viewport center, else the active/first frame. */
  function insertionArtboard(): Artboard | null {
    const current = projectRef.current;
    if (!current) return null;
    const center = viewportCenterWorldPoint();
    if (center) {
      const under = artboardAtWorldPoint(center);
      if (under) return under;
    }
    return activeArtboard ?? current.artboards.find((artboard) => artboard.visible && !artboard.locked) ?? current.artboards[0] ?? null;
  }

  /** Local x/y that places a new element under the viewport center, always fully inside the frame. */
  function placementInArtboard(artboard: Artboard, width: number, height: number): { x: number; y: number } {
    const maxX = Math.max(8, artboard.width - width - 8);
    const maxY = Math.max(8, artboard.height - height - 8);
    let localX = Math.round((artboard.width - width) / 2);
    let localY = Math.round((artboard.height - height) / 2);
    const center = viewportCenterWorldPoint();
    if (center) {
      localX = Math.round(center.x - (CANVAS_ORIGIN_X + artboard.x) - width / 2);
      localY = Math.round(center.y - (CANVAS_ORIGIN_Y + artboard.y) - height / 2);
    }
    return { x: clamp(localX, 8, maxX), y: clamp(localY, 8, maxY) };
  }

  /** Ensure there's a frame to insert into; auto-create a diagram canvas when the board has none. */
  async function ensureInsertionArtboard(): Promise<Artboard | null> {
    const existing = insertionArtboard();
    if (existing) return existing;
    const current = projectRef.current;
    if (!current) return null;
    const artboard: Artboard = {
      id: createId("art"),
      name: uniqueArtboardName(current, "Canvas"),
      type: "custom",
      x: 120,
      y: 96,
      width: 1800,
      height: 1200,
      background: theme === "dark" ? "#1B2432" : "#FBFCFE",
      frameless: true,
      locked: false,
      visible: true
    };
    try {
      const next = await queueOperation(current.id, { type: "create_artboard", artboard });
      return next ? artboard : null;
    } catch (error) {
      failLoud(error instanceof Error ? error.message : "Could not create a canvas — your change may not be saved");
      return null;
    }
  }

  /** Add an element and select it so it's immediately visible and editable. */
  async function insertElement(element: BoardElement) {
    const boardId = projectRef.current?.id;
    if (!boardId) return;
    setStatus("Saving...");
    try {
      const next = await queueOperation(boardId, { type: "add_element", element });
      if (next && projectRef.current?.id === boardId) {
        await select([element.id]).catch(() => undefined);
        setStatus(`Added ${element.name}`);
      }
    } catch (error) {
      // A failed insert must never hang on "Saving…" — fail loud (persistence P0).
      failLoud(error instanceof Error ? error.message : `Could not add ${element.name} — your change may not be saved`);
    }
  }

  function onViewportPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || spaceDown) return;
    const world = worldPointFromClient(event.clientX, event.clientY);
    if (!world) return;
    if (toolRef.current === "ink") {
      const artboard = artboardAtWorldPoint(world);
      if (!artboard) {
        setStatus("Draw inside a frame or diagram canvas");
        return;
      }
      capturePointer(event.currentTarget, event.pointerId);
      const point: [number, number] = [world.x - CANVAS_ORIGIN_X - artboard.x, world.y - CANVAS_ORIGIN_Y - artboard.y];
      const draft = { artboardId: artboard.id, points: [point] };
      inkDraftRef.current = draft;
      setInkDraft(draft);
      return;
    }
    if (toolRef.current === "connect") {
      setConnectFromId(null);
      setStatus("Connector cancelled — click a shape or frame to start");
      return;
    }
    // Select tool on empty canvas: start a marquee. A click without movement clears selection.
    capturePointer(event.currentTarget, event.pointerId);
    const state: MarqueeState = { startX: world.x, startY: world.y, x: world.x, y: world.y, width: 0, height: 0 };
    marqueeRef.current = state;
    setMarquee(state);
  }

  function updateMarquee(event: React.PointerEvent<HTMLDivElement>) {
    const active = marqueeRef.current;
    const world = worldPointFromClient(event.clientX, event.clientY);
    if (!active || !world) return;
    const next: MarqueeState = {
      startX: active.startX,
      startY: active.startY,
      x: Math.min(active.startX, world.x),
      y: Math.min(active.startY, world.y),
      width: Math.abs(world.x - active.startX),
      height: Math.abs(world.y - active.startY)
    };
    marqueeRef.current = next;
    setMarquee(next);
  }

  function finishMarquee() {
    const active = marqueeRef.current;
    marqueeRef.current = null;
    setMarquee(null);
    if (!active) return;
    const current = projectRef.current;
    if (!current) return;
    if (active.width < 4 && active.height < 4) {
      void select([]);
      return;
    }
    const box: Bounds = { x: active.x, y: active.y, width: active.width, height: active.height };
    const hitArtboards = current.artboards
      .filter((artboard) => artboard.visible && boundsIntersect(box, artboardWorldBounds(artboard)) && boundsContain(box, artboardWorldBounds(artboard)))
      .map((artboard) => artboard.id);
    const hitElements = current.elements
      .filter((element) => {
        if (!element.visible || element.parentId) return false;
        const bounds = elementWorldBounds(current, element);
        return bounds ? boundsIntersect(box, bounds) : false;
      })
      .map((element) => element.id);
    const ids = hitArtboards.length && !hitElements.length ? hitArtboards : hitElements;
    void select(ids);
    setStatus(ids.length ? `Selected ${ids.length} ${pluralize(ids.length, "item")}` : "Nothing in selection");
  }

  function updateInkDraft(event: React.PointerEvent<HTMLDivElement>) {
    const draft = inkDraftRef.current;
    const world = worldPointFromClient(event.clientX, event.clientY);
    const current = projectRef.current;
    if (!draft || !world || !current) return;
    const artboard = current.artboards.find((candidate) => candidate.id === draft.artboardId);
    if (!artboard) return;
    const point: [number, number] = [world.x - CANVAS_ORIGIN_X - artboard.x, world.y - CANVAS_ORIGIN_Y - artboard.y];
    const last = draft.points[draft.points.length - 1];
    if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 2.5) return;
    const next = { ...draft, points: [...draft.points, point] };
    inkDraftRef.current = next;
    setInkDraft(next);
  }

  async function finishInkDraft() {
    const draft = inkDraftRef.current;
    inkDraftRef.current = null;
    setInkDraft(null);
    const current = projectRef.current;
    if (!draft || !current || draft.points.length < 2) return;
    const xs = draft.points.map(([x]) => x);
    const ys = draft.points.map(([, y]) => y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = Math.max(8, Math.max(...xs) - minX);
    const height = Math.max(8, Math.max(...ys) - minY);
    const normalized = draft.points.map(([x, y]) => [round2((x - minX) / width), round2((y - minY) / height)] as [number, number]);
    const element = createElementFromPreset("ink", draft.artboardId, Math.round(minX), Math.round(minY));
    element.width = Math.round(width);
    element.height = Math.round(height);
    element.props = { ...element.props, points: normalized };
    element.name = uniqueElementName(current, draft.artboardId, "Ink stroke");
    await runOperation({ type: "add_element", element });
    setStatus("Ink stroke added — keep drawing or press Esc for select");
  }

  /**
   * Mermaid is a hand-off artefact, not a picture: it goes to the clipboard, because its destination
   * is a README or a doc, and it is written to the board's exports folder for agents at the same time.
   */
  async function exportMermaidDiagram() {
    if (!project) return;
    let mermaid: string;
    try {
      await operationQueueRef.current.catch(() => null);
      mermaid = (await exportMermaid(project.id)).mermaid;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Mermaid export failed");
      return;
    }
    try {
      await navigator.clipboard.writeText(mermaid);
      setStatus("Mermaid copied to the clipboard — paste it into any Markdown doc");
    } catch (error) {
      console.error("Mermaid clipboard write failed", error);
      setStatus("Mermaid generated, but the clipboard was blocked — saved to the board's exports folder");
    }
  }

  async function backupAllNow() {
    try {
      setStatus("Backing up…");
      const result = await backupNow();
      await refreshStorageStatus().catch(() => undefined);
      if (result.failed.length) {
        failLoud(`Backup finished with ${result.failed.length} failure(s): ${result.failed[0]?.error}`);
      } else {
        setStatus(`Backed up ${result.backedUp.length} ${pluralize(result.backedUp.length, "board")}`);
      }
    } catch (error) {
      failLoud(error instanceof Error ? error.message : "Backup failed");
    }
  }

  /** Briefly re-mark elements agent-active so their canvas pulse replays (click-to-focus, no edit). */
  function pulseElements(ids: string[]) {
    const clean = uniqueStrings(ids);
    if (!clean.length) return;
    const expiresAt = Date.now() + 1400;
    setAgentActiveUntilById((current) => {
      const next = { ...current };
      for (const id of clean) next[id] = Math.max(next[id] ?? 0, expiresAt);
      return next;
    });
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setAgentActiveUntilById((current) => {
        let changed = false;
        const next = { ...current };
        for (const [id, expiry] of Object.entries(current)) {
          if (expiry <= now) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, 1500);
    agentActivityTimersRef.current.push(timer);
  }

  function focusAgentTargets(ids: string[]) {
    const current = projectRef.current;
    if (!current) return;
    const bounds = boundsForSelection(current, ids);
    if (!bounds) return;
    void select(ids);
    focusBounds(bounds, "Focused agent edit");
    pulseElements(ids);
  }

  function escapeAction() {
    if (commandOpen) return setCommandOpen(false);
    if (shortcutsOpen) return setShortcutsOpen(false);
    if (restoreOpen) return setRestoreOpen(false);
    if (exportOpen) return setExportOpen(false);
    if (connectOpen) return setConnectOpen(false);
    if (editingTextId) return setEditingTextId(null);
    if (focusMode) {
      setFocusMode(false);
      setStatus("Exited focus mode");
      return;
    }
    if (connectFromId || connectDraftRef.current) {
      connectDraftRef.current = null;
      setConnectDraft(null);
      setConnectFromId(null);
      setStatus("Connector cancelled");
      return;
    }
    if (toolRef.current !== "select") {
      setTool("select");
      setStatus("Select tool");
      return;
    }
    void select([]);
  }

  // Keyboard actions read through a ref so the singleton key handler always sees fresh closures.
  actionsRef.current = {
    escape: escapeAction,
    deleteSelection: () => void deleteSelection(),
    duplicate: () => void duplicateSelection(),
    group: () => void groupSelection(),
    undo: () => void undoBoard(),
    redo: () => void redoBoard(),
    fitAll,
    commandPalette: () => setCommandOpen((current) => !current),
    shortcuts: () => setShortcutsOpen((current) => !current),
    focusMode: () => setFocusMode((current) => !current),
    connectAgent: () => setConnectOpen(true),
    exportImage: () => void openExportDialog()
  };
  nudgeRef.current = (dx, dy) => void nudgeSelection(dx, dy);

  async function uploadImage(kind: "image" | "screenshot", file: File) {
    if (!project || !activeArtboard) return;
    setStatus(kind === "screenshot" ? "Importing screenshot..." : "Uploading image...");
    await operationQueueRef.current.catch(() => null);
    const result = await uploadAsset(project.id, file);
    projectRef.current = result.project;
    setProject(result.project);
    const element = createElementFromPreset(kind === "screenshot" ? "screenshotOverlay" : "image", activeArtboard.id, kind === "screenshot" ? 0 : 32, kind === "screenshot" ? 0 : 132);
    element.props.assetId = result.assetId;
    element.name = uniqueElementName(project, activeArtboard.id, kind === "screenshot" ? `${activeArtboard.name} / Screenshot Overlay` : `${activeArtboard.name} / ${file.name}`);
    element.locked = kind === "screenshot";
    if (kind === "screenshot") {
      element.width = activeArtboard.width;
      element.height = activeArtboard.height;
      element.zIndex = 0;
    }
    await queueOperation(project.id, { type: "add_element", element }).then((next) => {
      if (!next) return;
      setStatus(kind === "screenshot" ? "Screenshot overlay imported" : "Image added");
    });
  }

  /** Opens the Export dialog with pending edits flushed, so the image can never be a frame behind. */
  async function openExportDialog() {
    if (!project) return;
    await operationQueueRef.current.catch(() => null);
    setExportOpen(true);
  }

  async function exportCode() {
    if (!project) return;
    try {
      await operationQueueRef.current.catch(() => null);
      const result = await exportReactTailwind(project.id);
      setStatus(`React + Tailwind exported — ${result.files.length} files in the board's exports folder (File ▸ Reveal Boards Folder)`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "React export failed");
    }
  }

  async function exportImplementationSpec() {
    if (!project) return;
    try {
      await operationQueueRef.current.catch(() => null);
      await exportSpec(project.id);
      setStatus("Implementation spec exported to the board's exports folder (File ▸ Reveal Boards Folder)");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Spec export failed");
    }
  }

  async function undoBoard() {
    if (!project) return;
    try {
      await operationQueueRef.current.catch(() => null);
      const next = await undo(project.id);
      projectRef.current = next;
      setProject(next);
      selectedIdsRef.current = next.selection;
      setSelectedIds(next.selection);
      rememberBoard(next);
      setStatus("Undo");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Undo failed");
    }
  }

  async function redoBoard() {
    if (!project) return;
    try {
      await operationQueueRef.current.catch(() => null);
      const next = await redo(project.id);
      projectRef.current = next;
      setProject(next);
      selectedIdsRef.current = next.selection;
      setSelectedIds(next.selection);
      rememberBoard(next);
      setStatus("Redo");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Redo failed");
    }
  }

  async function updateArtboard(patch: Partial<Artboard>) {
    if (!project || !selectedArtboard) return;
    await runOperation({ type: "update_artboard", artboardId: selectedArtboard.id, patch });
  }

  function focusSelection() {
    if (!project) return;
    const bounds = boundsForSelection(project, selectedIds);
    if (!bounds) {
      setStatus("Select a frame or element to focus");
      return;
    }
    focusBounds(bounds, "Focused selection");
  }

  function fitAll() {
    if (!project) return;
    const bounds = boundsForProject(project);
    if (!bounds) {
      setStatus("No visible frames to fit");
      return;
    }
    focusBounds(bounds, "Fit visible frames");
  }

  function togglePanel(panelId: string) {
    setCollapsedPanels((current) => ({ ...current, [panelId]: !current[panelId] }));
  }

  function updatePanePrefs(patch: Partial<PanePrefs>) {
    setPanePrefs((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(PANE_PREFS_KEY, JSON.stringify(next));
      } catch (error) {
        console.error("Failed to persist pane preferences", error);
      }
      return next;
    });
  }

  function toggleLeftPane() {
    setStatus(leftPaneOpen ? "Left panel hidden" : "Left panel shown");
    updatePanePrefs({ leftOpen: !leftPaneOpen });
  }

  function toggleRightPane() {
    setStatus(rightPaneOpen ? "Right panel hidden" : "Right panel shown");
    updatePanePrefs({ rightOpen: !rightPaneOpen });
  }

  /** Drag the pane's inner edge to resize it; width persists as a UI preference. */
  function beginPaneResize(side: "left" | "right", event: React.PointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startWidth = side === "left" ? panePrefs.leftWidth : panePrefs.rightWidth;
    paneResizeRef.current = { side, startX: event.clientX, startWidth };
    const onMove = (move: PointerEvent) => {
      const active = paneResizeRef.current;
      if (!active) return;
      const delta = active.side === "left" ? move.clientX - active.startX : active.startX - move.clientX;
      const min = active.side === "left" ? LEFT_PANE_MIN : RIGHT_PANE_MIN;
      const max = active.side === "left" ? LEFT_PANE_MAX : RIGHT_PANE_MAX;
      const width = clamp(Math.round(active.startWidth + delta), min, max);
      updatePanePrefs(active.side === "left" ? { leftWidth: width } : { rightWidth: width });
    };
    const onUp = () => {
      paneResizeRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function focusBounds(bounds: Bounds, message: string) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const padding = 180;
    const zoomForWidth = rect.width / Math.max(1, bounds.width + padding);
    const zoomForHeight = rect.height / Math.max(1, bounds.height + padding);
    const nextZoom = clamp(Math.min(zoomForWidth, zoomForHeight), MIN_ZOOM, MAX_ZOOM);
    applyCamera({
      zoom: nextZoom,
      x: rect.width / 2 - (bounds.x + bounds.width / 2) * nextZoom,
      y: rect.height / 2 - (bounds.y + bounds.height / 2) * nextZoom
    });
    setStatus(message);
  }

  function zoomAtViewportCenter(nextZoom: number) {
    const viewport = viewportRef.current;
    if (!viewport) {
      applyCamera({ ...cameraRef.current, zoom: clamp(nextZoom, MIN_ZOOM, MAX_ZOOM) });
      return;
    }
    const rect = viewport.getBoundingClientRect();
    zoomAroundViewportPoint(nextZoom, { x: rect.width / 2, y: rect.height / 2 });
  }

  function zoomAroundViewportPoint(nextZoom: number, point: ViewportPoint) {
    const nextCamera = zoomCameraAroundPoint(cameraRef.current, nextZoom, point, MIN_ZOOM, MAX_ZOOM);
    if (nextCamera.zoom === cameraRef.current.zoom) return;
    applyCamera(nextCamera);
  }

  function applyCamera(nextCamera: Camera) {
    const camera = {
      x: normalizeCameraNumber(nextCamera.x),
      y: normalizeCameraNumber(nextCamera.y),
      zoom: clamp(nextCamera.zoom, MIN_ZOOM, MAX_ZOOM)
    };
    cameraRef.current = camera;
    if (canvasPlaneRef.current) {
      canvasPlaneRef.current.style.transform = cameraTransform(camera);
      // Publish live zoom so on-plane affordances (rings, handles, guides) can hold a
      // constant screen size via calc(px / var(--zoom)) — no blur/double at 50%/400%.
      canvasPlaneRef.current.style.setProperty("--zoom", String(camera.zoom));
    }
    if (zoomStateFrameRef.current !== null) return;
    zoomStateFrameRef.current = window.requestAnimationFrame(() => {
      zoomStateFrameRef.current = null;
      setZoom(cameraRef.current.zoom);
    });
  }

  function rememberViewportPointFromReact(event: React.PointerEvent<HTMLElement>) {
    rememberViewportPoint(event.nativeEvent);
  }

  function rememberViewportPoint(event: { clientX?: number; clientY?: number }) {
    const viewport = viewportRef.current;
    if (!viewport || typeof event.clientX !== "number" || typeof event.clientY !== "number") return;
    const rect = viewport.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (point.x < 0 || point.y < 0 || point.x > rect.width || point.y > rect.height) return;
    lastViewportPointRef.current = point;
  }

  function resolveViewportPoint(event?: { clientX?: number; clientY?: number }, fallback?: ViewportPoint): ViewportPoint {
    const viewport = viewportRef.current;
    if (!viewport) return fallback ?? lastViewportPointRef.current ?? { x: 0, y: 0 };
    if (event && typeof event.clientX === "number" && typeof event.clientY === "number") {
      const rect = viewport.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (point.x >= 0 && point.y >= 0 && point.x <= rect.width && point.y <= rect.height) {
        return point;
      }
    }
    const rect = viewport.getBoundingClientRect();
    return fallback ?? lastViewportPointRef.current ?? { x: rect.width / 2, y: rect.height / 2 };
  }

  function onCanvasPointerDownCapture(event: React.PointerEvent<HTMLDivElement>) {
    if (!viewportRef.current) return;
    if (event.button !== 1 && !spaceDown) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some browsers do not allow capture for every pointer type.
    }
    setPan({
      startX: event.clientX,
      startY: event.clientY,
      cameraX: cameraRef.current.x,
      cameraY: cameraRef.current.y
    });
  }

  if (!project && !homeOpen) {
    return (
      <main className="loading-shell">
        <div className="loading-mark"><BrandMark /></div>
        <p>{status}</p>
      </main>
    );
  }

  const canDeleteSelection = Boolean(project && selectedIds.some((id) => project.elements.some((element) => element.id === id)));

  const paletteCommands: PaletteCommand[] = project
    ? [
        { id: "new-board", section: "Board", title: "New board", run: () => void createNewBoard(), keywords: "create" },
        { id: "go-home", section: "Board", title: "Go to all boards", run: () => void showHome() },
        { id: "undo", section: "Edit", title: "Undo", hint: "⌘Z", run: () => void undoBoard() },
        { id: "redo", section: "Edit", title: "Redo", hint: "⌘⇧Z", run: () => void redoBoard() },
        { id: "duplicate", section: "Edit", title: "Duplicate selection", hint: "⌘D", run: () => void duplicateSelection() },
        { id: "group", section: "Edit", title: "Group selection", hint: "⌘G", run: () => void groupSelection() },
        { id: "delete", section: "Edit", title: "Delete selection", hint: "⌫", run: () => void deleteSelection() },
        { id: "add-frame", section: "Insert", title: "Add device frame", run: () => void addArtboard(), keywords: "artboard screen" },
        { id: "add-canvas", section: "Insert", title: "Add diagram canvas", run: () => void addDiagramCanvas(), keywords: "diagram frameless" },
        ...componentTypes.map((type) => ({ id: `add-${type}`, section: "Insert · Mockup", title: `Add ${labelFor(type)}`, run: () => void addComponent(type), keywords: "component element" })),
        ...DIAGRAM_SHAPES.map(({ kind, label }) => ({ id: `shape-${kind}`, section: "Insert · Diagram", title: `Add ${label} shape`, run: () => void addShape(kind, label), keywords: `shape ${kind}` })),
        { id: "tool-connect", section: "Tools", title: "Connector tool", run: () => setTool("connect"), keywords: "arrow edge link" },
        { id: "tool-ink", section: "Tools", title: "Ink / freehand tool", run: () => setTool("ink"), keywords: "draw pen pencil" },
        { id: "tool-select", section: "Tools", title: "Select tool", run: () => setTool("select") },
        { id: "layout-tree", section: "Layout", title: "Tree layout (org chart)", run: () => void runLayout("tree") },
        { id: "layout-flow", section: "Layout", title: "Flow layout (left→right)", run: () => void runLayout("flow") },
        { id: "align-left", section: "Layout", title: "Align left", run: () => void runLayout("align-left") },
        { id: "align-center-x", section: "Layout", title: "Align centers (horizontal)", run: () => void runLayout("align-center-x") },
        { id: "align-top", section: "Layout", title: "Align top", run: () => void runLayout("align-top") },
        { id: "distribute-h", section: "Layout", title: "Distribute horizontally", run: () => void runLayout("distribute-horizontal") },
        { id: "distribute-v", section: "Layout", title: "Distribute vertically", run: () => void runLayout("distribute-vertical") },
        { id: "export-image", section: "Export", title: "Export image…", hint: "⌘⇧E", keywords: "png jpg svg pdf download save picture screenshot slide deck", run: () => void openExportDialog() },
        { id: "export-spec", section: "Export", title: "Export implementation spec", run: () => void exportImplementationSpec() },
        { id: "export-react", section: "Export", title: "Export React + Tailwind", run: () => void exportCode() },
        { id: "export-mermaid", section: "Export", title: "Export Mermaid diagram", run: () => void exportMermaidDiagram() },
        { id: "fit-all", section: "View", title: "Fit all frames", hint: "⌘1", run: fitAll },
        { id: "focus-selection", section: "View", title: "Focus selection", run: focusSelection },
        { id: "zoom-100", section: "View", title: "Zoom to 100%", hint: "⌘0", run: () => { zoomAtViewportCenter(1); setStatus("Zoom 100%"); } },
        { id: "focus-mode", section: "View", title: focusMode ? "Exit focus mode" : "Enter focus mode", hint: "F", run: () => setFocusMode((current) => !current) },
        { id: "theme", section: "View", title: theme === "dark" ? "Switch to light mode" : "Switch to dark mode", run: () => setTheme((current) => (current === "dark" ? "light" : "dark")) },
        { id: "connect-agent", section: "Agent", title: "Connect an agent (MCP)…", run: () => setConnectOpen(true), keywords: "mcp claude cursor endpoint" },
        { id: "backup-now", section: "Backup", title: "Back up all boards now", run: () => void backupAllNow() },
        { id: "restore", section: "Backup", title: "Restore from backup…", run: () => setRestoreOpen(true) },
        { id: "shortcuts", section: "Help", title: "Keyboard shortcuts", hint: "?", run: () => setShortcutsOpen(true) }
      ]
    : [];

  const chromeHidden = homeOpen || focusMode;
  return (
    <main
      className={classNames("app-shell", homeOpen && "home-mode", !leftPaneOpen && "left-pane-hidden", !rightPaneOpen && "right-pane-hidden", focusMode && !homeOpen && "focus-mode")}
      style={{
        ["--left-panel-width" as string]: !chromeHidden && leftPaneOpen ? `${panePrefs.leftWidth}px` : "0px",
        ["--right-panel-width" as string]: !chromeHidden && rightPaneOpen ? `${panePrefs.rightWidth}px` : "0px"
      } as React.CSSProperties}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
    >
      {!homeOpen && focusMode ? <div className="focus-reveal-strip" aria-hidden="true" /> : null}
      <header className="topbar">
        <div className="topbar-left">
          <a className="brand-block" href={routeHash({ view: "home" })} data-tip="All boards" aria-label="All boards">
            <div className="brand-mark"><BrandMark /></div>
            {homeOpen ? (
              <div className="brand-title">
                <h1>PowerBoard</h1>
                <p>the agent-native visual workspace</p>
              </div>
            ) : (
              /* One line, read as a breadcrumb. The stacked title + "Boards" sub-line forced a 64px
                 top bar and still didn't say it was navigation. */
              <div className="brand-title crumb">
                <span className="brand-crumb"><Home size={11} /> Boards</span>
                <ChevronRight size={11} aria-hidden="true" />
                <h1>{project?.name ?? "PowerBoard"}</h1>
              </div>
            )}
          </a>
        </div>

        {!homeOpen ? (
          <>
            <div className="topbar-center">
              <div className="toolbar-group segmented tool-switcher" aria-label="Canvas tools">
                <IconButton label="Select tool (V)" active={tool === "select"} onClick={() => (setTool("select"), setConnectFromId(null), setStatus("Select tool"))}>
                  <MousePointer2 size={18} />
                </IconButton>
                <IconButton label="Connector tool — click two shapes" active={tool === "connect"} onClick={() => (setTool("connect"), setStatus("Connector: click a shape or frame to start"))}>
                  <Spline size={18} />
                </IconButton>
                <IconButton label="Ink / freehand tool" active={tool === "ink"} onClick={() => (setTool("ink"), setStatus("Ink: draw inside a frame"))}>
                  <PenTool size={18} />
                </IconButton>
              </div>

              <ToolbarMenu id="insert" label="Insert" icon={<Plus size={16} />}>
                {(close) => (
                  <>
                    <div className="menu-heading">New frame</div>
                    {INSERT_FRAME_PRESETS.map((preset) => (
                      <button key={preset.id} className="menu-item preset-item" onClick={() => { void addArtboard(preset.id); close(); }}>
                        {preset.type === "mobile" ? <Smartphone size={15} /> : preset.type === "tablet" ? <Tablet size={15} /> : <Monitor size={15} />}
                        <span className="preset-name">{preset.name}</span>
                        <span className="preset-size">{preset.width}×{preset.height}</span>
                      </button>
                    ))}
                    <button className="menu-item preset-item" onClick={() => { void addDiagramCanvas(); close(); }}>
                      <GitBranch size={15} />
                      <span className="preset-name">Diagram canvas</span>
                      <span className="preset-size">freeform</span>
                    </button>
                    <div className="menu-divider" />
                    <div className="menu-heading">Quick add</div>
                    <button className="menu-item" onClick={() => { void addComponent("sticky"); close(); }}><StickyNote size={15} /> Sticky note</button>
                    <button className="menu-item" onClick={() => { void addComponent("text"); close(); }}><Type size={15} /> Text</button>
                  </>
                )}
              </ToolbarMenu>

              <ToolbarMenu id="arrange" label="Arrange" icon={<Network size={16} />}>
                {(close) => (
                  <>
                    <div className="menu-heading">Align</div>
                    <div className="menu-grid">
                      <button className="menu-icon" data-tip="Align left" aria-label="Align left" disabled={selectedIds.length < 2} onClick={() => { void runLayout("align-left"); close(); }}><AlignStartVertical size={16} /></button>
                      <button className="menu-icon" data-tip="Align centers" aria-label="Align centers" disabled={selectedIds.length < 2} onClick={() => { void runLayout("align-center-x"); close(); }}><AlignCenterVertical size={16} /></button>
                      <button className="menu-icon" data-tip="Align right" aria-label="Align right" disabled={selectedIds.length < 2} onClick={() => { void runLayout("align-right"); close(); }}><AlignEndVertical size={16} /></button>
                      <button className="menu-icon" data-tip="Align top" aria-label="Align top" disabled={selectedIds.length < 2} onClick={() => { void runLayout("align-top"); close(); }}><AlignStartHorizontal size={16} /></button>
                      <button className="menu-icon" data-tip="Align middles" aria-label="Align middles" disabled={selectedIds.length < 2} onClick={() => { void runLayout("align-center-y"); close(); }}><AlignCenterHorizontal size={16} /></button>
                      <button className="menu-icon" data-tip="Align bottom" aria-label="Align bottom" disabled={selectedIds.length < 2} onClick={() => { void runLayout("align-bottom"); close(); }}><AlignEndHorizontal size={16} /></button>
                    </div>
                    <div className="menu-divider" />
                    <button className="menu-item" disabled={selectedIds.length < 3} onClick={() => { void runLayout("distribute-horizontal"); close(); }}><AlignHorizontalDistributeCenter size={15} /> Distribute horizontally</button>
                    <button className="menu-item" disabled={selectedIds.length < 3} onClick={() => { void runLayout("distribute-vertical"); close(); }}><AlignVerticalDistributeCenter size={15} /> Distribute vertically</button>
                    <div className="menu-divider" />
                    <button className="menu-item" onClick={() => { void runPolish(); close(); }}><Wand2 size={15} /> Tidy up (align, even out, snap)</button>
                    <div className="menu-divider" />
                    <button className="menu-item" onClick={() => { void runLayout("tree"); close(); }}><Network size={15} /> Tree layout (org chart)</button>
                    <button className="menu-item" onClick={() => { void runLayout("flow"); close(); }}><Workflow size={15} /> Flow layout (left→right)</button>
                  </>
                )}
              </ToolbarMenu>

              <div className="toolbar-group segmented" aria-label="Edit">
                <IconButton label="Undo (⌘Z)" onClick={undoBoard}>
                  <Undo2 size={18} />
                </IconButton>
                <IconButton label="Redo (⌘⇧Z)" onClick={redoBoard}>
                  <Redo2 size={18} />
                </IconButton>
              </div>

              <ToolbarMenu id="export" label="Export" icon={<Download size={16} />}>
                {(close) => (
                  <>
                    <div className="menu-heading">Image</div>
                    <button className="menu-item" onClick={() => { void openExportDialog(); close(); }}>
                      <Download size={15} /> Export image… <span className="menu-hint">⌘⇧E</span>
                    </button>
                    <p className="menu-note">PNG, JPG, SVG or PDF — up to 4×, transparent or solid, straight to your Downloads or clipboard.</p>
                    <div className="menu-divider" />
                    <div className="menu-heading">Hand-off</div>
                    <button className="menu-item" onClick={() => { void exportImplementationSpec(); close(); }}><FileText size={15} /> Implementation spec</button>
                    <button className="menu-item" onClick={() => { void exportCode(); close(); }}><FileCode2 size={15} /> React + Tailwind</button>
                    <button className="menu-item" onClick={() => { void exportMermaidDiagram(); close(); }}><Workflow size={15} /> Mermaid diagram</button>
                  </>
                )}
              </ToolbarMenu>
            </div>

            <div className="toolbar-spacer" />

            <div className="topbar-right">
              <button className="connect-agent-button" onClick={() => setConnectOpen(true)} data-tip="Connect an AI agent to this board">
                <Cable size={16} /> Connect agent
              </button>
              <div className="toolbar-group segmented">
                <IconButton label="Command palette (⌘K)" onClick={() => setCommandOpen(true)}>
                  <CommandIcon size={17} />
                </IconButton>
                <IconButton label={focusMode ? "Exit focus mode (F)" : "Focus mode — hide panels (F)"} active={focusMode} onClick={() => setFocusMode((current) => !current)}>
                  {focusMode ? <Minimize2 size={18} /> : <Expand size={18} />}
                </IconButton>
                <IconButton label="Keyboard shortcuts (?)" onClick={() => setShortcutsOpen(true)}>
                  <Keyboard size={18} />
                </IconButton>
                <IconButton label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}>
                  {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
                </IconButton>
              </div>
            </div>
          </>
        ) : (
          <div className="toolbar-spacer" />
        )}
      </header>

      {homeOpen ? (
        <HomeView boards={boardSummaries} previews={boardPreviews} storageStatus={storageStatus} loading={boardsLoading} error={boardsError} onRetry={() => void refreshBoards().catch(() => undefined)} onOpen={openBoard} onCreate={createNewBoard} onDelete={requestDeleteBoard} onConnect={() => setConnectOpen(true)} />
      ) : project ? (
        <>
      {leftPaneOpen ? (
        <aside className="left-panel">
        <div className="pane-top">
          <div className="palette-mode-switch" role="tablist" aria-label="Palette mode">
            <button role="tab" aria-selected={paletteMode === "mockup"} className={paletteMode === "mockup" ? "active" : ""} onClick={() => setPaletteMode("mockup")}>
              <Component size={14} /> Mockup
            </button>
            <button role="tab" aria-selected={paletteMode === "diagram"} className={paletteMode === "diagram" ? "active" : ""} onClick={() => setPaletteMode("diagram")}>
              <Shapes size={14} /> Diagram
            </button>
          </div>
          <button className="pane-collapse" data-tip="Hide panel" aria-label="Hide left panel" onClick={toggleLeftPane}>
            <PanelLeftClose size={15} />
          </button>
        </div>

        {/* Structure before palette. The layer tree is the surface a designer touches most, and it
            used to start ~80px below the fold behind the whole component palette. It now leads the
            panel and flex-grows, so it is visible without scrolling at any window height. */}
        <CollapsiblePanel id="layers" icon={<Layers3 size={16} />} title="Layers" className="layers-section" collapsed={Boolean(collapsedPanels.layers)} onToggle={togglePanel}>
          {project.artboards.length ? (
            <div className="layers-list">
              {project.artboards.map((artboard) => (
                <FrameLayerGroup
                  key={artboard.id}
                  artboard={artboard}
                  project={project}
                  indexes={elementIndexes}
                  selectedIds={selectedIds}
                  onSelect={select}
                  onUpdate={(elementId, patch) => runOperation({ type: "update_element", elementId, patch })}
                  onDelete={(elementId) => runOperation({ type: "delete_element", elementId })}
                  onUpdateArtboard={(patch) => runOperation({ type: "update_artboard", artboardId: artboard.id, patch })}
                  onDeleteArtboard={() => runOperation({ type: "delete_artboard", artboardId: artboard.id })}
                />
              ))}
            </div>
          ) : (
            <p className="muted">No frames yet. Add a device frame or diagram canvas from the toolbar.</p>
          )}
        </CollapsiblePanel>

        {paletteMode === "mockup" ? (
          <CollapsiblePanel id="app-kit" icon={<Component size={16} />} title="App Kit" collapsed={Boolean(collapsedPanels["app-kit"])} onToggle={togglePanel}>
            <div className="component-grid">
              {componentTypes.map((type) => (
                <button key={type} onClick={() => addComponent(type)}>
                  {labelFor(type)}
                </button>
              ))}
            </div>
          </CollapsiblePanel>
        ) : (
          <>
            <CollapsiblePanel id="shapes" icon={<Shapes size={16} />} title="Shapes" collapsed={Boolean(collapsedPanels.shapes)} onToggle={togglePanel}>
              <div className="shape-grid">
                {DIAGRAM_SHAPES.map(({ kind, label }) => (
                  <button key={kind} className="shape-tile" onClick={() => addShape(kind, label)} data-tip={label} aria-label={label}>
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                      <ShapeOutline kind={kind} fill="none" stroke="currentColor" strokeWidth={4} />
                    </svg>
                  </button>
                ))}
              </div>
            </CollapsiblePanel>
            <CollapsiblePanel id="diagram-tools" icon={<Workflow size={16} />} title="Diagram tools" collapsed={Boolean(collapsedPanels["diagram-tools"])} onToggle={togglePanel}>
              <button className="wide-action" onClick={addDiagramCanvas}>
                <GitBranch size={16} /> New diagram canvas
              </button>
              <button className="wide-action" onClick={() => (setTool("connect"), setStatus("Connector: click a shape to start"))}>
                <Spline size={16} /> Connector tool
              </button>
              <button className="wide-action" onClick={() => (setTool("ink"), setStatus("Ink: draw inside a frame"))}>
                <PenTool size={16} /> Freehand ink
              </button>
              <button className="wide-action" onClick={() => addComponent("sticky")}>
                <StickyNote size={16} /> Sticky note
              </button>
              <div className="segmented-row">
                <button onClick={() => runLayout("tree")}>
                  <Network size={15} /> Tree
                </button>
                <button onClick={() => runLayout("flow")}>
                  <Workflow size={15} /> Flow
                </button>
              </div>
            </CollapsiblePanel>
          </>
        )}

        <CollapsiblePanel id="assets" icon={<Upload size={16} />} title="Assets" collapsed={Boolean(collapsedPanels.assets)} onToggle={togglePanel}>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(event) => event.target.files?.[0] && uploadImage("image", event.target.files[0])} />
          <input ref={screenshotInputRef} type="file" accept="image/*" hidden onChange={(event) => event.target.files?.[0] && uploadImage("screenshot", event.target.files[0])} />
          <button className="wide-action" onClick={() => fileInputRef.current?.click()}>
            <ImageIcon size={16} /> Add image
          </button>
          <button className="wide-action" onClick={() => screenshotInputRef.current?.click()}>
            <BoxSelect size={16} /> Screenshot overlay
          </button>
          <div className="asset-list">
            {project.assets.length ? (
              project.assets.map((asset) => (
                <div key={asset.id} className="asset-row">
                  <img src={asset.src} alt="" />
                  <span>{asset.name}</span>
                </div>
              ))
            ) : (
              <p className="muted">No assets yet.</p>
            )}
          </div>
        </CollapsiblePanel>

        </aside>
      ) : null}
      {!chromeHidden && leftPaneOpen ? (
        <div className="pane-resize-handle left-handle" title="Drag to resize" onPointerDown={(event) => beginPaneResize("left", event)} />
      ) : null}

      <section
        ref={viewportRef}
        className={classNames("canvas-viewport", pan && "panning", spaceDown && "space-pan", tool !== "select" && `tool-${tool}`, connectFromId && "connect-armed")}
        onPointerDownCapture={onCanvasPointerDownCapture}
        onPointerMove={rememberViewportPointFromReact}
        onPointerDown={onViewportPointerDown}
      >
        <div className="canvas-space">
          <div ref={canvasPlaneRef} className="canvas-plane" style={{ transform: cameraTransform(cameraRef.current), width: CANVAS_WIDTH, height: CANVAS_HEIGHT, ["--zoom" as string]: cameraRef.current.zoom }}>
            <div className="canvas-grid" />
            <ConnectorLayer
              project={project}
              selectedIds={selectedIds}
              agentActiveIds={agentActiveIds}
              zoom={zoom}
              onSelect={select}
              onSetWaypoint={(connectorId, point) => void runOperation({ type: "update_connector", connectorId, patch: { waypoints: point ? [point] : [] } })}
              clientToWorld={worldPointFromClient}
            />
            {project.artboards
              .filter((artboard) => artboard.visible)
              .map((artboard) => (
                <ArtboardView
                  key={artboard.id}
                  artboard={artboard}
                  project={project}
                  indexes={elementIndexes}
                  selectedIds={selectedIds}
                  agentActiveIds={agentActiveIds}
                  tool={tool}
                  connectFromId={connectFromId}
                  editingTextId={editingTextId}
                  onSelect={(ids, additive) => select(ids, additive)}
                  onDragStart={beginDrag}
                  onConnectTap={onConnectDown}
                  onBeginTextEdit={setEditingTextId}
                  onCommitText={commitTextEdit}
                />
              ))}
            {inkDraft ? <InkDraftLayer draft={inkDraft} project={project} /> : null}
            {agentReticles.map((reticle) => (
              <AgentReticle key={reticle.agentId} presence={reticle} bounds={reticle.bounds} zoom={zoom} named={agentReticles.length > 1} />
            ))}
            {snapGuides.vertical.map((x) => (
              <div key={`v-${x}`} className="snap-guide vertical" style={{ left: x }} />
            ))}
            {snapGuides.horizontal.map((y) => (
              <div key={`h-${y}`} className="snap-guide horizontal" style={{ top: y }} />
            ))}
            {marquee ? <div className="marquee-box" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} /> : null}
            {connectDraft?.moved
              ? (() => {
                  const source = boundsForSelection(project, [connectDraft.fromId]);
                  if (!source) return null;
                  const x1 = source.x + source.width / 2;
                  const y1 = source.y + source.height / 2;
                  const minX = Math.min(x1, connectDraft.x) - 8;
                  const minY = Math.min(y1, connectDraft.y) - 8;
                  const width = Math.abs(connectDraft.x - x1) + 16;
                  const height = Math.abs(connectDraft.y - y1) + 16;
                  return (
                    <svg className="connect-draft-line" style={{ left: minX, top: minY, width, height }} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
                      <line x1={x1 - minX} y1={y1 - minY} x2={connectDraft.x - minX} y2={connectDraft.y - minY} strokeWidth={2 / zoom} strokeDasharray={`${6 / zoom} ${5 / zoom}`} />
                      <circle cx={connectDraft.x - minX} cy={connectDraft.y - minY} r={4 / zoom} />
                    </svg>
                  );
                })()
              : null}
            {selectionBounds && !drag && !marquee && !connectDraft && !editingTextId && tool === "select" ? (
              <div className="selection-actionbar-anchor" style={{ left: selectionBounds.x + selectionBounds.width / 2, top: selectionBounds.y }}>
                <div className="selection-actionbar" style={{ transform: `scale(${1 / zoom}) translate(-50%, calc(-100% - 14px))` }} onPointerDown={(event) => event.stopPropagation()}>
                  {selectedIds.length > 1 ? <span className="sel-count">{selectedIds.length}</span> : null}
                  <button data-tip="Duplicate (⌘D)" aria-label="Duplicate" onClick={() => void duplicateSelection()}><Copy size={14} /></button>
                  <button data-tip="Group" aria-label="Group" disabled={selectedElementCount < 2 || selectedElementCount !== selectedIds.length} onClick={() => void groupSelection()}><Group size={14} /></button>
                  {selectedIds.length === 2 ? (
                    <button data-tip="Connect these two" aria-label="Connect these two" onClick={() => void createConnectorBetween(selectedIds[0]!, selectedIds[1]!)}><Spline size={14} /></button>
                  ) : null}
                  <span className="sel-divider" />
                  <button className="danger" data-tip="Delete (⌫)" aria-label="Delete" onClick={() => void deleteSelection()}><Trash2 size={14} /></button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <AgentPresenceVeil live={anyAgentPresent} />
        {tool !== "select" ? (
          <div className="mode-pill" role="status">
            {tool === "connect" ? <Spline size={15} /> : <PenTool size={15} />}
            <strong>{tool === "connect" ? "Connector" : "Ink"}</strong>
            <span>{tool === "connect" ? (connectFromId ? "now click or drag to the target" : "drag from one shape to another") : "draw inside a frame"}</span>
            <button onClick={() => { setTool("select"); setConnectFromId(null); connectDraftRef.current = null; setConnectDraft(null); setStatus("Select tool"); }}>
              Done <kbd>esc</kbd>
            </button>
          </div>
        ) : null}
      </section>

      {rightPaneOpen ? (
        <aside className="right-panel">
        <div className="pane-top">
          <button className="pane-collapse" data-tip="Hide panel" aria-label="Hide right panel" onClick={toggleRightPane}>
            <PanelRightClose size={15} />
          </button>
          <span className="pane-top-label">{selectedIds.length ? `${selectedIds.length} selected` : "Nothing selected"}</span>
        </div>
        <CollapsiblePanel id="inspector" icon={<Save size={16} />} title="Inspector" collapsed={Boolean(collapsedPanels.inspector)} onToggle={togglePanel}>
          {selectedIds.length > 1 ? (
            <SelectionInspector project={project} selectedIds={selectedIds} onFocus={focusSelection} onGroup={groupSelection} onDuplicate={duplicateSelection} onDelete={deleteSelection} onLayout={runLayout} />
          ) : selectedConnector ? (
            <ConnectorInspector
              project={project}
              connector={selectedConnector}
              onChange={(patch) => runOperation({ type: "update_connector", connectorId: selectedConnector.id, patch })}
              onDelete={() => runOperation({ type: "delete_connector", connectorId: selectedConnector.id })}
            />
          ) : selectedElement ? (
            <ElementInspector project={project} element={selectedElement} onChange={updateSelectedElement} onReorder={(delta) => updateSelectedElement({ zIndex: selectedElement.zIndex + delta })} />
          ) : selectedArtboard ? (
            <ArtboardInspector artboard={selectedArtboard} onChange={updateArtboard} onDelete={() => runOperation({ type: "delete_artboard", artboardId: selectedArtboard.id })} />
          ) : (
            <DocumentInspector
              project={project}
              zoom={zoom}
              onResetZoom={() => { zoomAtViewportCenter(1); setStatus("Zoom 100%"); }}
              onFitAll={fitAll}
            />
          )}
        </CollapsiblePanel>

        <CollapsiblePanel id="agent-activity" icon={<Bot size={16} />} title="Agent activity" collapsed={Boolean(collapsedPanels["agent-activity"])} onToggle={togglePanel}>
          <AgentFeed entries={agentFeed} presences={livePresences} onFocusTargets={focusAgentTargets} onConnect={() => setConnectOpen(true)} />
        </CollapsiblePanel>

        <CollapsiblePanel id="flows" icon={<Send size={16} />} title="Flows & connectors" collapsed={Boolean(collapsedPanels.flows)} onToggle={togglePanel}>
          <button className="wide-action" onClick={connectArtboards}>
            <ArrowRight size={16} /> Connect two frames
          </button>
          <div className="flow-list">
            {project.connectors.length ? (
              project.connectors.map((connector) => {
                const from = connectorEndName(project, connector, "from");
                const to = connectorEndName(project, connector, "to");
                return (
                  <button key={connector.id} className={classNames("flow-row", selectedIds.includes(connector.id) && "selected")} onClick={() => select([connector.id])} title={connector.label ?? `${from} → ${to}`}>
                    <span>{from}</span>
                    <ArrowRight size={14} />
                    <span>{to}</span>
                  </button>
                );
              })
            ) : (
              <p className="muted">No flows yet. Use the connector tool or “Connect two frames”.</p>
            )}
          </div>
        </CollapsiblePanel>

        <CollapsiblePanel id="backup" icon={<ArchiveRestore size={16} />} title="Backup" collapsed={Boolean(collapsedPanels.backup)} onToggle={togglePanel}>
          <BackupPanel status={storageStatus?.backup} onBackupNow={backupAllNow} onOpenRestore={() => setRestoreOpen(true)} />
        </CollapsiblePanel>
        </aside>
      ) : null}
      {!chromeHidden && rightPaneOpen ? (
        <div className="pane-resize-handle right-handle" title="Drag to resize" onPointerDown={(event) => beginPaneResize("right", event)} />
      ) : null}

      {!chromeHidden && !leftPaneOpen ? (
        <button className="pane-edge-tab left" data-tip="Show left panel" aria-label="Show left panel" onClick={toggleLeftPane}>
          <PanelLeftOpen size={15} />
        </button>
      ) : null}
      {!chromeHidden && !rightPaneOpen ? (
        <button className="pane-edge-tab right" data-tip="Show right panel" aria-label="Show right panel" onClick={toggleRightPane}>
          <PanelRightOpen size={15} />
        </button>
      ) : null}

        <ZoomControl
          zoom={zoom}
          focusMode={focusMode}
          onZoomIn={() => zoomAtViewportCenter(cameraRef.current.zoom * BUTTON_ZOOM_FACTOR)}
          onZoomOut={() => zoomAtViewportCenter(cameraRef.current.zoom / BUTTON_ZOOM_FACTOR)}
          onReset={() => { zoomAtViewportCenter(1); setStatus("Zoom 100%"); }}
          onFit={fitAll}
          onFocusSelection={focusSelection}
          canFocusSelection={selectedIds.length > 0}
          onToggleFocusMode={() => setFocusMode((current) => !current)}
        />
        </>
      ) : null}

      {newBoardDialogOpen ? (
        <NewBoardDialog
          defaultName={newBoardName}
          onCancel={cancelNewBoard}
          onCreate={(name, template) => void submitNewBoard(name, template)}
        />
      ) : null}

      {boardPendingDelete ? (
        <DeleteBoardDialog
          board={boardPendingDelete}
          busy={deletingBoard}
          onCancel={cancelDeleteBoard}
          onConfirm={() => void confirmDeleteBoard()}
        />
      ) : null}

      {/* On Home there is no board in view — the loaded project is just the last/default one, so
          showing "This board" there was wrong. Only offer the board id when a board is actually open. */}
      <AgentConnectDialog open={connectOpen} project={homeOpen ? null : project} health={storageStatus} onClose={() => setConnectOpen(false)} />
      <CommandPalette open={commandOpen} commands={paletteCommands} onClose={() => setCommandOpen(false)} />
      <ShortcutOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {project ? <RestoreDialog boardId={project.id} open={restoreOpen} onClose={() => setRestoreOpen(false)} onRestored={setStatus} /> : null}
      {project ? (
        <ExportDialog
          boardId={project.id}
          open={exportOpen}
          targets={exportTargets}
          desktop={storageStatus?.shell === "desktop"}
          onClose={() => setExportOpen(false)}
          onStatus={setStatus}
        />
      ) : null}

      <footer className={classNames("statusbar", statusTone === "error" && "has-error")}>
        <span className={classNames("status-message", statusTone === "error" && "is-error")}>
          {statusTone === "error" ? <AlertTriangle size={13} aria-hidden="true" /> : null}
          {status}
        </span>
        <span className="statusbar-spacer" />
        {!homeOpen && connectFromId ? <span className="status-hint">Connector armed — click a target</span> : null}
        {!homeOpen && tool !== "select" ? <span className="status-hint">{tool === "connect" ? "Connector tool" : "Ink tool"} · Esc to exit</span> : null}
        {!homeOpen ? <BackupBadge status={storageStatus?.backup} /> : null}
        {lastAgentEditedAtIso ? (
          <time className="agent-edit-stamp" dateTime={lastAgentEditedAtIso} title={`Last AI edit: ${formatAgentEditedAt(lastAgentEditedAtIso, true)}`}>
            AI edited {formatAgentEditedAt(lastAgentEditedAtIso)}
          </time>
        ) : null}
      </footer>
    </main>
  );
}

function BackupBadge({ status }: { status?: ApiHealth["backup"] }) {
  if (!status) return null;
  if (!status.healthy) {
    return (
      <span className="backup-badge failed" title={status.lastError ?? "Backup failed"}>
        ⚠ Backup failed
      </span>
    );
  }
  return (
    <span className="backup-badge ok" title={status.lastBackupAt ? `Last backup: ${formatAgentEditedAt(status.lastBackupAt, true)}` : "Backups on"}>
      {status.lastBackupAt ? `Backed up ${formatAgentEditedAt(status.lastBackupAt)}` : "Backups on"}
    </span>
  );
}

function BackupPanel({ status, onBackupNow, onOpenRestore }: { status?: ApiHealth["backup"]; onBackupNow: () => void; onOpenRestore: () => void }) {
  return (
    <div className="backup-panel">
      {status ? (
        <div className={classNames("backup-status", status.healthy ? "ok" : "failed")}>
          <strong>{status.healthy ? "Backups healthy" : "Backup failed"}</strong>
          <small>{status.lastError ? status.lastError : status.lastBackupAt ? `Last: ${formatAgentEditedAt(status.lastBackupAt, true)}` : "No backup yet this session"}</small>
        </div>
      ) : (
        <p className="muted">Backup status unavailable in this mode.</p>
      )}
      <div className="segmented-row">
        <button onClick={onBackupNow}>
          <ArchiveRestore size={15} /> Back up now
        </button>
        <button onClick={onOpenRestore}>
          <Undo2 size={15} /> Restore…
        </button>
      </div>
      <p className="muted backup-dir">Snapshots write automatically ~15s after each change and on quit.</p>
    </div>
  );
}

/**
 * The MCP endpoint this running server exposes. In dev the web app is served from 5173 behind a
 * proxy, but the server — and therefore MCP — always listens on 4318.
 */
function mcpEndpointUrl(): string {
  const origin = typeof window !== "undefined" && window.location.origin.startsWith("http") ? window.location.origin : "http://127.0.0.1:4318";
  const serverBase = origin.includes("5173") ? "http://127.0.0.1:4318" : origin;
  return `${serverBase}/mcp`;
}

/**
 * Home's one persistent pointer at what makes PowerBoard different: the live MCP endpoint.
 * Deliberately quiet — a single muted row that doubles as the server-health readout, so it can
 * stay on screen permanently without a dismissal flag.
 */
function HomeConnectStrip({ storageStatus, onConnect }: { storageStatus: ApiHealth | null; onConnect: () => void }) {
  const [copied, setCopied] = useState(false);
  const endpoint = mcpEndpointUrl();
  const reachable = storageStatus?.ok !== false;
  const copyEndpoint = async () => {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="home-connect-strip">
      <span className={classNames("connect-dot", reachable ? "ok" : "down")} aria-hidden="true" />
      <span className="home-connect-text">
        <strong>Agents can edit these boards.</strong> Point any MCP client at
      </span>
      <code>{endpoint}</code>
      <button type="button" className="copy-chip" onClick={() => void copyEndpoint()} aria-label="Copy MCP endpoint">
        {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
      </button>
      <button type="button" className="home-connect-more" onClick={onConnect}>
        How to connect
      </button>
    </div>
  );
}

function HomeView({
  boards,
  previews,
  storageStatus,
  loading,
  error,
  onRetry,
  onOpen,
  onCreate,
  onDelete,
  onConnect
}: {
  boards: BoardSummary[];
  previews: Record<string, BoardProject>;
  storageStatus: ApiHealth | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (boardId: string) => void;
  onCreate: () => void;
  onDelete: (board: BoardSummary) => void;
  onConnect: () => void;
}) {
  const totalFrames = boards.reduce((sum, board) => sum + board.artboardCount, 0);
  const totalElements = boards.reduce((sum, board) => sum + board.elementCount, 0);
  return (
    <section className="home-view">
      <div className="home-shell">
        <div className="home-header">
          <div>
            <h2>Boards</h2>
            <div className="home-meta">
              <span>
                {boards.length} {pluralize(boards.length, "board")}
              </span>
              <span>
                {totalFrames} {pluralize(totalFrames, "frame")}
              </span>
              <span>
                {totalElements} {pluralize(totalElements, "element")}
              </span>
              <span className={classNames("storage-pill", isCloudBacked(storageStatus) && "cloud")}>{storageLabel(storageStatus)}</span>
            </div>
          </div>
          <div className="home-header-actions">
            <button className="text-button home-connect" onClick={() => onConnect()}>
              <Cable size={15} /> Connect agent
            </button>
            <button className="text-button home-create" onClick={() => onCreate()}>
              <Plus size={16} /> New board
            </button>
          </div>
        </div>

        <HomeConnectStrip storageStatus={storageStatus} onConnect={onConnect} />

        {boards.length ? (
          <div className="board-card-grid">
            {boards.map((board) => {
              const preview = previews[board.id];
              const frames = preview?.artboards ?? [];
              const previewPending = !preview && board.artboardCount > 0;
              return (
                <article
                  key={board.id}
                  className="board-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(board.id)}
                  onKeyDown={(event) => {
                    // Only when the card itself is focused — let nested controls (Open, Delete) handle their own keys.
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpen(board.id);
                    }
                  }}
                >
                  <div className="board-card-head">
                    <Frame size={18} />
                    <div>
                      <h3>{board.name}</h3>
                      <p>{formatUpdatedAt(board.updatedAt)}</p>
                    </div>
                    <div className="card-head-actions">
                      <button
                        type="button"
                        className="card-delete-button"
                        title={`Delete ${board.name}`}
                        aria-label={`Delete board ${board.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          onDelete(board);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                      <a
                        className="card-open-button"
                        href={routeHash({ view: "board", boardId: board.id })}
                        onClick={(event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          onOpen(board.id);
                        }}
                      >
                        Open
                      </a>
                    </div>
                  </div>
                  <div className="board-meta">
                    <span>
                      {board.artboardCount} {pluralize(board.artboardCount, "frame")}
                    </span>
                    <span>
                      {board.elementCount} {pluralize(board.elementCount, "element")}
                    </span>
                  </div>
                  <div className="frame-chip-list">
                    {frames.slice(0, 4).map((frame) => (
                      <span key={frame.id} className="frame-chip" title={`${frame.name} · ${frame.id}`}>
                        {frame.name}
                        <small>
                          {Math.round(frame.width)}x{Math.round(frame.height)}
                        </small>
                      </span>
                    ))}
                    {frames.length > 4 ? <span className="frame-chip more">+{frames.length - 4}</span> : null}
                    {previewPending ? <span className="frame-chip empty">Loading preview</span> : null}
                    {!previewPending && !frames.length ? <span className="frame-chip empty">No frames</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : loading ? (
          <div className="board-card-grid" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="board-card board-card-skeleton">
                <div className="skeleton-head">
                  <span className="skeleton-glyph" />
                  <div className="skeleton-lines">
                    <span className="skeleton-line" />
                    <span className="skeleton-line short" />
                  </div>
                </div>
                <div className="skeleton-chips">
                  <span className="skeleton-chip" />
                  <span className="skeleton-chip" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="home-empty home-error" role="alert">
            {navigator.onLine ? <CloudOff size={28} /> : <WifiOff size={28} />}
            <h3>{navigator.onLine ? "Couldn't reach the workspace" : "You're offline"}</h3>
            <p>{navigator.onLine ? error : "Reconnect to load and save your boards. Nothing you've done is lost."}</p>
            <button className="wide-action" onClick={() => onRetry()}>
              <RotateCcw size={16} /> Try again
            </button>
          </div>
        ) : (
          <div className="home-empty home-first-run">
            <div className="first-run-motif" aria-hidden="true">
              <Frame size={30} />
              <Sparkles size={16} className="first-run-spark" />
            </div>
            <h3>Start your first board</h3>
            <p>One canvas for hi-fi app mockups and diagrams — designed for you and your agents to edit together.</p>
            <button className="wide-action" onClick={() => onCreate()}>
              <Plus size={16} /> New board
            </button>
            <button type="button" className="text-button first-run-connect" onClick={() => onConnect()}>
              <Cable size={15} /> Connect an agent
            </button>
            <small>Agent edits stream in live once you point Claude at the MCP endpoint.</small>
          </div>
        )}
      </div>
    </section>
  );
}

/** Small per-type glyph so the layers list is scannable at a glance. */
function layerIconFor(type: BoardElement["type"]): React.ReactNode {
  switch (type) {
    case "text":
      return <Type size={12} />;
    case "sticky":
      return <StickyNote size={12} />;
    case "image":
    case "screenshotOverlay":
      return <ImageIcon size={12} />;
    case "shape":
      return <Shapes size={12} />;
    case "group":
      return <Group size={12} />;
    case "ink":
      return <PenTool size={12} />;
    case "line":
      return <Minus size={12} />;
    case "table":
    case "list":
      return <Table size={12} />;
    case "chart":
    case "sparkline":
      return <Activity size={12} />;
    default:
      return <Box size={12} />;
  }
}

/** Layer row name: click selects, double-click renames inline. */
function RenamableName({
  icon,
  name,
  displayName,
  title,
  onSelect,
  onRename
}: {
  icon: React.ReactNode;
  name: string;
  displayName?: string;
  title: string;
  onSelect: (additive: boolean) => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  function commit() {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
  }
  if (editing) {
    return (
      <input
        className="layer-rename"
        aria-label="Rename layer"
        value={value}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            setValue(name);
            setEditing(false);
          }
          event.stopPropagation();
        }}
        onPointerDown={(event) => event.stopPropagation()}
      />
    );
  }
  return (
    <button
      className="layer-name"
      title={`${title} — double-click to rename`}
      onClick={(event) => onSelect(event.shiftKey)}
      onDoubleClick={() => {
        setValue(name);
        setEditing(true);
      }}
    >
      <span className="layer-icon">{icon}</span>
      <span className="layer-label">{displayName ?? name}</span>
    </button>
  );
}

function FrameLayerGroup({
  artboard,
  project,
  indexes,
  selectedIds,
  onSelect,
  onUpdate,
  onDelete,
  onUpdateArtboard,
  onDeleteArtboard
}: {
  artboard: Artboard;
  project: BoardProject;
  indexes: ElementIndexes;
  selectedIds: string[];
  onSelect: (ids: string[], additive?: boolean) => void;
  onUpdate: (elementId: string, patch: Record<string, unknown>) => void;
  onDelete: (elementId: string) => void;
  onUpdateArtboard: (patch: Partial<Artboard>) => void;
  onDeleteArtboard: () => void;
}) {
  const roots = indexes.layerRootsByArtboard.get(artboard.id) ?? [];
  const [open, setOpen] = useState(true);
  const forceOpen = roots.some((element) => selectedIds.includes(element.id) || hasSelectedDescendant(element.id, project, selectedIds));
  const expanded = open || forceOpen;
  const count = project.elements.filter((element) => element.artboardId === artboard.id).length;
  return (
    <div className="layer-group">
      <div className={classNames("layer-row artboard-layer", selectedIds.includes(artboard.id) && "selected", !artboard.visible && "hidden-layer")}>
        <button className="layer-chevron" aria-label={expanded ? "Collapse frame" : "Expand frame"} disabled={!roots.length} onClick={() => setOpen((current) => !current)}>
          {roots.length ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="layer-spacer" />}
        </button>
        <RenamableName
          icon={<Frame size={12} />}
          name={artboard.name}
          title={artboard.name}
          onSelect={(additive) => onSelect([artboard.id], additive)}
          onRename={(name) => onUpdateArtboard({ name })}
        />
        {count ? <span className="layer-count">{count}</span> : null}
        <div className="layer-actions">
          <button className="layer-act" data-tip={artboard.visible ? "Hide" : "Show"} aria-label={artboard.visible ? "Hide" : "Show"} onClick={() => onUpdateArtboard({ visible: !artboard.visible })}>
            {artboard.visible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
          <button className="layer-act" data-tip={artboard.locked ? "Unlock" : "Lock"} aria-label={artboard.locked ? "Unlock" : "Lock"} onClick={() => onUpdateArtboard({ locked: !artboard.locked })}>
            {artboard.locked ? <Lock size={12} /> : <LockOpen size={12} />}
          </button>
          <button className="layer-act danger" data-tip="Delete frame" aria-label="Delete frame" onClick={onDeleteArtboard}><Trash2 size={12} /></button>
        </div>
      </div>
      {expanded
        ? roots.map((element) => (
            <LayerNode key={element.id} element={element} project={project} indexes={indexes} depth={1} selectedIds={selectedIds} onSelect={onSelect} onUpdate={onUpdate} onDelete={onDelete} />
          ))
        : null}
    </div>
  );
}

function LayerNode({
  element,
  project,
  indexes,
  depth,
  selectedIds,
  onSelect,
  onUpdate,
  onDelete
}: {
  element: BoardElement;
  project: BoardProject;
  indexes: ElementIndexes;
  depth: number;
  selectedIds: string[];
  onSelect: (ids: string[], additive?: boolean) => void;
  onUpdate: (elementId: string, patch: Record<string, unknown>) => void;
  onDelete: (elementId: string) => void;
}) {
  const children = indexes.layerChildrenByParent.get(element.id) ?? [];
  // Nested children start collapsed to keep the list calm; selecting a descendant reveals it.
  const [open, setOpen] = useState(false);
  const forceOpen = hasSelectedDescendant(element.id, project, selectedIds);
  const expanded = open || forceOpen;
  return (
    <>
      <div className={classNames("layer-row element-layer", selectedIds.includes(element.id) && "selected", !element.visible && "hidden-layer")} style={{ "--indent": `${depth * 14}px` } as React.CSSProperties}>
        <button className="layer-chevron" aria-label={expanded ? "Collapse" : "Expand"} disabled={!children.length} onClick={() => setOpen((current) => !current)}>
          {children.length ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="layer-spacer" />}
        </button>
        <RenamableName
          icon={layerIconFor(element.type)}
          name={element.name}
          displayName={compactName(element.name)}
          title={`${element.name} · ${element.type}`}
          onSelect={(additive) => onSelect([element.id], additive)}
          onRename={(name) => onUpdate(element.id, { name })}
        />
        <div className="layer-actions">
          <button className="layer-act" data-tip={element.visible ? "Hide" : "Show"} aria-label={element.visible ? "Hide" : "Show"} onClick={() => onUpdate(element.id, { visible: !element.visible })}>
            {element.visible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
          <button className="layer-act" data-tip={element.locked ? "Unlock" : "Lock"} aria-label={element.locked ? "Unlock" : "Lock"} onClick={() => onUpdate(element.id, { locked: !element.locked })}>
            {element.locked ? <Lock size={12} /> : <LockOpen size={12} />}
          </button>
          <button className="layer-act danger" data-tip="Delete" aria-label="Delete" onClick={() => onDelete(element.id)}><Trash2 size={12} /></button>
        </div>
      </div>
      {expanded
        ? children.map((child) => (
            <LayerNode key={child.id} element={child} project={project} indexes={indexes} depth={depth + 1} selectedIds={selectedIds} onSelect={onSelect} onUpdate={onUpdate} onDelete={onDelete} />
          ))
        : null}
    </>
  );
}

function ArtboardView({
  artboard,
  project,
  indexes,
  selectedIds,
  agentActiveIds,
  tool,
  connectFromId,
  editingTextId,
  onSelect,
  onDragStart,
  onConnectTap,
  onBeginTextEdit,
  onCommitText
}: {
  artboard: Artboard;
  project: BoardProject;
  indexes: ElementIndexes;
  selectedIds: string[];
  agentActiveIds: Set<string>;
  tool: CanvasTool;
  connectFromId: string | null;
  editingTextId: string | null;
  onSelect: (ids: string[], additive?: boolean) => void;
  onDragStart: (state: DragState) => void;
  onConnectTap: (id: string, event: { clientX: number; clientY: number }) => void;
  onBeginTextEdit: (id: string) => void;
  onCommitText: (id: string, value: string) => void;
}) {
  const elements = indexes.canvasRootsByArtboard.get(artboard.id) ?? [];
  const selectedElements = project.elements
    .filter((element) => selectedIds.includes(element.id) && element.artboardId === artboard.id && element.visible)
    .map((element) => ({ element, position: elementPositionInArtboard(element, project) }))
    .filter((item): item is { element: BoardElement; position: { x: number; y: number } } => Boolean(item.position));
  const activeElements = project.elements
    .filter((element) => agentActiveIds.has(element.id) && element.artboardId === artboard.id && element.visible)
    .map((element) => ({ element, position: elementPositionInArtboard(element, project) }))
    .filter((item): item is { element: BoardElement; position: { x: number; y: number } } => Boolean(item.position));
  const selected = selectedIds.includes(artboard.id);
  const agentActive = agentActiveIds.has(artboard.id);
  const connectSource = connectFromId === artboard.id;
  const bitmapOnly = isBitmapOnlyArtboard(artboard, elements);
  const surfaceRadius = artboard.frameless ? 12 : artboard.type === "mobile" ? 42 : artboard.type === "tablet" ? 30 : 18;
  return (
    <div
      className={classNames("artboard-frame", selected && "selected", agentActive && "agent-active", artboard.frameless && "frameless", connectSource && "connect-source")}
      style={{ left: CANVAS_ORIGIN_X + artboard.x, top: CANVAS_ORIGIN_Y + artboard.y, width: artboard.width, height: artboard.height }}
      data-board-artboard={artboard.id}
      data-board-name={artboard.name}
      title={`${artboard.name} · ${artboard.id}`}
    >
      <button
        className="artboard-label"
        onPointerDown={(event) => {
          event.stopPropagation();
          if (tool === "connect") {
            onConnectTap(artboard.id, event);
            return;
          }
          onSelect([artboard.id], event.shiftKey);
          if (!artboard.locked && !event.shiftKey) {
            capturePointer(event.currentTarget, event.pointerId);
            onDragStart({ id: artboard.id, target: "artboard", mode: "move", startX: event.clientX, startY: event.clientY, original: artboard, latest: artboard });
          }
        }}
      >
        <span>{artboard.name}</span>
        {bitmapOnly ? <em>Image-only</em> : null}
      </button>
      <div
        className="artboard-surface"
        style={{ background: artboard.background, borderRadius: surfaceRadius }}
        onPointerDown={(event) => {
          if (tool === "connect") {
            event.stopPropagation();
            onConnectTap(artboard.id, event);
            return;
          }
          if (tool === "ink") return; // let the ink pointer pipeline on the viewport handle it
          if (event.button !== 0) return;
          event.stopPropagation();
          onSelect([artboard.id], event.shiftKey);
          // Drag the frame by its empty body (elements stopPropagation, so they still win).
          if (!artboard.locked && !event.shiftKey) {
            capturePointer(event.currentTarget, event.pointerId);
            onDragStart({ id: artboard.id, target: "artboard", mode: "move", startX: event.clientX, startY: event.clientY, original: artboard, latest: artboard });
          }
        }}
      >
        {elements.map((element) => (
          <ElementView
            key={element.id}
            element={element}
            project={project}
            indexes={indexes}
            selectedIds={selectedIds}
            agentActiveIds={agentActiveIds}
            tool={tool}
            connectFromId={connectFromId}
            editingTextId={editingTextId}
            onSelect={onSelect}
            onDragStart={onDragStart}
            onConnectTap={onConnectTap}
            onBeginTextEdit={onBeginTextEdit}
            onCommitText={onCommitText}
          />
        ))}
      </div>
      {activeElements.length ? (
        <div className="agent-pulse-layer" aria-hidden="true">
          {activeElements.map(({ element, position }) => (
            <span
              key={element.id}
              className="agent-pulse-outline"
              style={{
                left: position.x,
                top: position.y,
                width: element.width,
                height: element.height,
                borderRadius: element.style.radius ?? 10
              }}
            />
          ))}
        </div>
      ) : null}
      {selectedElements.length ? (
        <div className="selection-badge-layer" aria-hidden="true">
          {selectedElements.map(({ element, position }) => (
            <Fragment key={element.id}>
              <span
                className="selection-ring"
                style={{ left: position.x, top: position.y, width: element.width, height: element.height, borderRadius: (typeof element.style.radius === "number" ? element.style.radius : 6) }}
              />
              <span className="element-name-badge" title={`${element.name} · ${element.id}`} style={{ left: position.x, top: position.y - 24 }}>
                {element.name}
              </span>
            </Fragment>
          ))}
        </div>
      ) : null}
      {selected && !artboard.locked ? (
        <button
          className="artboard-resize-handle"
          aria-label="Resize frame"
          onPointerDown={(event) => {
            event.stopPropagation();
            capturePointer(event.currentTarget, event.pointerId);
            onDragStart({ id: artboard.id, target: "artboard", mode: "resize", startX: event.clientX, startY: event.clientY, original: artboard, latest: artboard });
          }}
        />
      ) : null}
    </div>
  );
}

function ElementView({
  element,
  project,
  indexes,
  selectedIds,
  agentActiveIds,
  tool,
  connectFromId,
  editingTextId,
  onSelect,
  onDragStart,
  onConnectTap,
  onBeginTextEdit,
  onCommitText
}: {
  element: BoardElement;
  project: BoardProject;
  indexes: ElementIndexes;
  selectedIds: string[];
  agentActiveIds: Set<string>;
  tool: CanvasTool;
  connectFromId: string | null;
  editingTextId: string | null;
  onSelect: (ids: string[], additive?: boolean) => void;
  onDragStart: (state: DragState) => void;
  onConnectTap: (id: string, event: { clientX: number; clientY: number }) => void;
  onBeginTextEdit: (id: string) => void;
  onCommitText: (id: string, value: string) => void;
}) {
  const selected = selectedIds.includes(element.id);
  const agentActive = agentActiveIds.has(element.id);
  const connectSource = connectFromId === element.id;
  const children = indexes.canvasChildrenByParent.get(element.id) ?? [];
  const selectedAncestor = children.some((child) => selectedIds.includes(child.id) || hasSelectedDescendant(child.id, project, selectedIds));
  const style = elementToStyle(element);
  const asset = typeof element.props.assetId === "string" ? project.assets.find((candidate) => candidate.id === element.props.assetId) : undefined;
  const editing = editingTextId === element.id;
  const textEditable = ["text", "button", "badge", "sticky", "shape"].includes(element.type);

  return (
    <div
      className={classNames("board-element", `kind-${element.type}`, selected && "selected", selectedAncestor && "selected-ancestor", agentActive && "agent-active", element.locked && "locked", connectSource && "connect-source")}
      style={style}
      data-board-element={element.id}
      data-board-name={element.name}
      title={`${element.name} · ${element.type} · ${element.id}`}
      onPointerDown={(event) => {
        if (tool === "ink") return; // ink draws through elements
        if (tool === "connect") {
          event.stopPropagation();
          onConnectTap(element.id, event);
          return;
        }
        if (editing) {
          event.stopPropagation();
          return;
        }
        event.stopPropagation();
        onSelect([element.id], event.shiftKey);
        if (!element.locked && !event.shiftKey) {
          capturePointer(event.currentTarget, event.pointerId);
          onDragStart({ id: element.id, target: "element", mode: "move", startX: event.clientX, startY: event.clientY, original: element, latest: element });
        }
      }}
      onDoubleClick={(event) => {
        if (!textEditable || element.locked) return;
        event.stopPropagation();
        onBeginTextEdit(element.id);
      }}
    >
      {editing ? (
        <InlineTextEditor element={element} onCommit={(value) => onCommitText(element.id, value)} />
      ) : (
        <ElementContent element={element} assetSrc={asset?.src} />
      )}
      {children.map((child) => (
        <ElementView
          key={child.id}
          element={child}
          project={project}
          indexes={indexes}
          selectedIds={selectedIds}
          agentActiveIds={agentActiveIds}
          tool={tool}
          connectFromId={connectFromId}
          editingTextId={editingTextId}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onConnectTap={onConnectTap}
          onBeginTextEdit={onBeginTextEdit}
          onCommitText={onCommitText}
        />
      ))}
      {selected && !element.locked && !editing
        ? (["nw", "ne", "sw", "se"] as const).map((handle) => (
            <button
              key={handle}
              className={`resize-handle ${handle}`}
              aria-label={`Resize (${handle})`}
              onPointerDown={(event) => {
                event.stopPropagation();
                capturePointer(event.currentTarget, event.pointerId);
                onDragStart({ id: element.id, target: "element", mode: "resize", handle, startX: event.clientX, startY: event.clientY, original: element, latest: element });
              }}
            />
          ))
        : null}
    </div>
  );
}

function InlineTextEditor({ element, onCommit }: { element: BoardElement; onCommit: (value: string) => void }) {
  const [value, setValue] = useState(() => readString(element.props.text, ""));
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.focus();
    node.select();
  }, []);
  return (
    <textarea
      ref={ref}
      className="inline-text-editor"
      aria-label="Edit text"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={() => onCommit(value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onCommit(value);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onCommit(readString(element.props.text, ""));
        }
      }}
      style={{ color: element.style.color, fontSize: element.style.fontSize, fontWeight: element.style.fontWeight as number | undefined, textAlign: element.style.textAlign }}
    />
  );
}

function InkDraftLayer({ draft, project }: { draft: InkDraft; project: BoardProject }) {
  const artboard = project.artboards.find((candidate) => candidate.id === draft.artboardId);
  if (!artboard || draft.points.length < 2) return null;
  const path = draft.points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${round2(CANVAS_ORIGIN_X + artboard.x + x)} ${round2(CANVAS_ORIGIN_Y + artboard.y + y)}`)
    .join(" ");
  return (
    <svg className="ink-draft-layer" width={CANVAS_WIDTH} height={CANVAS_HEIGHT} viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} aria-hidden="true">
      <path d={path} fill="none" stroke="#334155" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ElementContent({ element, assetSrc }: { element: BoardElement; assetSrc?: string }) {
  switch (element.type) {
    case "frame":
    case "group":
    case "rect":
      return null;
    case "icon":
      return (
        <svg className="material-icon-primitive" viewBox="0 0 24 24" role="img" aria-label={readString(element.props.label, readString(element.props.materialIcon ?? element.props.icon, "Icon"))}>
          {materialIconGlyph(readString(element.props.materialIcon ?? element.props.icon, "add_circle"))}
        </svg>
      );
    case "line": {
      const points = linePrimitivePoints(readString(element.props.direction, "horizontal"));
      return (
        <svg className="line-primitive" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line x1={points.x1} y1={points.y1} x2={points.x2} y2={points.y2} stroke={readString(element.style.stroke, "#64748B")} strokeWidth={element.style.strokeWidth ?? 2} vectorEffect="non-scaling-stroke" strokeLinecap={readString(element.props.lineCap, "round") as "butt" | "round" | "square"} />
        </svg>
      );
    }
    case "sparkline": {
      const values = readNumberArray(element.props.values, [24, 38, 32, 58, 48, 72, 66]);
      const points = sparklinePoints(values, 100, 100, 8);
      return (
        <svg className="sparkline-primitive" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={readString(element.props.label, "Sparkline")}>
          {element.props.showArea === true ? <polygon points={`8,100 ${points} 92,100`} fill={readString(element.style.stroke ?? element.style.color, "#44403C")} opacity="0.12" /> : null}
          <polyline points={points} stroke={readString(element.style.stroke ?? element.style.color, "#44403C")} strokeWidth={element.style.strokeWidth ?? 3} vectorEffect="non-scaling-stroke" />
        </svg>
      );
    }
    case "text":
      return <span>{readString(element.props.text, element.name)}</span>;
    case "button":
      return <span>{readString(element.props.text, "Continue")}</span>;
    case "input":
      return (
        <div className="mock-input">
          <span>{readString(element.props.label, "Label")}</span>
          <strong>{readString(element.props.placeholder, "Placeholder")}</strong>
        </div>
      );
    case "card":
      return (
        <div className="mock-card">
          <span>{readString(element.props.eyebrow, "Metric")}</span>
          <strong>{readString(element.props.title, "Card title")}</strong>
          <p>{readString(element.props.subtitle, "Supporting detail")}</p>
        </div>
      );
    case "dialog":
    case "sheet":
      return (
        <div className="mock-dialog">
          <strong>{readString(element.props.title, element.type === "sheet" ? "Sheet" : "Dialog")}</strong>
          <p>{readString(element.props.body, "Body copy")}</p>
          <button>{readString(element.props.action, "Continue")}</button>
        </div>
      );
    case "nav":
    case "tabbar":
      return (
        <div className="mock-nav">
          <strong>{readString(element.props.title, "Navigation")}</strong>
          <div>{readStringArray(element.props.items, ["Home", "Settings"]).map((item) => <span key={item}>{item}</span>)}</div>
        </div>
      );
    case "list":
      return (
        <div className="mock-list">
          <strong>{readString(element.props.title, "List")}</strong>
          {readStringArray(element.props.items, ["First item", "Second item"]).map((item) => <p key={item}>{item}</p>)}
        </div>
      );
    case "table":
      return <MockTable element={element} />;
    case "chart":
      return (
        <div className="mock-chart">
          <strong>{readString(element.props.title, "Chart")}</strong>
          <div>{readNumberArray(element.props.values, [30, 55, 80]).map((value, index) => <i key={index} style={{ height: `${Math.max(8, Math.min(100, value))}%` }} />)}</div>
        </div>
      );
    case "paywall":
      return (
        <div className="mock-paywall">
          <span>Pro</span>
          <strong>{readString(element.props.title, "Go Pro")}</strong>
          <p>{readString(element.props.price, "$4.99/mo")}</p>
          <ul>{readStringArray(element.props.features, ["Feature"]).map((feature) => <li key={feature}>{feature}</li>)}</ul>
          <button>{readString(element.props.action, "Start")}</button>
        </div>
      );
    case "badge":
      return <span>{readString(element.props.text, "Badge")}</span>;
    case "sticky":
      return <span>{readString(element.props.text, "Note")}</span>;
    case "emptyState":
      return (
        <div className="mock-empty">
          <strong>{readString(element.props.title, "Nothing here yet")}</strong>
          <p>{readString(element.props.body, "Create something to begin.")}</p>
        </div>
      );
    case "shape":
      return <ShapePrimitive element={element} />;
    case "ink": {
      const points = readPointArray(element.props.points);
      if (points.length < 2) return null;
      const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${round2(x * 100)} ${round2(y * 100)}`).join(" ");
      return (
        <svg className="ink-primitive" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d={path} fill="none" stroke={readString(element.style.stroke, "#334155")} strokeWidth={element.style.strokeWidth ?? 2.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    case "image":
    case "screenshotOverlay":
      return assetSrc ? <img src={assetSrc} alt={readString(element.props.alt, element.name)} /> : <span>{element.type === "screenshotOverlay" ? "Screenshot overlay" : "Image"}</span>;
    default:
      return <span>{element.name}</span>;
  }
}

function ShapePrimitive({ element }: { element: BoardElement }) {
  const kind = readString(element.props.shape, "rectangle");
  const fill = readString(element.style.fill, "#F7F6F3");
  const stroke = readString(element.style.stroke, "#44403C");
  const strokeWidth = element.style.strokeWidth ?? 1.5;
  const text = readString(element.props.text, "");
  const subtitle = readString(element.props.subtitle, "");
  const dash = strokeDashPattern(element.style.strokeStyle, strokeWidth);
  return (
    <div className="shape-primitive">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <ShapeOutline kind={kind} fill={fill} stroke={stroke} strokeWidth={strokeWidth} dash={dash} />
      </svg>
      {text || subtitle ? (
        <span className="shape-text" style={{ color: element.style.color ?? "#1E3A5F" }}>
          {text ? <span className="shape-label">{text}</span> : null}
          {subtitle ? <span className="shape-subtitle">{subtitle}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

function ShapeOutline({
  kind,
  fill,
  stroke,
  strokeWidth,
  dash
}: {
  kind: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  dash?: { dashArray: string; lineCap: "butt" | "round" };
}) {
  const common = {
    fill,
    stroke,
    strokeWidth,
    vectorEffect: "non-scaling-stroke" as const,
    strokeLinejoin: "round" as const,
    strokeDasharray: dash?.dashArray,
    strokeLinecap: dash?.lineCap
  };
  const poly = (points: Array<[number, number]>) => <polygon points={points.map(([x, y]) => `${x},${y}`).join(" ")} {...common} />;
  switch (kind) {
    case "ellipse":
      return <ellipse cx={50} cy={50} rx={49} ry={49} {...common} />;
    case "diamond":
      return poly([[50, 1], [99, 50], [50, 99], [1, 50]]);
    case "parallelogram":
      return poly([[22, 2], [99, 2], [78, 98], [1, 98]]);
    case "triangle":
      return poly([[50, 2], [98, 98], [2, 98]]);
    case "hexagon":
      return poly([[25, 2], [75, 2], [99, 50], [75, 98], [25, 98], [1, 50]]);
    case "star":
      return poly(starPolyPoints());
    case "arrow-right":
      return poly([[2, 28], [62, 28], [62, 2], [98, 50], [62, 98], [62, 72], [2, 72]]);
    case "cylinder":
      return (
        <>
          <path d="M2 16 A48 15 0 0 1 98 16 L98 84 A48 15 0 0 1 2 84 Z" {...common} />
          <path d="M2 16 A48 15 0 0 0 98 16" fill="none" stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
        </>
      );
    case "document":
      return <path d="M2 2 L98 2 L98 84 Q74 70 50 84 Q26 98 2 84 Z" {...common} />;
    case "cloud":
      return <path d="M25 82 A22 22 0 1 1 30 40 A25 25 0 0 1 72 38 A22 22 0 1 1 78 82 Z" {...common} />;
    case "rounded":
      return <rect x={1} y={1} width={98} height={98} rx={40} {...common} />;
    default:
      return <rect x={1} y={1} width={98} height={98} rx={6} {...common} />;
  }
}

function starPolyPoints(): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let index = 0; index < 10; index++) {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    const radius = index % 2 === 0 ? 49 : 21;
    points.push([round2(50 + radius * Math.cos(angle)), round2(50 + radius * Math.sin(angle))]);
  }
  return points;
}

function MockTable({ element }: { element: BoardElement }) {
  const columns = readStringArray(element.props.columns, ["Name", "Status"]);
  const rows = Array.isArray(element.props.rows) ? element.props.rows : [];
  return (
    <div className="mock-table">
      <strong>{readString(element.props.title, "Table")}</strong>
      <div className="mock-table-grid" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
        {columns.map((column) => (
          <b key={column}>{column}</b>
        ))}
        {rows.flatMap((row, rowIndex) => {
          const cells = Array.isArray(row) ? row : [];
          return columns.map((_, index) => <span key={`${rowIndex}-${index}`}>{readString(cells[index], "-")}</span>);
        })}
      </div>
    </div>
  );
}

/** Board space → canvas space. Geometry itself lives in @powerboard/schema so exports match exactly. */
function toCanvasSpace(rect: Rect): Rect {
  return { x: CANVAS_ORIGIN_X + rect.x, y: CANVAS_ORIGIN_Y + rect.y, width: rect.width, height: rect.height };
}

function connectorWorldRect(project: BoardProject, artboardId: string, elementId: string | undefined): Rect | null {
  const rect = connectorEndpointRect(project, artboardId, elementId);
  return rect ? toCanvasSpace(rect) : null;
}

function ConnectorLayer({
  project,
  selectedIds,
  agentActiveIds,
  zoom,
  onSelect,
  onSetWaypoint,
  clientToWorld
}: {
  project: BoardProject;
  selectedIds: string[];
  agentActiveIds: Set<string>;
  zoom: number;
  onSelect: (ids: string[], additive?: boolean) => void;
  onSetWaypoint: (connectorId: string, point: { x: number; y: number } | null) => void;
  clientToWorld: (clientX: number, clientY: number) => { x: number; y: number } | null;
}) {
  // Live preview of a midpoint drag; commit to the op model only on pointer-up.
  const [waypointDraft, setWaypointDraft] = useState<{ id: string; x: number; y: number } | null>(null);
  const dragRef = useRef<{ id: string; moved: boolean; point: { x: number; y: number } } | null>(null);
  // Counter-scale so the handle is a constant ~8px dot with a ≥16px hit area at any zoom.
  const dotRadius = 4 / zoom;
  const hitRadius = 8 / zoom;
  // Routing inputs are board-wide, so derive them once per board change rather than per connector.
  const anchorSlots = useMemo(() => connectorAnchorSlots(project), [project]);
  const obstaclesByConnector = useMemo(
    () => new Map(project.connectors.map((connector) => [connector.id, connectorObstacles(project, connector).map(toCanvasSpace)])),
    [project]
  );
  return (
    <svg className="connector-layer" width={CANVAS_WIDTH} height={CANVAS_HEIGHT} viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}>
      {project.connectors.map((connector) => {
        const fromRect = connectorWorldRect(project, connector.fromArtboardId, connector.fromElementId);
        const toRect = connectorWorldRect(project, connector.toArtboardId, connector.toElementId);
        if (!fromRect || !toRect) return null;
        const selected = selectedIds.includes(connector.id);
        const draftPoint = waypointDraft && waypointDraft.id === connector.id ? { x: waypointDraft.x, y: waypointDraft.y } : null;
        // Preview the dragged waypoint so the spine follows the cursor before we persist.
        const effective = draftPoint ? { ...connector, waypoints: [draftPoint] } : connector;
        const geometry = connectorGeometry(fromRect, toRect, effective, {
          obstacles: obstaclesByConnector.get(connector.id) ?? [],
          toSlot: anchorSlots.get(connector.id)
        });
        const stroke = String(connector.style.stroke ?? "#44403C");
        const agentActive = agentActiveIds.has(connector.id);
        const strokeWidth = (connector.style.strokeWidth ?? 2) + (selected ? 1.5 : 0);
        const dash = strokeDashPattern(connector.style.strokeStyle, connector.style.strokeWidth ?? 2);
        const labelWidth = connector.label ? connectorLabelWidth(connector.label) : 0;
        const labelAt = connector.label
          ? connectorLabelPoint(geometry.samples, connector.labelPosition, labelWidth, [
              ...(obstaclesByConnector.get(connector.id) ?? []),
              fromRect,
              toRect
            ]).point
          : geometry.labelPoint;
        const endHead = arrowheadPath(geometry.end, geometry.endAngle, connector.arrowEnd);
        const startHead = connector.arrowStart !== "none" ? arrowheadPath(geometry.start, geometry.startAngle + Math.PI, connector.arrowStart) : "";
        // Handle sits on the active waypoint if there is one, else at the straight-line midpoint.
        const handleAt = draftPoint ?? effective.waypoints[0] ?? { x: (geometry.start.x + geometry.end.x) / 2, y: (geometry.start.y + geometry.end.y) / 2 };
        // If the midpoint handle sits on the label ("fl●w"), lift the label clear while selected —
        // a constant screen offset so it holds at any zoom.
        const labelLift =
          selected && connector.label && Math.hypot(labelAt.x - handleAt.x, labelAt.y - handleAt.y) < 24 / zoom
            ? 20 / zoom
            : 0;
        return (
          <g key={connector.id} className={classNames("connector", selected && "selected", agentActive && "agent-active")}>
            {/* Wide invisible hit target for easy selection. */}
            <path
              d={geometry.d}
              stroke="transparent"
              strokeWidth={Math.max(16, strokeWidth + 12)}
              fill="none"
              style={{ cursor: "pointer", pointerEvents: "stroke" }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelect([connector.id], event.shiftKey);
              }}
            />
            <path
              className="connector-spine"
              d={geometry.d}
              stroke={stroke}
              strokeWidth={strokeWidth}
              fill="none"
              strokeLinecap={dash?.lineCap ?? "round"}
              strokeLinejoin="round"
              strokeDasharray={dash?.dashArray}
            />
            {endHead ? <path d={endHead} stroke={stroke} strokeWidth={strokeWidth} fill={arrowheadIsFilled(connector.arrowEnd) ? stroke : "none"} strokeLinejoin="round" /> : null}
            {startHead ? <path d={startHead} stroke={stroke} strokeWidth={strokeWidth} fill={arrowheadIsFilled(connector.arrowStart) ? stroke : "none"} strokeLinejoin="round" /> : null}
            {connector.label ? (
              <g className="connector-label">
                <rect x={labelAt.x - labelWidth / 2} y={labelAt.y - 11 - labelLift} width={labelWidth} height={22} rx={11} />
                <text x={labelAt.x} y={labelAt.y + 4 - labelLift} textAnchor="middle">
                  {connector.label}
                </text>
              </g>
            ) : null}
            {selected ? (
              <g className="connector-waypoint">
                <circle
                  cx={handleAt.x}
                  cy={handleAt.y}
                  r={hitRadius}
                  fill="transparent"
                  style={{ cursor: "grab", pointerEvents: "all" }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    (event.target as SVGElement).setPointerCapture?.(event.pointerId);
                    dragRef.current = { id: connector.id, moved: false, point: handleAt };
                    setWaypointDraft({ id: connector.id, x: handleAt.x, y: handleAt.y });
                  }}
                  onPointerMove={(event) => {
                    const session = dragRef.current;
                    if (!session || session.id !== connector.id) return;
                    const world = clientToWorld(event.clientX, event.clientY);
                    if (!world) return;
                    session.moved = true;
                    session.point = world;
                    setWaypointDraft({ id: connector.id, x: world.x, y: world.y });
                  }}
                  onPointerUp={(event) => {
                    const session = dragRef.current;
                    dragRef.current = null;
                    (event.target as SVGElement).releasePointerCapture?.(event.pointerId);
                    if (session?.moved) onSetWaypoint(connector.id, session.point);
                    setWaypointDraft(null);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    onSetWaypoint(connector.id, null);
                  }}
                >
                  <title>Drag to bend · double-click to straighten</title>
                </circle>
                <circle className="connector-waypoint-dot" cx={handleAt.x} cy={handleAt.y} r={dotRadius} strokeWidth={1.5 / zoom} style={{ pointerEvents: "none" }} />
              </g>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function SelectionInspector({
  project,
  selectedIds,
  onFocus,
  onGroup,
  onDuplicate,
  onDelete,
  onLayout
}: {
  project: BoardProject;
  selectedIds: string[];
  onFocus: () => void;
  onGroup: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onLayout: (layout: "tree" | "flow" | "distribute-horizontal" | "distribute-vertical" | "align-left" | "align-center-x" | "align-right" | "align-top" | "align-center-y" | "align-bottom") => void;
}) {
  const selectedElements = selectedIds.map((id) => project.elements.find((element) => element.id === id)).filter((element): element is BoardElement => Boolean(element));
  const selectedArtboards = selectedIds.map((id) => project.artboards.find((artboard) => artboard.id === id)).filter((artboard): artboard is Artboard => Boolean(artboard));
  return (
    <div className="inspector-fields">
      <ReadOnlyField label="Selection" value={`${selectedIds.length} selected`} />
      <ReadOnlyField label="Elements" value={String(selectedElements.length)} />
      <ReadOnlyField label="Frames" value={String(selectedArtboards.length)} />
      <div className="segmented-row">
        <button onClick={onFocus}>
          <Focus size={15} /> Focus
        </button>
        <button onClick={onDuplicate}>
          <Copy size={15} /> Duplicate
        </button>
      </div>
      <div className="segmented-row">
        <button onClick={onGroup} disabled={selectedElements.length < 2 || selectedArtboards.length > 0}>
          <Group size={15} /> Group
        </button>
        <button onClick={onDelete} disabled={!selectedElements.length}>
          <Trash2 size={15} /> Delete
        </button>
      </div>
      <p className="inspector-subhead">Align</p>
      <div className="align-grid">
        <button title="Align left" onClick={() => onLayout("align-left")}><AlignStartVertical size={15} /></button>
        <button title="Align center X" onClick={() => onLayout("align-center-x")}><AlignCenterVertical size={15} /></button>
        <button title="Align right" onClick={() => onLayout("align-right")}><AlignEndVertical size={15} /></button>
        <button title="Align top" onClick={() => onLayout("align-top")}><AlignStartHorizontal size={15} /></button>
        <button title="Align middle Y" onClick={() => onLayout("align-center-y")}><AlignCenterHorizontal size={15} /></button>
        <button title="Align bottom" onClick={() => onLayout("align-bottom")}><AlignEndHorizontal size={15} /></button>
        <button title="Distribute horizontally" onClick={() => onLayout("distribute-horizontal")} disabled={selectedElements.length < 3}><AlignHorizontalDistributeCenter size={15} /></button>
        <button title="Distribute vertically" onClick={() => onLayout("distribute-vertical")} disabled={selectedElements.length < 3}><AlignVerticalDistributeCenter size={15} /></button>
      </div>
      <div className="segmented-row">
        <button onClick={() => onLayout("tree")}>
          <Network size={15} /> Tree
        </button>
        <button onClick={() => onLayout("flow")}>
          <Workflow size={15} /> Flow
        </button>
      </div>
      <div className="selection-list">
        {selectedIds.map((id) => {
          const element = project.elements.find((candidate) => candidate.id === id);
          const artboard = project.artboards.find((candidate) => candidate.id === id);
          return (
            <div key={id} className="selection-row" title={`${element?.name ?? artboard?.name ?? id} · ${id}`}>
              <span>{element?.name ?? artboard?.name ?? id}</span>
              <small>{element?.type ?? (artboard ? "frame" : "unknown")}</small>
            </div>
          );
        })}
      </div>
      <details className="id-details">
        <summary>Selection IDs</summary>
        <ReadOnlyField label="IDs" value={selectedIds.join(", ")} copyable />
      </details>
    </div>
  );
}

/**
 * What the inspector shows when nothing is selected.
 *
 * It used to be a 180px poster — a cursor glyph and "Select a frame, element, or connector." — which
 * made the panel emptiest exactly where it had the most room. A design tool's no-selection state is
 * the *document* state: this reports what the board actually contains and hands over the two view
 * actions you reach for before you've picked anything.
 */
function DocumentInspector({
  project,
  zoom,
  onResetZoom,
  onFitAll
}: {
  project: BoardProject;
  zoom: number;
  onResetZoom: () => void;
  onFitAll: () => void;
}) {
  const page = project.pages[0];
  const stats: Array<[string, string]> = [
    ["Frames", String(project.artboards.length)],
    ["Elements", String(project.elements.length)],
    ["Connectors", String(project.connectors.length)],
    ["Assets", String(project.assets.length)]
  ];
  return (
    <div className="inspector-fields document-inspector">
      <div className="document-head">
        <strong>{project.name}</strong>
        <small>{page ? page.name : "Page 1"}</small>
      </div>
      <dl className="document-stats">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="segmented-row">
        <button onClick={onResetZoom}>{Math.round(zoom * 100)}%</button>
        <button onClick={onFitAll}>
          <Maximize2 size={14} /> Fit all
        </button>
      </div>
      <p className="muted">Select a frame, element, or connector to edit it. Double-click text to type. Press ? for shortcuts.</p>
    </div>
  );
}

function ElementInspector({
  project,
  element,
  onChange,
  onReorder
}: {
  project: BoardProject;
  element: BoardElement;
  onChange: (patch: Record<string, unknown>) => void;
  onReorder: (delta: number) => void;
}) {
  // A Content band with nothing in it is worse than no band — only render it when this element type
  // actually carries editable copy or a kind selector.
  const hasContentFields =
    "text" in element.props ||
    "title" in element.props ||
    "subtitle" in element.props ||
    "body" in element.props ||
    ["button", "badge", "sticky", "text", "shape", "icon", "line", "sparkline"].includes(element.type);
  return (
    <div className="inspector-fields">
      {/* Identity first and without section chrome: what this element *is* outranks any one property.
          The internal id and hierarchy path used to sit above it — machine metadata as fields #1 and #2. */}
      <Field label="Name" value={element.name} onChange={(name) => onChange({ name })} />
      <Field label="Role" value={element.semanticRole ?? ""} onChange={(semanticRole) => onChange({ semanticRole })} />

      <InspectorGroup title="Layout">
        <div className="field-grid two-col">
          <NumberField label="X" glyph="X" value={element.x} min={-5000} max={5000} onChange={(x) => onChange({ x: Math.round(x) })} />
          <NumberField label="Y" glyph="Y" value={element.y} min={-5000} max={5000} onChange={(y) => onChange({ y: Math.round(y) })} />
          <NumberField label="Width" glyph="W" value={element.width} min={12} max={3000} onChange={(width) => onChange({ width: Math.round(width) })} />
          <NumberField label="Height" glyph="H" value={element.height} min={12} max={3000} onChange={(height) => onChange({ height: Math.round(height) })} />
        </div>
      </InspectorGroup>

      {hasContentFields ? (
        <InspectorGroup title="Content">
          {"text" in element.props || ["button", "badge", "sticky", "text"].includes(element.type) ? <Field label="Text" value={readString(element.props.text, "")} onChange={(text) => onChange({ props: { text } })} /> : null}
          {element.type === "shape" ? (
            <label className="field">
              <span>Shape</span>
              <select value={readString(element.props.shape, "rectangle")} onChange={(event) => onChange({ props: { shape: event.target.value } })}>
                {shapeKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {labelFor(kind.replace(/-/g, " "))}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {element.type === "icon" ? <Field label="Material icon" value={readString(element.props.materialIcon ?? element.props.icon, "add_circle")} onChange={(materialIcon) => onChange({ props: { materialIcon } })} /> : null}
          {element.type === "line" ? <Field label="Direction" value={readString(element.props.direction, "horizontal")} onChange={(direction) => onChange({ props: { direction } })} /> : null}
          {element.type === "sparkline" ? <Field label="Values" value={formatNumberList(readNumberArray(element.props.values, []))} onChange={(values) => onChange({ props: { values: parseNumberList(values) } })} /> : null}
          {"title" in element.props ? <Field label="Title" value={readString(element.props.title, "")} onChange={(title) => onChange({ props: { title } })} /> : null}
          {"subtitle" in element.props || element.type === "shape" ? <Field label="Subtitle" value={readString(element.props.subtitle, "")} onChange={(subtitle) => onChange({ props: { subtitle } })} /> : null}
          {"body" in element.props ? <Field label="Body" value={readString(element.props.body, "")} onChange={(body) => onChange({ props: { body } })} /> : null}
        </InspectorGroup>
      ) : null}

      <InspectorGroup title="Appearance">
        <ColorField label="Fill" value={element.style.fill ?? "#FFFFFF"} onChange={(fill) => onChange({ style: { fill } })} />
        <ColorField label="Text" value={element.style.color ?? "#111827"} onChange={(color) => onChange({ style: { color } })} />
        <ColorField label="Stroke" value={element.style.stroke ?? "#64748B"} onChange={(stroke) => onChange({ style: { stroke } })} />
        <NumberField label="Stroke width" value={element.style.strokeWidth ?? 0} min={0} max={12} step={0.5} onChange={(strokeWidth) => onChange({ style: { strokeWidth } })} />
        <SegmentedControl label="Stroke style" value={element.style.strokeStyle ?? "solid"} options={STROKE_STYLE_OPTIONS} onChange={(strokeStyle) => onChange({ style: { strokeStyle } })} />
        <NumberField label="Corner radius" value={element.style.radius ?? 0} min={0} max={80} onChange={(radius) => onChange({ style: { radius } })} />
        <NumberField label="Opacity" value={element.style.opacity ?? 1} min={0.1} max={1} step={0.05} onChange={(opacity) => onChange({ style: { opacity } })} />
        <NumberField label="Font size" value={element.style.fontSize ?? 14} min={8} max={72} onChange={(fontSize) => onChange({ style: { fontSize } })} />
      </InspectorGroup>

      <InspectorGroup title="Arrange">
        {/* Depth is Forward/Back, not a 0–999 z-index box: the number was a model leak, not a control. */}
        <div className="segmented-row">
          <button onClick={() => onReorder(1)}>
            <BringToFront size={15} /> Forward
          </button>
          <button onClick={() => onReorder(-1)}>
            <Layers3 size={15} /> Back
          </button>
        </div>
        <div className="segmented-row">
          <button onClick={() => onChange({ locked: !element.locked })}>{element.locked ? <Lock size={15} /> : <LockOpen size={15} />} {element.locked ? "Locked" : "Unlocked"}</button>
          <button onClick={() => onChange({ visible: !element.visible })}>{element.visible ? <Eye size={15} /> : <EyeOff size={15} />} {element.visible ? "Visible" : "Hidden"}</button>
        </div>
      </InspectorGroup>

      {/* Agent-facing identifiers stay reachable — one click — without leading the panel. */}
      <InspectorGroup title="Reference" defaultOpen={false}>
        <ReadOnlyField label="Internal ID" value={element.id} copyable />
        <ReadOnlyField label="Path" value={elementPath(project, element)} />
      </InspectorGroup>
    </div>
  );
}

function ArtboardInspector({ artboard, onChange, onDelete }: { artboard: Artboard; onChange: (patch: Partial<Artboard>) => void; onDelete: () => void }) {
  return (
    <div className="inspector-fields">
      <Field label="Name" value={artboard.name} onChange={(name) => onChange({ name })} />
      <p className="muted">{artboard.type} · {Math.round(artboard.width)} × {Math.round(artboard.height)}</p>

      <InspectorGroup title="Layout">
        <div className="field-grid two-col">
          <NumberField label="X" glyph="X" value={artboard.x} min={-20000} max={20000} onChange={(x) => onChange({ x: Math.round(x) })} />
          <NumberField label="Y" glyph="Y" value={artboard.y} min={-20000} max={20000} onChange={(y) => onChange({ y: Math.round(y) })} />
          <NumberField label="Width" glyph="W" value={artboard.width} min={240} max={2400} onChange={(width) => onChange({ width: Math.round(width) })} />
          <NumberField label="Height" glyph="H" value={artboard.height} min={240} max={2400} onChange={(height) => onChange({ height: Math.round(height) })} />
        </div>
      </InspectorGroup>

      <InspectorGroup title="Appearance">
        <ColorField label="Background" value={artboard.background} onChange={(background) => onChange({ background })} />
        <label className="toggle-row">
          <input type="checkbox" checked={artboard.frameless} onChange={(event) => onChange({ frameless: event.target.checked })} />
          <span>Frameless (diagram canvas — no device chrome)</span>
        </label>
      </InspectorGroup>

      <InspectorGroup title="Arrange">
        <div className="segmented-row">
          <button onClick={() => onChange({ locked: !artboard.locked })}>{artboard.locked ? <Lock size={15} /> : <LockOpen size={15} />} {artboard.locked ? "Locked" : "Unlocked"}</button>
          <button onClick={() => onChange({ visible: !artboard.visible })}>{artboard.visible ? <Eye size={15} /> : <EyeOff size={15} />} {artboard.visible ? "Visible" : "Hidden"}</button>
        </div>
        <button className="wide-action danger" onClick={onDelete}>
          <Trash2 size={15} /> Delete frame
        </button>
      </InspectorGroup>

      <InspectorGroup title="Reference" defaultOpen={false}>
        <ReadOnlyField label="Internal ID" value={artboard.id} copyable />
      </InspectorGroup>
    </div>
  );
}

const CONNECTOR_PORT_OPTIONS: Array<{ value: BoardConnector["fromPort"]; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "n", label: "Top" },
  { value: "e", label: "Right" },
  { value: "s", label: "Bottom" },
  { value: "w", label: "Left" }
];

const STROKE_STYLE_OPTIONS = strokeStyles.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }));

/** Tiny arrowhead preview glyph for the segmented pickers. */
function ArrowGlyph({ kind }: { kind: BoardConnector["arrowEnd"] }) {
  return (
    <svg viewBox="0 0 26 12" width={26} height={12} aria-hidden="true" className="arrow-glyph">
      <line x1={1} y1={6} x2={kind === "none" ? 25 : 17} y2={6} strokeWidth={1.6} />
      {kind === "arrow" ? <path d="M17 6 L11 2 M17 6 L11 10" fill="none" strokeWidth={1.6} /> : null}
      {kind === "triangle" ? <path d="M25 6 L15 1.5 L15 10.5 Z" strokeWidth={1} className="filled" /> : null}
      {kind === "dot" ? <circle cx={20} cy={6} r={3.4} strokeWidth={1} className="filled" /> : null}
      {kind === "diamond" ? <path d="M25 6 L20 1.5 L15 6 L20 10.5 Z" strokeWidth={1} className="filled" /> : null}
      {kind === "arrow" ? <line x1={17} y1={6} x2={25} y2={6} strokeWidth={1.6} /> : null}
    </svg>
  );
}

function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label?: string; render?: React.ReactNode; title?: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="segmented-control" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            title={option.title ?? option.label ?? option.value}
            className={classNames("segment", value === option.value && "active")}
            onClick={() => onChange(option.value)}
          >
            {option.render ?? option.label ?? option.value}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConnectorInspector({
  project,
  connector,
  onChange,
  onDelete
}: {
  project: BoardProject;
  connector: BoardConnector;
  onChange: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const arrowheads: BoardConnector["arrowEnd"][] = ["none", "arrow", "triangle", "dot", "diamond"];
  const arrowOptions = arrowheads.map((kind) => ({ value: kind, render: <ArrowGlyph kind={kind} />, title: kind === "none" ? "None" : kind[0]!.toUpperCase() + kind.slice(1) }));
  function swapDirection() {
    onChange({
      fromArtboardId: connector.toArtboardId,
      toArtboardId: connector.fromArtboardId,
      fromElementId: connector.toElementId ?? null,
      toElementId: connector.fromElementId ?? null,
      fromPort: connector.toPort,
      toPort: connector.fromPort,
      arrowStart: connector.arrowEnd,
      arrowEnd: connector.arrowStart
    });
  }
  return (
    <div className="inspector-fields connector-inspector">
      <div className="connector-endpoints">
        <span className="endpoint-chip" title="Start of the connector">{connectorEndName(project, connector, "from")}</span>
        <button className="endpoint-swap" title="Swap direction" aria-label="Swap connector direction" onClick={swapDirection}>
          <ArrowLeftRight size={13} />
        </button>
        <span className="endpoint-chip" title="End of the connector">{connectorEndName(project, connector, "to")}</span>
      </div>
      <Field label="Label (shown on the line)" value={connector.label ?? ""} onChange={(label) => onChange({ label })} />
      <SegmentedControl
        label="Path"
        value={connector.routing}
        options={[
          { value: "curved", label: "Curved" },
          { value: "orthogonal", label: "Elbow" },
          { value: "straight", label: "Straight" }
        ]}
        onChange={(routing) => onChange({ routing })}
      />
      <SegmentedControl label="Start cap" value={connector.arrowStart} options={arrowOptions} onChange={(arrowStart) => onChange({ arrowStart })} />
      <SegmentedControl label="End cap" value={connector.arrowEnd} options={arrowOptions} onChange={(arrowEnd) => onChange({ arrowEnd })} />
      <SegmentedControl label="Leaves start from" value={connector.fromPort} options={CONNECTOR_PORT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} onChange={(fromPort) => onChange({ fromPort })} />
      <SegmentedControl label="Enters target at" value={connector.toPort} options={CONNECTOR_PORT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} onChange={(toPort) => onChange({ toPort })} />
      <SegmentedControl
        label="Line style"
        value={connector.style.strokeStyle ?? "solid"}
        options={STROKE_STYLE_OPTIONS}
        onChange={(strokeStyle) => onChange({ style: { strokeStyle } })}
      />
      <ColorField label="Line color" value={connector.style.stroke ?? "#44403C"} onChange={(stroke) => onChange({ style: { stroke } })} />
      <NumberField label="Thickness" value={connector.style.strokeWidth ?? 2} min={1} max={8} step={0.5} onChange={(strokeWidth) => onChange({ style: { strokeWidth } })} />
      <button className="wide-action danger" onClick={onDelete}>
        <Trash2 size={15} /> Delete connector
      </button>
    </div>
  );
}

function connectorEndName(project: BoardProject, connector: BoardConnector, end: "from" | "to"): string {
  const elementId = end === "from" ? connector.fromElementId : connector.toElementId;
  const artboardId = end === "from" ? connector.fromArtboardId : connector.toArtboardId;
  if (elementId) {
    const element = project.elements.find((candidate) => candidate.id === elementId);
    if (element) return compactName(element.name);
  }
  return project.artboards.find((candidate) => candidate.id === artboardId)?.name ?? artboardId;
}

function ReadOnlyField({ label, value, copyable = false }: { label: string; value: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copyValue() {
    try {
      if (!navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="field readonly-field">
      <span>{label}</span>
      <div className="readonly-value-row">
        <input value={value} aria-label={label} readOnly onFocus={(event) => event.currentTarget.select()} />
        {copyable ? (
          <button type="button" title={`Copy ${label}`} onClick={() => void copyValue()}>
            <Copy size={14} />
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/** One row: name, swatch, hex — the shape every design tool uses for a colour, and half the height
 *  of the stacked label + swatch + hex it replaced. */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field color-field">
      <span>{label}</span>
      <input type="color" aria-label={`${label} colour picker`} value={normalizeColor(value)} onChange={(event) => onChange(event.target.value)} />
      <input value={value} aria-label={`${label} hex value`} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/**
 * Compact numeric field. The label doubles as a **drag-scrub handle** — the gesture every design tool
 * shares (Figma, Sketch, Paper) — while the input still takes an exact typed number.
 *
 * This replaces a `range` + `number` pair. A slider is the wrong control for an unbounded spatial
 * coordinate: it can never land on an exact value, and it cost four stacked rows per coordinate, which
 * is most of why a one-element inspector was taller than the panel that held it.
 *
 * `glyph` is the in-gutter label (X, Y, W, H, ∅, …); `label` stays the accessible name.
 */
function NumberField({
  label,
  glyph,
  value,
  min,
  max,
  step = 1,
  onChange
}: {
  label: string;
  glyph?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const origin = useRef<{ x: number; value: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  // Fractional steps (opacity 0.05, stroke width 0.5) must not accumulate float dust as you drag.
  const decimals = useMemo(() => {
    const text = String(step);
    return text.includes(".") ? text.split(".")[1]!.length : 0;
  }, [step]);
  const quantize = (next: number) => Number(Math.min(max, Math.max(min, next)).toFixed(decimals));

  function beginScrub(event: React.PointerEvent<HTMLSpanElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = { x: event.clientX, value };
    setScrubbing(true);
  }
  function moveScrub(event: React.PointerEvent<HTMLSpanElement>) {
    const start = origin.current;
    if (!start) return;
    // 2px of travel per step keeps fine adjustment precise; shift multiplies by 10 for coarse moves.
    const steps = Math.round((event.clientX - start.x) / 2);
    const next = quantize(start.value + steps * step * (event.shiftKey ? 10 : 1));
    if (next !== value) onChange(next);
  }
  function endScrub(event: React.PointerEvent<HTMLSpanElement>) {
    if (!origin.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    origin.current = null;
    setScrubbing(false);
  }

  // X/Y/W/H are universal and read fine as a single letter in the gutter. Everything else gets its
  // name spelled out to the left of the control, matching the colour rows — a mystery glyph is worse
  // than the row it saves.
  const scrubHandlers = {
    onPointerDown: beginScrub,
    onPointerMove: moveScrub,
    onPointerUp: endScrub,
    onPointerCancel: endScrub
  };
  const scrubTitle = `${label} — drag to adjust, shift for ×10`;

  if (!glyph) {
    return (
      // A <div>, not a <label>: a label hands focus to its control on any click inside it, so ending a
      // scrub left the number input focused and the next ⌘Z / Delete / arrow-nudge went to the field
      // instead of the board. The input carries its own aria-label.
      <div className={classNames("field row", scrubbing && "scrubbing")}>
        <span className="field-row-label" title={scrubTitle} {...scrubHandlers}>
          {label}
        </span>
        <span className="field-row-control">
          <input
            type="number"
            aria-label={label}
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(event) => {
              const raw = Number(event.target.value);
              if (Number.isFinite(raw)) onChange(quantize(raw));
            }}
          />
        </span>
      </div>
    );
  }

  return (
    <div className={classNames("field compact", scrubbing && "scrubbing")}>
      <span className="field-glyph" role="presentation" title={scrubTitle} {...scrubHandlers}>
        {glyph}
      </span>
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const raw = Number(event.target.value);
          if (Number.isFinite(raw)) onChange(quantize(raw));
        }}
      />
    </div>
  );
}

/**
 * A titled, collapsible band inside the inspector. Without these the element inspector was one
 * undifferentiated stack of ~21 controls, so nothing had rank and everything below the fold was lost.
 */
function InspectorGroup({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={classNames("inspector-group", !open && "collapsed")}>
      <button type="button" className="inspector-group-title" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{title}</span>
      </button>
      {open ? <div className="inspector-group-body">{children}</div> : null}
    </section>
  );
}

function CollapsiblePanel({
  id,
  icon,
  title,
  collapsed,
  className,
  onToggle,
  children
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  collapsed: boolean;
  className?: string;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  const contentId = `panel-${id}`;
  return (
    <section className={classNames("panel-section", className, collapsed && "collapsed")}>
      <button className="panel-title" type="button" aria-expanded={!collapsed} aria-controls={contentId} onClick={() => onToggle(id)}>
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        {icon}
        <span className="panel-heading">{title}</span>
      </button>
      {!collapsed ? (
        <div id={contentId} className="panel-content">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function IconButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button className={active ? "icon-button active" : "icon-button"} onClick={onClick} data-tip={label} aria-label={label} disabled={disabled}>
      {children}
    </button>
  );
}

/** A toolbar dropdown: click to open, click-away / Esc to close. Keeps the top bar compact. */
function ToolbarMenu({ label, icon, children }: { id: string; label: string; icon: React.ReactNode; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={classNames("toolbar-menu", open && "open")} ref={ref}>
      <button className={classNames("toolbar-menu-trigger", open && "active")} onClick={() => setOpen((current) => !current)} aria-haspopup="menu" aria-expanded={open}>
        {icon}
        <span>{label}</span>
        <ChevronDown size={13} className="menu-caret" />
      </button>
      {open ? (
        <div className="toolbar-menu-pop" role="menu">
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/** Floating bottom-right zoom + view control (Figma/Miro convention). */
function ZoomControl({
  zoom,
  focusMode,
  onZoomIn,
  onZoomOut,
  onReset,
  onFit,
  onFocusSelection,
  canFocusSelection,
  onToggleFocusMode
}: {
  zoom: number;
  focusMode: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFit: () => void;
  onFocusSelection: () => void;
  canFocusSelection: boolean;
  onToggleFocusMode: () => void;
}) {
  return (
    <div className="zoom-control" role="group" aria-label="Zoom and view">
      <button className="zoom-seg" data-tip="Fit all frames (⌘1)" aria-label="Fit all frames" onClick={onFit}>
        <Maximize2 size={16} />
      </button>
      <button className="zoom-seg" data-tip="Focus selection" aria-label="Focus selection" onClick={onFocusSelection} disabled={!canFocusSelection}>
        <Focus size={16} />
      </button>
      <span className="zoom-divider" />
      <button className="zoom-seg" data-tip="Zoom out (⌘−)" aria-label="Zoom out" onClick={onZoomOut}>
        <ZoomOut size={16} />
      </button>
      <button className="zoom-readout-button" title="Reset to 100% (⌘0)" onClick={onReset}>
        {Math.round(zoom * 100)}%
      </button>
      <button className="zoom-seg" data-tip="Zoom in (⌘+)" aria-label="Zoom in" onClick={onZoomIn}>
        <ZoomIn size={16} />
      </button>
      <span className="zoom-divider" />
      <button className={classNames("zoom-seg", focusMode && "active")} data-tip={focusMode ? "Exit focus mode (F)" : "Focus mode (F)"} aria-label="Toggle focus mode" onClick={onToggleFocusMode}>
        {focusMode ? <Minimize2 size={16} /> : <Expand size={16} />}
      </button>
    </div>
  );
}

const BOARD_TEMPLATES: Array<{ id: BoardTemplate; title: string; blurb: string; icon: React.ReactNode }> = [
  { id: "blank", title: "Blank canvas", blurb: "An empty infinite canvas. Start from nothing.", icon: <Sparkles size={20} /> },
  { id: "mobile", title: "Mobile app", blurb: "One empty iPhone frame, ready to design.", icon: <Smartphone size={20} /> },
  { id: "web", title: "Web page", blurb: "One empty 1440×900 desktop frame.", icon: <LayoutTemplate size={20} /> },
  { id: "diagram", title: "Diagram", blurb: "A frameless canvas for flowcharts & org charts.", icon: <Network size={20} /> },
  { id: "starter", title: "Starter demo", blurb: "Sample mobile + web screens to explore.", icon: <Component size={20} /> }
];

function NewBoardDialog({ defaultName, onCancel, onCreate }: { defaultName: string; onCancel: () => void; onCreate: (name: string, template: BoardTemplate) => void }) {
  const [name, setName] = useState(defaultName);
  const [template, setTemplate] = useState<BoardTemplate>("blank");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <form className="new-board-dialog" role="dialog" aria-modal="true" aria-labelledby="new-board-title" onSubmit={(event) => { event.preventDefault(); onCreate(name, template); }}>
        <div className="dialog-head">
          <h2 id="new-board-title">New board</h2>
          <p>Pick a starting point — you can add or change anything later.</p>
        </div>
        <div className="template-grid">
          {BOARD_TEMPLATES.map((option) => (
            <button
              type="button"
              key={option.id}
              className={classNames("template-card", template === option.id && "selected")}
              onClick={() => setTemplate(option.id)}
              aria-pressed={template === option.id}
            >
              <span className="template-icon">{option.icon}</span>
              <span className="template-title">{option.title}</span>
              <span className="template-blurb">{option.blurb}</span>
              {template === option.id ? <span className="template-check"><Check size={13} /></span> : null}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Board name</span>
          <input value={name} autoFocus onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary"><Plus size={15} /> Create board</button>
        </div>
      </form>
    </div>
  );
}

function DeleteBoardDialog({ board, busy, onCancel, onConfirm }: { board: BoardSummary; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <div className="new-board-dialog delete-board-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-board-title" aria-describedby="delete-board-desc">
        <div className="dialog-head">
          <h2 id="delete-board-title">Delete board</h2>
          <p id="delete-board-desc">
            Permanently delete <strong>{board.name}</strong> — {board.artboardCount} {pluralize(board.artboardCount, "frame")}, {board.elementCount} {pluralize(board.elementCount, "element")}. This can’t be undone.
          </p>
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="danger" onClick={onConfirm} disabled={busy} autoFocus>
            <Trash2 size={15} /> {busy ? "Deleting…" : "Delete board"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Screen-space padding between the locked target and the reticle brackets, before the zoom divide. */
const RETICLE_PAD_PX = 11;

/**
 * The agent's focus lock: four corner brackets that *travel* between targets on an eased flight, so a
 * burst of agent work reads as one attention moving around the board rather than a series of flashes.
 * `reading` breathes wide and slow; `editing` tightens and glows. Motion lives in CSS (reduce-motion safe).
 */
function AgentReticle({ presence, bounds, zoom, named }: { presence: AgentPresence; bounds: Bounds; zoom: number; named: boolean }) {
  const pad = RETICLE_PAD_PX / zoom;
  return (
    <div
      className={classNames("agent-reticle", `is-${presence.phase}`)}
      // Each agent carries its own channel triple, so two locks on screen never read as one attention.
      style={{
        left: bounds.x - pad,
        top: bounds.y - pad,
        width: bounds.width + pad * 2,
        height: bounds.height + pad * 2,
        ["--agent-rgb" as string]: agentRgb(presence.agentId)
      }}
      aria-hidden="true"
    >
      <span className="agent-reticle-corner tl" />
      <span className="agent-reticle-corner tr" />
      <span className="agent-reticle-corner bl" />
      <span className="agent-reticle-corner br" />
      {/* The name only earns its space once there is someone to be confused with. */}
      <span className="agent-reticle-label" style={{ transform: `scale(${1 / zoom})` }}>
        {named ? `${presence.agentName} · ${presence.tool}` : presence.tool}
      </span>
    </div>
  );
}

/**
 * Ambient "the board is under agent control" signal: a hairline on the viewport edge with a single
 * light travelling its perimeter. Stays mounted so it can cross-fade instead of snapping, and parks its
 * animation when idle.
 */
function AgentPresenceVeil({ live }: { live: boolean }) {
  return (
    <svg className={classNames("agent-presence-veil", live && "is-live")} aria-hidden="true">
      <rect className="agent-veil-base" width="100%" height="100%" rx="12" pathLength={100} />
      <rect className="agent-veil-sheen" width="100%" height="100%" rx="12" pathLength={100} />
    </svg>
  );
}

/**
 * The PowerBoard mark (brand Direction D: board frame + live agent pulse), matching the macOS
 * app icon. Inline rather than an <img> so it needs no network fetch and stays crisp on HiDPI.
 *
 * Follows the brand system's *small* variant (`apps/desktop/build/icon-small.svg`), not the
 * full-size one: at 42px the full icon's thin pulse rings land under a pixel and read as haze,
 * so the glow is carried by a radial bloom plus a larger solid core, over a thicker frame.
 * Ids are scoped per instance so two marks on screen can't collide on the gradient defs.
 */
function BrandMark({ size }: { size?: number }) {
  const uid = useId().replace(/:/g, "");
  const tile = `pb-tile-${uid}`;
  const bloom = `pb-bloom-${uid}`;
  const core = `pb-core-${uid}`;
  const clip = `pb-clip-${uid}`;
  return (
    <svg
      viewBox="0 0 512 512"
      width={size ?? "100%"}
      height={size ?? "100%"}
      role="img"
      aria-label="PowerBoard"
      focusable="false"
    >
      <defs>
        <linearGradient id={tile} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#1C1C2A" />
          <stop offset="0.55" stopColor="#111119" />
          <stop offset="1" stopColor="#08080D" />
        </linearGradient>
        <radialGradient id={bloom} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#7C4DFF" stopOpacity="0.48" />
          <stop offset="0.55" stopColor="#5B5BF0" stopOpacity="0.15" />
          <stop offset="1" stopColor="#5B5BF0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={core} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8272FF" />
          <stop offset="1" stopColor="#5E48E0" />
        </linearGradient>
        <clipPath id={clip}>
          <rect width="512" height="512" rx="115" />
        </clipPath>
      </defs>
      <rect width="512" height="512" rx="115" fill={`url(#${tile})`} />
      <g clipPath={`url(#${clip})`}>
        <circle cx="256" cy="256" r="170" fill={`url(#${bloom})`} />
      </g>
      <rect x="88" y="88" width="336" height="336" rx="80" fill="none" stroke="#5A5A72" strokeWidth="20" />
      <circle cx="256" cy="256" r="92" fill="#7C4DFF" opacity="0.12" />
      <circle cx="256" cy="256" r="74" fill="#8B6BFF" opacity="0.18" />
      <circle cx="256" cy="256" r="58" fill={`url(#${core})`} />
      <circle cx="256" cy="256" r="58" fill="none" stroke="#BCAEFF" strokeWidth="2.5" strokeOpacity="0.45" />
    </svg>
  );
}

// One card, one copy button, one instruction — chosen by the client the user actually has.
// Every client below speaks the same streamable-HTTP MCP endpoint; only the place you paste it
// differs, so the dialog shows exactly the one string that client needs and nothing else.
// (No stdio variant: it would hard-code a dev checkout path that an installed copy doesn't have,
// and a second stdio process would open its own store against the same board files.)
type ConnectClient = {
  id: string;
  label: string;
  paste: (endpoint: string) => string;
  block?: boolean;
  where: React.ReactNode;
};

const CONNECT_CLIENTS: [ConnectClient, ...ConnectClient[]] = [
  {
    id: "desktop",
    label: "Claude Desktop",
    paste: (endpoint) => endpoint,
    where: (
      <>
        Open <strong>Settings → Connectors → Add custom connector</strong> and paste it as the URL.
      </>
    )
  },
  {
    id: "cli",
    label: "Claude Code",
    paste: (endpoint) => `claude mcp add --transport http powerboard ${endpoint}`,
    block: true,
    where: <>Run it in your terminal, from any project folder.</>
  },
  {
    id: "cursor",
    label: "Cursor",
    block: true,
    paste: (endpoint) => `{\n  "mcpServers": {\n    "powerboard": { "url": "${endpoint}" }\n  }\n}`,
    where: (
      <>
        Put it in <code>~/.cursor/mcp.json</code>, then switch <strong>powerboard</strong> on under Settings → MCP.
      </>
    )
  },
  {
    id: "other",
    label: "Any other client",
    paste: (endpoint) => endpoint,
    where: (
      <>
        Add PowerBoard as a <strong>streamable HTTP</strong> MCP server with this URL. No key, no login.
      </>
    )
  }
];

function AgentConnectDialog({ open, project, health, onClose }: { open: boolean; project?: BoardProject | null; health: ApiHealth | null; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [clientId, setClientId] = useState(CONNECT_CLIENTS[0].id);
  useEffect(() => {
    if (!open) return;
    setCopied(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const httpEndpoint = mcpEndpointUrl();
  const client = CONNECT_CLIENTS.find((candidate) => candidate.id === clientId) ?? CONNECT_CLIENTS[0];
  const pasteValue = client.paste(httpEndpoint);
  const reachable = health?.ok !== false;
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1600);
    } catch {
      setCopied(null);
    }
  };
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="connect-dialog" role="dialog" aria-modal="true" aria-labelledby="connect-title">
        <div className="connect-head">
          <div className="connect-title-row">
            <span className="connect-icon"><Cable size={18} /></span>
            <div>
              <h2 id="connect-title">Connect an agent</h2>
              <p>Any MCP client can browse, create and edit your boards — every change streams onto the canvas live.</p>
            </div>
          </div>
          <span className={classNames("connect-health", reachable ? "ok" : "down")}>{reachable ? "Server live" : "Server unreachable"}</span>
        </div>

        <div className="connect-body">
          <div className="connect-clients" role="tablist" aria-label="Your MCP client">
            {CONNECT_CLIENTS.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                aria-selected={candidate.id === client.id}
                className={candidate.id === client.id ? "active" : ""}
                onClick={() => { setClientId(candidate.id); setCopied(null); }}
              >
                {candidate.label}
              </button>
            ))}
          </div>

          <div className="connect-paste">
            <div className="connect-paste-head">
              <span className="connect-label">Copy this into {client.label === "Any other client" ? "your client" : client.label}</span>
              <button type="button" className="copy-chip primary" onClick={() => void copy("paste", pasteValue)}>
                {copied === "paste" ? <Check size={13} /> : <Copy size={13} />} {copied === "paste" ? "Copied" : "Copy"}
              </button>
            </div>
            {client.block ? <pre>{pasteValue}</pre> : <code className="connect-paste-value">{pasteValue}</code>}
            <p className="connect-where">{client.where}</p>
          </div>

          <ol className="connect-steps">
            <li>Leave PowerBoard running — it serves MCP while the app is open.</li>
            <li>Ask your agent for <em>“list my PowerBoard boards”</em> to check it worked.</li>
          </ol>

          {project ? (
            <p className="connect-board-note">
              Want it to edit <strong>{project.name}</strong> specifically? Give it this board id:
              <code>{project.id}</code>
              <button type="button" className="link-button" onClick={() => void copy("board", project.id)}>
                {copied === "board" ? "Copied" : "Copy id"}
              </button>
            </p>
          ) : null}
        </div>

        <div className="dialog-actions">
          <button type="button" className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function hasSelectedDescendant(elementId: string, project: BoardProject, selectedIds: string[], seen = new Set<string>()): boolean {
  if (seen.has(elementId)) return false;
  seen.add(elementId);
  return project.elements.some(
    (candidate) =>
      candidate.parentId === elementId &&
      (selectedIds.includes(candidate.id) || hasSelectedDescendant(candidate.id, project, selectedIds, new Set(seen)))
  );
}

function elementPositionInArtboard(element: BoardElement, project: BoardProject): { x: number; y: number } | undefined {
  let x = element.x;
  let y = element.y;
  let parentId = element.parentId;
  const seen = new Set<string>([element.id]);
  while (parentId) {
    if (seen.has(parentId)) return undefined;
    seen.add(parentId);
    const parent = project.elements.find((candidate) => candidate.id === parentId);
    if (!parent) return undefined;
    x += parent.x;
    y += parent.y;
    parentId = parent.parentId;
  }
  return { x, y };
}

function elementToStyle(element: BoardElement): React.CSSProperties {
  // Shape and ink render their own vector fill/stroke inside an SVG, so the wrapper stays clear.
  const vectorPrimitive = element.type === "shape" || element.type === "ink";
  return {
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    zIndex: element.zIndex,
    background: vectorPrimitive ? undefined : element.style.fill,
    color: element.style.color,
    borderColor: vectorPrimitive ? undefined : element.style.stroke,
    borderWidth: vectorPrimitive ? undefined : element.style.strokeWidth,
    borderStyle: !vectorPrimitive && element.style.stroke ? (element.style.strokeStyle ?? "solid") : undefined,
    borderRadius: vectorPrimitive ? undefined : element.style.radius,
    boxShadow: element.style.shadow,
    opacity: element.style.opacity,
    fontFamily: element.style.fontFamily,
    fontSize: element.style.fontSize,
    fontWeight: element.style.fontWeight,
    lineHeight: element.style.lineHeight ? `${element.style.lineHeight}px` : undefined,
    letterSpacing: element.style.letterSpacing,
    textAlign: element.style.textAlign,
    padding: element.style.padding,
    gap: element.style.gap,
    alignItems: cssAlign(element.style.align ?? element.layout.align),
    justifyContent: cssJustify(element.style.justify ?? element.layout.justify)
  };
}

function cssAlign(value?: string) {
  if (value === "start") return "flex-start";
  if (value === "end") return "flex-end";
  return value;
}

function cssJustify(value?: string) {
  if (value === "start") return "flex-start";
  if (value === "end") return "flex-end";
  if (value === "between") return "space-between";
  return value;
}

function classNames(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
}

function isBitmapOnlyArtboard(artboard: Artboard, elements: BoardElement[]): boolean {
  if (elements.length !== 1) return false;
  const [element] = elements;
  if (!element || !element.locked || element.parentId) return false;
  if (element.type !== "screenshotOverlay" && element.type !== "image") return false;
  const coversFrame = element.x <= 0 && element.y <= 0 && element.width >= artboard.width && element.height >= artboard.height;
  return coversFrame;
}

function buildElementIndexes(project: BoardProject): ElementIndexes {
  const canvasRootsByArtboard = new Map<string, BoardElement[]>();
  const canvasChildrenByParent = new Map<string, BoardElement[]>();
  const layerRootsByArtboard = new Map<string, BoardElement[]>();
  const layerChildrenByParent = new Map<string, BoardElement[]>();

  for (const element of project.elements) {
    if (element.parentId) {
      pushMapValue(layerChildrenByParent, element.parentId, element);
      if (element.visible) pushMapValue(canvasChildrenByParent, element.parentId, element);
      continue;
    }
    pushMapValue(layerRootsByArtboard, element.artboardId, element);
    if (element.visible) pushMapValue(canvasRootsByArtboard, element.artboardId, element);
  }

  sortMapValues(canvasRootsByArtboard, (a, b) => a.zIndex - b.zIndex);
  sortMapValues(canvasChildrenByParent, (a, b) => a.zIndex - b.zIndex);
  sortMapValues(layerRootsByArtboard, (a, b) => b.zIndex - a.zIndex);
  sortMapValues(layerChildrenByParent, (a, b) => b.zIndex - a.zIndex);

  return { canvasRootsByArtboard, canvasChildrenByParent, layerRootsByArtboard, layerChildrenByParent };
}

function pushMapValue(map: Map<string, BoardElement[]>, key: string, value: BoardElement): void {
  const values = map.get(key);
  if (values) {
    values.push(value);
    return;
  }
  map.set(key, [value]);
}

function sortMapValues(map: Map<string, BoardElement[]>, compare: (a: BoardElement, b: BoardElement) => number): void {
  for (const values of map.values()) {
    values.sort(compare);
  }
}

function boardSummaryFromProject(project: BoardProject): BoardSummary {
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.metadata.updatedAt,
    artboardCount: project.artboards.length,
    elementCount: project.elements.length
  };
}

function upsertBoardSummary(summaries: BoardSummary[], project: BoardProject): BoardSummary[] {
  const summary = boardSummaryFromProject(project);
  return [summary, ...summaries.filter((candidate) => candidate.id !== project.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatAgentEditedAt(value: string, includeSeconds = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {})
  }).format(date);
}

function readLastAgentEditedAt(project: BoardProject): string | null {
  const value = (project.metadata as Record<string, unknown>).lastAgentEditedAt;
  if (typeof value !== "string") return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

function isAgentActivity(value: unknown): value is AgentActivity {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.source === "agent" && (record.kind === "operation" || record.kind === "selection") && Array.isArray(record.ids) && typeof record.at === "string";
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function agentActivityStatus(activity: AgentActivity): string {
  if (activity.kind === "selection") return `AI selected ${activity.ids.length || 0} ${pluralize(activity.ids.length || 0, "item")}`;
  return `AI ${agentOperationVerb(activity.operationType)}`;
}

function agentOperationVerb(operationType?: string): string {
  switch (operationType) {
    case "create_artboard":
      return "added a frame";
    case "update_artboard":
      return "edited a frame";
    case "create_variant":
      return "created a variant";
    case "add_element":
      return "added an element";
    case "update_element":
      return "edited an element";
    case "delete_element":
      return "deleted an element";
    case "move_resize_element":
      return "moved or resized an element";
    case "group_elements":
      return "grouped elements";
    case "add_connector":
      return "added a connector";
    case "update_connector":
      return "edited a connector";
    case "delete_connector":
      return "removed a connector";
    case "delete_artboard":
      return "deleted a frame";
    case "apply_layout":
      return "arranged the layout";
    default:
      return "edited the board";
  }
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function readRoute(): RouteState | null {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "home") return { view: "home" };
  if (hash.startsWith("board=")) {
    const boardId = decodeURIComponent(hash.slice("board=".length));
    return boardId ? { view: "board", boardId } : null;
  }
  return null;
}

function writeRoute(route: RouteState, mode: RouteMode): void {
  if (mode === "none") return;
  const hash = routeHash(route);
  const nextUrl = `${window.location.pathname}${window.location.search}${hash}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === nextUrl) return;
  if (mode === "replace") {
    window.history.replaceState(null, "", nextUrl);
    return;
  }
  window.history.pushState(null, "", nextUrl);
}

function routeHash(route: RouteState): string {
  return route.view === "home" ? "#home" : `#board=${encodeURIComponent(route.boardId)}`;
}

function shouldConnectLiveSocket(health: ApiHealth | null): boolean {
  if (!health || health.cloudStore === "browser-local") return false;
  return isLocalBrowserHost() || Boolean(import.meta.env.VITE_POWERBOARD_WS_URL);
}

function liveSocketUrl(boardId: string): string | null {
  const explicit = import.meta.env.VITE_POWERBOARD_WS_URL?.trim();
  if (explicit) {
    const base = explicit.endsWith("/ws") ? explicit : `${explicit.replace(/\/$/, "")}/ws`;
    return `${base}?boardId=${encodeURIComponent(boardId)}`;
  }
  if (!isLocalBrowserHost()) return null;
  return `ws://127.0.0.1:4318/ws?boardId=${encodeURIComponent(boardId)}`;
}

function isLocalBrowserHost(): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
}

function isCloudBacked(health: ApiHealth | null): boolean {
  const value = health?.cloudStore;
  return Boolean(value && !["browser-local", "local-files", "local-files (cloud unavailable)"].includes(value));
}

function storageLabel(health: ApiHealth | null): string {
  const value = health?.cloudStore;
  if (!value) return "Checking storage";
  if (value === "supabase-postgres" && health?.storageMode === "cloud") return "Cloud direct";
  if (value === "supabase-postgres") return "Supabase cloud";
  if (value === "browser-local") return "Browser local";
  if (value === "local-files") return "Local files";
  return value;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function materialIconGlyph(name: string): React.ReactNode {
  switch (name.trim().toLowerCase().replace(/[\s-]+/g, "_")) {
    case "check":
    case "check_circle":
      return <path d="M9.2 16.4 4.8 12l1.5-1.5 2.9 2.9 8.5-8.5L19.2 6z" />;
    case "close":
    case "cancel":
      return <path d="m6.4 19-1.4-1.4 5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6z" />;
    case "search":
      return <path d="m19 20.4-5.7-5.7a7 7 0 1 1 1.4-1.4l5.7 5.7zM9.5 14a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9" />;
    case "home":
      return <path d="M4 20V9.8L12 4l8 5.8V20h-6v-6h-4v6z" />;
    case "settings":
      return <path d="m10.8 21-.4-3a6 6 0 0 1-1.4-.6l-2.4 1.8-1.8-3 2.8-1.2a6 6 0 0 1 0-1.8L4.8 12l1.8-3L9 10.8q.7-.4 1.4-.6l.4-3h3.4l.4 3q.7.2 1.4.6L18.4 9l1.8 3-2.8 1.2a6 6 0 0 1 0 1.8l2.8 1.2-1.8 3-2.4-1.8q-.7.4-1.4.6l-.4 3zm1.7-5.2a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6" />;
    case "arrow_forward":
      return <path d="m14 19-1.4-1.4 4.6-4.6H4v-2h13.2l-4.6-4.6L14 5l7 7z" />;
    case "trending_up":
      return <path d="m3.8 17.2-1.4-1.4 6.4-6.4 4 4L19.2 7H15V5h7v7h-2V8.4l-7.2 7.2-4-4z" />;
    case "credit_card":
    case "payments":
      return <path d="M4 19q-.8 0-1.4-.6T2 17V7q0-.8.6-1.4T4 5h16q.8 0 1.4.6T22 7v10q0 .8-.6 1.4T20 19zm0-10h16V7H4zm0 4v4h16v-4z" />;
    case "more_horiz":
      return <path d="M5 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4m7 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4m7 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4" />;
    case "person":
    case "account_circle":
      return <path d="M12 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8M4 21v-2q0-2.1 2.1-3.3T12 14.5t5.9 1.2T20 19v2z" />;
    case "add":
    case "add_circle":
    default:
      return <path d="M11 20v-7H4v-2h7V4h2v7h7v2h-7v7z" />;
  }
}

function linePrimitivePoints(direction: string): { x1: number; y1: number; x2: number; y2: number } {
  if (direction === "vertical") return { x1: 50, y1: 6, x2: 50, y2: 94 };
  if (direction === "diagonal-down") return { x1: 6, y1: 6, x2: 94, y2: 94 };
  if (direction === "diagonal-up") return { x1: 6, y1: 94, x2: 94, y2: 6 };
  return { x1: 6, y1: 50, x2: 94, y2: 50 };
}

function sparklinePoints(values: number[], width: number, height: number, padding: number): string {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - padding * 2);
  return values
    .map((value, index) => {
      const x = padding + (values.length === 1 ? usableWidth / 2 : (index / (values.length - 1)) * usableWidth);
      const y = padding + (1 - (value - min) / range) * usableHeight;
      return `${roundForSvg(x)},${roundForSvg(y)}`;
    })
    .join(" ");
}

function readStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;
}

function readNumberArray(value: unknown, fallback: number[]): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : fallback;
}

function parseNumberList(value: string): number[] {
  return value
    .split(/[\s,]+/)
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part));
}

function formatNumberList(values: number[]): string {
  return values.map((value) => String(value)).join(", ");
}

function roundForSvg(value: number): number {
  return Math.round(value * 10) / 10;
}

function labelFor(value: string): string {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function normalizeColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#ffffff";
}

function toggleSelection(selection: string[], id: string): string[] {
  return selection.includes(id) ? selection.filter((candidate) => candidate !== id) : [...selection, id];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function boundsEqual(a: Pick<BoardElement | Artboard, "x" | "y" | "width" | "height">, b: Pick<BoardElement | Artboard, "x" | "y" | "width" | "height">): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
}

function normalizeWheelDeltas(event: WheelEvent): { x: number; y: number } {
  return {
    x: normalizeWheelDelta(event.deltaX, event.deltaMode),
    y: normalizeWheelDelta(event.deltaY, event.deltaMode)
  };
}

function normalizeWheelDelta(delta: number, deltaMode: number): number {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return delta * 16;
  }
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return delta * window.innerHeight;
  }
  return delta;
}

function normalizeCameraNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function capturePointer(element: Element, pointerId: number) {
  if (!(element instanceof HTMLElement)) return;
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Pointer capture is a best-effort interaction polish.
  }
}

function uniqueElementName(project: BoardProject, artboardId: string, baseName: string): string {
  const names = new Set(project.elements.filter((element) => element.artboardId === artboardId).map((element) => element.name));
  if (!names.has(baseName)) return baseName;
  let index = 2;
  while (names.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
}

function uniqueArtboardName(project: BoardProject, baseName: string): string {
  const names = new Set(project.artboards.map((artboard) => artboard.name));
  if (!names.has(baseName)) return baseName;
  let index = 2;
  while (names.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
}

function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function boundsContain(outer: Bounds, inner: Bounds): boolean {
  // Marquee selects anything it substantially overlaps (not full containment) — feels right for canvases.
  const overlapX = Math.max(0, Math.min(outer.x + outer.width, inner.x + inner.width) - Math.max(outer.x, inner.x));
  const overlapY = Math.max(0, Math.min(outer.y + outer.height, inner.y + inner.height) - Math.max(outer.y, inner.y));
  const overlapArea = overlapX * overlapY;
  const innerArea = Math.max(1, inner.width * inner.height);
  return overlapArea / innerArea > 0.5;
}

function round2(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // Ignore storage failures; default below.
  }
  return "light";
}

function groupNameForSelection(project: BoardProject, artboardId: string, elements: BoardElement[]): string {
  const artboard = project.artboards.find((candidate) => candidate.id === artboardId);
  const prefix = artboard?.name ?? "Frame";
  const sorted = [...elements].sort((a, b) => a.y - b.y || a.x - b.x);
  const names = sorted.slice(0, 2).map((element) => compactName(element.name));
  const suffix = names.length > 1 ? `${names.join(" + ")} Group` : `${names[0] ?? "Selection"} Group`;
  return `${prefix} / ${suffix}`;
}

function compactName(name: string): string {
  const parts = name.split(" / ");
  return parts[parts.length - 1] ?? name;
}

function elementPath(project: BoardProject, element: BoardElement): string {
  const artboard = project.artboards.find((candidate) => candidate.id === element.artboardId);
  const ancestors: string[] = [];
  let parentId = element.parentId;
  while (parentId) {
    const parent = project.elements.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    ancestors.unshift(parent.name);
    parentId = parent.parentId;
  }
  return [artboard?.name, ...ancestors, element.name].filter(Boolean).join(" > ");
}

function selectedElementRoots(project: BoardProject, selection: string[]): BoardElement[] {
  const selected = new Set(selection);
  return project.elements.filter((element) => selected.has(element.id) && !hasSelectedAncestor(project, element, selected));
}

function hasSelectedAncestor(project: BoardProject, element: BoardElement, selected: Set<string>): boolean {
  let parentId = element.parentId;
  while (parentId) {
    if (selected.has(parentId)) return true;
    parentId = project.elements.find((candidate) => candidate.id === parentId)?.parentId ?? null;
  }
  return false;
}

function elementDescendants(project: BoardProject, elementId: string): BoardElement[] {
  const children = project.elements.filter((element) => element.parentId === elementId);
  return children.flatMap((child) => [child, ...elementDescendants(project, child.id)]);
}

function boundsForProject(project: BoardProject): Bounds | null {
  return unionBounds(project.artboards.filter((artboard) => artboard.visible).map(artboardWorldBounds));
}

function nextArtboardPosition(project: BoardProject, activeArtboard: Artboard | null): { x: number; y: number } {
  if (project.artboards.length === 0) return { x: 120, y: 96 };
  const rightEdge = Math.max(...project.artboards.map((artboard) => artboard.x + artboard.width));
  return {
    x: rightEdge + 180,
    y: activeArtboard?.y ?? Math.min(...project.artboards.map((artboard) => artboard.y))
  };
}

function boundsForSelection(project: BoardProject, selection: string[]): Bounds | null {
  const bounds = selection
    .map((id) => {
      const artboard = project.artboards.find((candidate) => candidate.id === id);
      if (artboard) return artboardWorldBounds(artboard);
      const element = project.elements.find((candidate) => candidate.id === id);
      if (element) return elementWorldBounds(project, element);
      return null;
    })
    .filter((bound): bound is Bounds => Boolean(bound));
  return unionBounds(bounds);
}

function artboardWorldBounds(artboard: Artboard): Bounds {
  return {
    x: CANVAS_ORIGIN_X + artboard.x,
    y: CANVAS_ORIGIN_Y + artboard.y,
    width: artboard.width,
    height: artboard.height
  };
}

function elementWorldBounds(project: BoardProject, element: BoardElement): Bounds | null {
  const artboard = project.artboards.find((candidate) => candidate.id === element.artboardId);
  if (!artboard) return null;
  let x = CANVAS_ORIGIN_X + artboard.x + element.x;
  let y = CANVAS_ORIGIN_Y + artboard.y + element.y;
  let parentId = element.parentId;
  while (parentId) {
    const parent = project.elements.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    x += parent.x;
    y += parent.y;
    parentId = parent.parentId;
  }
  return { x, y, width: element.width, height: element.height };
}

function unionBounds(bounds: Bounds[]): Bounds | null {
  if (!bounds.length) return null;
  const left = Math.min(...bounds.map((bound) => bound.x));
  const top = Math.min(...bounds.map((bound) => bound.y));
  const right = Math.max(...bounds.map((bound) => bound.x + bound.width));
  const bottom = Math.max(...bounds.map((bound) => bound.y + bound.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
