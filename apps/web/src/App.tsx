import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BoxSelect,
  BringToFront,
  ChevronDown,
  ChevronRight,
  Component,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  FileText,
  Focus,
  Frame,
  Group,
  Home,
  Image as ImageIcon,
  Layers3,
  Lock,
  LockOpen,
  Maximize2,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo2,
  Save,
  Send,
  Smartphone,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type { Artboard, BoardElement, BoardOperation, BoardProject } from "@powerboard/schema";
import { createElementFromPreset, createId, DEVICE_PRESETS } from "@powerboard/schema";
import {
  applyOperation,
  createBoard,
  exportPng,
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
import { cameraTransform, panCamera, zoomCameraAroundPoint, type Camera, type ViewportPoint } from "./canvasCamera";

const componentTypes: BoardElement["type"][] = [
  "button",
  "card",
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

type DragState = {
  id: string;
  target: "element" | "artboard";
  mode: "move" | "resize";
  startX: number;
  startY: number;
  original: Pick<BoardElement | Artboard, "x" | "y" | "width" | "height">;
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

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const INITIAL_ZOOM = 0.72;
const BUTTON_ZOOM_FACTOR = 1.16;
const WHEEL_ZOOM_SENSITIVITY = 0.00125;
const MAX_WHEEL_ZOOM_DELTA = 32;
const GESTURE_ZOOM_DAMPING = 0.42;
const GESTURE_WHEEL_SUPPRESSION_MS = 260;
const MAX_INPUT_ZOOM_FACTOR = 1.04;
const CANVAS_WIDTH = 80000;
const CANVAS_HEIGHT = 56000;
const CANVAS_ORIGIN_X = 24000;
const CANVAS_ORIGIN_Y = 16000;

type RouteState = { view: "home" } | { view: "board"; boardId: string };
type RouteMode = "push" | "replace" | "none";
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
  const [homeOpen, setHomeOpen] = useState(false);
  const [storageStatus, setStorageStatus] = useState<ApiHealth | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [presetId, setPresetId] = useState(DEVICE_PRESETS[0]!.id);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pan, setPan] = useState<PanState | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [status, setStatus] = useState("Starting workspace...");
  const [collapsedPanels, setCollapsedPanels] = useState<Record<string, boolean>>({});
  const [leftPaneOpen, setLeftPaneOpen] = useState(true);
  const [rightPaneOpen, setRightPaneOpen] = useState(true);
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
  const navigationSeqRef = useRef(0);
  const routeViewRef = useRef<{ homeOpen: boolean; projectId: string | null }>({ homeOpen: false, projectId: null });

  useEffect(() => {
    return () => {
      if (zoomStateFrameRef.current !== null) {
        window.cancelAnimationFrame(zoomStateFrameRef.current);
      }
    };
  }, []);

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        setSpaceDown(true);
      }
      if (!(event.metaKey || event.ctrlKey)) return;
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
        zoomAtViewportCenter(INITIAL_ZOOM);
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
    if (!project || homeOpen) return;
    const ws = new WebSocket(`ws://127.0.0.1:4318/ws?boardId=${project.id}`);
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type?: string; project?: BoardProject; selection?: string[] };
      if (message.type === "board.changed" && message.project) {
        setProject(message.project);
        setSelectedIds(message.project.selection);
        rememberBoard(message.project);
      }
      if (message.type === "selection.changed" && message.selection) {
        setSelectedIds(message.selection);
      }
    };
    return () => ws.close();
  }, [project?.id, homeOpen]);

  const elementIndexes = useMemo(() => (project ? buildElementIndexes(project) : EMPTY_ELEMENT_INDEXES), [project]);

  const selectedElement = useMemo(() => {
    if (!project || selectedIds.length !== 1) return null;
    return project.elements.find((element) => element.id === selectedIds[0]) ?? null;
  }, [project, selectedIds]);

  const selectedArtboard = useMemo(() => {
    if (!project || selectedIds.length !== 1) return null;
    return project.artboards.find((artboard) => artboard.id === selectedIds[0]) ?? null;
  }, [project, selectedIds]);

  const activeArtboard = useMemo(() => {
    if (!project) return null;
    const selectedArtboardId =
      selectedArtboard?.id ??
      selectedElement?.artboardId ??
      selectedIds.map((id) => project.elements.find((element) => element.id === id)?.artboardId).find(Boolean);
    return project.artboards.find((artboard) => artboard.id === selectedArtboardId) ?? project.artboards[0] ?? null;
  }, [project, selectedArtboard, selectedElement, selectedIds]);

  function rememberBoard(nextProject: BoardProject) {
    setBoardPreviews((current) => ({ ...current, [nextProject.id]: nextProject }));
    setBoardSummaries((current) => upsertBoardSummary(current, nextProject));
  }

  async function refreshBoards(): Promise<BoardSummary[]> {
    const boards = await listBoards();
    setBoardSummaries(boards);
    const previews = await Promise.all(
      boards.map(async (board) => {
        try {
          return [board.id, await readBoard(board.id)] as const;
        } catch {
          return null;
        }
      })
    );
    setBoardPreviews((current) => {
      const next = { ...current };
      for (const preview of previews) {
        if (preview) next[preview[0]] = preview[1];
      }
      return next;
    });
    return boards;
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
      setDrag(null);
      setPan(null);
      setProject(next);
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
    const name = window.prompt("Board name", "Untitled PowerBoard Board");
    if (name === null) return;
    const seq = beginNavigation();
    try {
      const next = await createBoard(name.trim() || "Untitled PowerBoard Board");
      if (!isCurrentNavigation(seq)) return;
      initialViewportPositionedRef.current = false;
      setProject(next);
      setSelectedIds(next.selection);
      setHomeOpen(false);
      rememberBoard(next);
      writeRoute({ view: "board", boardId: next.id }, "push");
      setStatus(`Created ${next.name}`);
    } catch (error) {
      if (!isCurrentNavigation(seq)) return;
      setStatus(error instanceof Error ? error.message : "Could not create board");
    }
  }

  async function showHome(routeMode: RouteMode = "push") {
    const seq = beginNavigation();
    setDrag(null);
    setPan(null);
    setHomeOpen(true);
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
      const first = routeBoard ?? (boards[0] ? await readBoard(boards[0].id) : await createBoard("PowerBoard App Mockups"));
      if (!isCurrentNavigation(seq)) return;
      setProject(first);
      setSelectedIds(first.selection);
      rememberBoard(first);
      if (route?.view === "board" && routeBoard) {
        setHomeOpen(false);
        setStatus(`Opened ${first.name}`);
      } else {
        setHomeOpen(true);
        writeRoute({ view: "home" }, "replace");
        setStatus("Boards");
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
    if (!project) return;
    try {
      const next = await applyOperation(project.id, operation);
      setProject(next);
      setSelectedIds(next.selection);
      rememberBoard(next);
      setStatus("Saved");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Operation failed");
    }
  }

  async function select(ids: string[], additive = false) {
    if (!project) return;
    const nextSelection = additive ? toggleSelection(selectedIds, ids[0]!) : ids;
    setSelectedIds(nextSelection);
    await postSelection(project.id, nextSelection).catch(() => undefined);
  }

  function updateLocalElement(id: string, patch: Partial<BoardElement>) {
    setProject((current) => {
      if (!current) return current;
      return {
        ...current,
        elements: current.elements.map((element) => (element.id === id ? { ...element, ...patch } : element))
      };
    });
  }

  function updateLocalArtboard(id: string, patch: Partial<Artboard>) {
    setProject((current) => {
      if (!current) return current;
      return {
        ...current,
        artboards: current.artboards.map((artboard) => (artboard.id === id ? { ...artboard, ...patch } : artboard))
      };
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
    if (!drag || !project) return;
    const currentZoom = cameraRef.current.zoom;
    const dx = (event.clientX - drag.startX) / currentZoom;
    const dy = (event.clientY - drag.startY) / currentZoom;
    const minSize = drag.target === "artboard" ? 120 : 24;
    const patch =
      drag.mode === "move"
        ? { x: Math.round(drag.original.x + dx), y: Math.round(drag.original.y + dy) }
        : {
            width: Math.max(minSize, Math.round(drag.original.width + dx)),
            height: Math.max(minSize, Math.round(drag.original.height + dy))
          };
    if (drag.target === "artboard") {
      updateLocalArtboard(drag.id, patch);
      return;
    }
    if (drag.mode === "move") {
      updateLocalElement(drag.id, patch);
    } else {
      updateLocalElement(drag.id, patch);
    }
  }

  async function onCanvasPointerUp() {
    if (pan) {
      setPan(null);
      return;
    }
    if (!drag || !project) return;
    const element = drag.target === "element" ? project.elements.find((candidate) => candidate.id === drag.id) : undefined;
    const artboard = drag.target === "artboard" ? project.artboards.find((candidate) => candidate.id === drag.id) : undefined;
    setDrag(null);
    if (element) {
      await runOperation({
        type: "move_resize_element",
        elementId: element.id,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height
      });
      return;
    }
    if (artboard) {
      await runOperation({
        type: "update_artboard",
        artboardId: artboard.id,
        patch: { x: artboard.x, y: artboard.y, width: artboard.width, height: artboard.height }
      });
    }
  }

  async function addArtboard() {
    if (!project) return;
    const preset = DEVICE_PRESETS.find((candidate) => candidate.id === presetId) ?? DEVICE_PRESETS[0]!;
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
      locked: false,
      visible: true
    };
    await runOperation({ type: "create_artboard", artboard });
  }

  async function addComponent(type: BoardElement["type"]) {
    if (!project || !activeArtboard) {
      setStatus("Select a frame before adding a component");
      return;
    }
    const element = createElementFromPreset(type, activeArtboard.id, 28 + selectedIds.length * 12, 120 + selectedIds.length * 12);
    element.name = uniqueElementName(project, activeArtboard.id, `${activeArtboard.name} / ${labelFor(type)}`);
    element.zIndex = Math.max(0, ...project.elements.filter((candidate) => candidate.artboardId === activeArtboard.id).map((candidate) => candidate.zIndex)) + 1;
    await runOperation({ type: "add_element", element });
  }

  async function updateSelectedElement(patch: Record<string, unknown>) {
    if (!selectedElement) return;
    await runOperation({ type: "update_element", elementId: selectedElement.id, patch });
  }

  async function deleteSelection() {
    if (!project) return;
    const elementIds = selectedIds.filter((id) => project.elements.some((element) => element.id === id));
    if (!elementIds.length) {
      setStatus("Select one or more elements to delete");
      return;
    }
    for (const elementId of elementIds) {
      await runOperation({ type: "delete_element", elementId });
    }
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

    let nextProject = project;
    for (const element of clonedElements) {
      nextProject = await applyOperation(nextProject.id, { type: "add_element", element });
    }
    setProject(nextProject);
    rememberBoard(nextProject);
    const nextSelection = rootElements.map((element) => idMap.get(element.id)!).filter(Boolean);
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
        label: "Flow",
        style: { stroke: "#2563EB" }
      }
    });
  }

  async function uploadImage(kind: "image" | "screenshot", file: File) {
    if (!project || !activeArtboard) return;
    const result = await uploadAsset(project.id, file);
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
    await applyOperation(project.id, { type: "add_element", element }).then((next) => {
      setProject(next);
      setSelectedIds(next.selection);
      rememberBoard(next);
      setStatus(kind === "screenshot" ? "Screenshot overlay imported" : "Image added");
    });
  }

  async function exportSelectedPng() {
    if (!project) return;
    const artboardId = selectedArtboard?.id ?? activeArtboard?.id;
    if (!artboardId) {
      setStatus("Select a frame or element before exporting PNG");
      return;
    }
    try {
      const result = await exportPng(project.id, artboardId);
      setStatus(`PNG exported: ${result.filePath}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "PNG export failed");
    }
  }

  async function exportCode() {
    if (!project) return;
    try {
      const result = await exportReactTailwind(project.id);
      setStatus(`React + Tailwind exported: ${result.dir}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "React export failed");
    }
  }

  async function exportImplementationSpec() {
    if (!project) return;
    try {
      const result = await exportSpec(project.id);
      setStatus(`Spec exported: ${result.markdownPath}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Spec export failed");
    }
  }

  async function undoBoard() {
    if (!project) return;
    try {
      const next = await undo(project.id);
      setProject(next);
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
      const next = await redo(project.id);
      setProject(next);
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

  function toggleLeftPane() {
    setLeftPaneOpen((current) => {
      setStatus(current ? "Left pane hidden" : "Left pane shown");
      return !current;
    });
  }

  function toggleRightPane() {
    setRightPaneOpen((current) => {
      setStatus(current ? "Right pane hidden" : "Right pane shown");
      return !current;
    });
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

  if (!project) {
    return (
      <main className="loading-shell">
        <div className="loading-mark">PB</div>
        <p>{status}</p>
      </main>
    );
  }

  return (
    <main className={classNames("app-shell", homeOpen && "home-mode", !leftPaneOpen && "left-pane-hidden", !rightPaneOpen && "right-pane-hidden")} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp}>
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">PB</div>
          <div>
            <h1>PowerBoard</h1>
            <p>the agent-native design board</p>
          </div>
        </div>

        <div className="toolbar-group workspace-nav" aria-label="Workspace navigation">
          <a className={classNames("nav-button", homeOpen && "active")} href={routeHash({ view: "home" })} aria-current={homeOpen ? "page" : undefined}>
            <Home size={16} /> Boards
          </a>
        </div>

        {!homeOpen ? (
          <>
            <div className="toolbar-group pane-controls" aria-label="Pane visibility">
              <IconButton label={leftPaneOpen ? "Hide left pane" : "Show left pane"} active={leftPaneOpen} onClick={toggleLeftPane}>
                {leftPaneOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
              </IconButton>
              <IconButton label={rightPaneOpen ? "Hide right pane" : "Show right pane"} active={rightPaneOpen} onClick={toggleRightPane}>
                {rightPaneOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              </IconButton>
            </div>

            <div className="toolbar-group" aria-label="Canvas tools">
              <IconButton label="Select" active onClick={() => setStatus("Select tool active")}>
                <MousePointer2 size={18} />
              </IconButton>
              <IconButton label="Undo" onClick={undoBoard}>
                <Undo2 size={18} />
              </IconButton>
              <IconButton label="Redo" onClick={redoBoard}>
                <Redo2 size={18} />
              </IconButton>
              <IconButton label="Group" onClick={groupSelection} disabled={selectedIds.length < 2}>
                <Group size={18} />
              </IconButton>
              <IconButton label="Duplicate" onClick={duplicateSelection} disabled={!selectedIds.length}>
                <Copy size={18} />
              </IconButton>
              <IconButton label="Delete" onClick={deleteSelection} disabled={!selectedIds.some((id) => project.elements.some((element) => element.id === id))}>
                <Trash2 size={18} />
              </IconButton>
            </div>

            <div className="toolbar-group artboard-control">
              <Smartphone size={16} />
              <select aria-label="Frame preset" value={presetId} onChange={(event) => setPresetId(event.target.value)}>
                {DEVICE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name} · {preset.width}x{preset.height}
                  </option>
                ))}
              </select>
              <button className="text-button" onClick={addArtboard}>
                <Plus size={16} /> Frame
              </button>
            </div>

            <div className="toolbar-spacer" />

            <div className="toolbar-group">
              <IconButton label="Focus selection" onClick={focusSelection} disabled={!selectedIds.length}>
                <Focus size={18} />
              </IconButton>
              <IconButton label="Fit all" onClick={fitAll}>
                <Maximize2 size={18} />
              </IconButton>
              <IconButton label="Zoom out" onClick={() => zoomAtViewportCenter(cameraRef.current.zoom / BUTTON_ZOOM_FACTOR)}>
                <ZoomOut size={18} />
              </IconButton>
              <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
              <IconButton label="Zoom in" onClick={() => zoomAtViewportCenter(cameraRef.current.zoom * BUTTON_ZOOM_FACTOR)}>
                <ZoomIn size={18} />
              </IconButton>
            </div>

            <div className="toolbar-group">
              <IconButton label="Export PNG" onClick={exportSelectedPng}>
                <Download size={18} />
              </IconButton>
              <IconButton label="Export spec" onClick={exportImplementationSpec}>
                <FileText size={18} />
              </IconButton>
              <IconButton label="Export React Tailwind" onClick={exportCode}>
                <FileCode2 size={18} />
              </IconButton>
            </div>
          </>
        ) : (
          <div className="toolbar-spacer" />
        )}
      </header>

      {homeOpen ? (
        <HomeView boards={boardSummaries} previews={boardPreviews} storageStatus={storageStatus} onOpen={openBoard} onCreate={createNewBoard} />
      ) : (
        <>
      {leftPaneOpen ? (
        <aside className="left-panel">
        <CollapsiblePanel id="app-kit" icon={<Component size={16} />} title="App Kit" collapsed={Boolean(collapsedPanels["app-kit"])} onToggle={togglePanel}>
          <div className="component-grid">
            {componentTypes.map((type) => (
              <button key={type} onClick={() => addComponent(type)}>
                {labelFor(type)}
              </button>
            ))}
          </div>
        </CollapsiblePanel>

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

        <CollapsiblePanel id="layers" icon={<Layers3 size={16} />} title="Layers" className="layers-section" collapsed={Boolean(collapsedPanels.layers)} onToggle={togglePanel}>
          <div className="layers-list">
            {project.artboards.map((artboard) => (
              <div key={artboard.id} className="layer-group">
                <button className={selectedIds.includes(artboard.id) ? "layer-row selected" : "layer-row"} onClick={(event) => select([artboard.id], event.shiftKey)}>
                  <Frame size={13} />
                  <span>{artboard.name}</span>
                  <small>{artboard.id}</small>
                </button>
                {(elementIndexes.layerRootsByArtboard.get(artboard.id) ?? []).map((element) => (
                  <LayerNode
                    key={element.id}
                    element={element}
                    project={project}
                    indexes={elementIndexes}
                    depth={0}
                    selectedIds={selectedIds}
                    onSelect={select}
                    onUpdate={(elementId, patch) => runOperation({ type: "update_element", elementId, patch })}
                  />
                ))}
              </div>
            ))}
          </div>
        </CollapsiblePanel>
        </aside>
      ) : null}

      <section
        ref={viewportRef}
        className={classNames("canvas-viewport", pan && "panning", spaceDown && "space-pan")}
        onPointerDownCapture={onCanvasPointerDownCapture}
        onPointerMove={rememberViewportPointFromReact}
        onPointerDown={() => select([])}
      >
        <div className="canvas-space">
          <div ref={canvasPlaneRef} className="canvas-plane" style={{ transform: cameraTransform(cameraRef.current), width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}>
            <div className="canvas-grid" />
            <ConnectorLayer project={project} selectedIds={selectedIds} />
            {project.artboards
              .filter((artboard) => artboard.visible)
              .map((artboard) => (
                <ArtboardView
                  key={artboard.id}
                  artboard={artboard}
                  project={project}
                  indexes={elementIndexes}
                  selectedIds={selectedIds}
                  onSelect={(ids, additive) => select(ids, additive)}
                  onDragStart={(state) => setDrag(state)}
                />
              ))}
          </div>
        </div>
      </section>

      {rightPaneOpen ? (
        <aside className="right-panel">
        <CollapsiblePanel id="inspector" icon={<Save size={16} />} title="Inspector" collapsed={Boolean(collapsedPanels.inspector)} onToggle={togglePanel}>
          {selectedIds.length > 1 ? (
            <SelectionInspector project={project} selectedIds={selectedIds} onFocus={focusSelection} onGroup={groupSelection} onDuplicate={duplicateSelection} onDelete={deleteSelection} />
          ) : selectedElement ? (
            <ElementInspector project={project} element={selectedElement} onChange={updateSelectedElement} onReorder={(delta) => updateSelectedElement({ zIndex: selectedElement.zIndex + delta })} />
          ) : selectedArtboard ? (
            <ArtboardInspector artboard={selectedArtboard} onChange={updateArtboard} />
          ) : (
            <div className="empty-inspector">
              <MousePointer2 size={22} />
              <p>Select a frame or element.</p>
            </div>
          )}
        </CollapsiblePanel>

        <CollapsiblePanel id="flows" icon={<Send size={16} />} title="Flows" collapsed={Boolean(collapsedPanels.flows)} onToggle={togglePanel}>
          <button className="wide-action" onClick={connectArtboards}>
            <ArrowRight size={16} /> Connect screens
          </button>
          <div className="flow-list">
            {project.connectors.length ? (
              project.connectors.map((connector) => {
                const from = project.artboards.find((artboard) => artboard.id === connector.fromArtboardId)?.name ?? connector.fromArtboardId;
                const to = project.artboards.find((artboard) => artboard.id === connector.toArtboardId)?.name ?? connector.toArtboardId;
                return (
                  <div key={connector.id} className="flow-row">
                    <span>{from}</span>
                    <ArrowRight size={14} />
                    <span>{to}</span>
                  </div>
                );
              })
            ) : (
              <p className="muted">No flows yet.</p>
            )}
          </div>
        </CollapsiblePanel>
        </aside>
      ) : null}

        </>
      )}

      <footer className="statusbar">{status}</footer>
    </main>
  );
}

function HomeView({
  boards,
  previews,
  storageStatus,
  onOpen,
  onCreate
}: {
  boards: BoardSummary[];
  previews: Record<string, BoardProject>;
  storageStatus: ApiHealth | null;
  onOpen: (boardId: string) => void;
  onCreate: () => void;
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
          <button className="text-button home-create" onClick={() => onCreate()}>
            <Plus size={16} /> New board
          </button>
        </div>

        {boards.length ? (
          <div className="board-card-grid">
            {boards.map((board) => {
              const preview = previews[board.id];
              const frames = preview?.artboards ?? [];
              return (
                <article
                  key={board.id}
                  className="board-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(board.id)}
                  onKeyDown={(event) => {
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
                    {!frames.length ? <span className="frame-chip empty">No frames</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="home-empty">
            <Frame size={28} />
            <h3>No boards yet</h3>
            <button className="wide-action" onClick={() => onCreate()}>
              <Plus size={16} /> New board
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function LayerNode({
  element,
  project,
  indexes,
  depth,
  selectedIds,
  onSelect,
  onUpdate
}: {
  element: BoardElement;
  project: BoardProject;
  indexes: ElementIndexes;
  depth: number;
  selectedIds: string[];
  onSelect: (ids: string[], additive?: boolean) => void;
  onUpdate: (elementId: string, patch: Record<string, unknown>) => void;
}) {
  const children = indexes.layerChildrenByParent.get(element.id) ?? [];
  return (
    <>
      <div className={selectedIds.includes(element.id) ? "layer-row selected element-layer" : "layer-row element-layer"} style={{ "--indent": `${depth * 12}px` } as React.CSSProperties}>
        <button onClick={(event) => onSelect([element.id], event.shiftKey)} title={`${element.name} · ${element.id}`}>
          {children.length ? <ChevronDown size={11} /> : <span className="layer-spacer" />}
          <span>{element.name}</span>
          <small>{element.id}</small>
        </button>
        <button title={element.visible ? "Hide" : "Show"} onClick={() => onUpdate(element.id, { visible: !element.visible })}>
          {element.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        <button title={element.locked ? "Unlock" : "Lock"} onClick={() => onUpdate(element.id, { locked: !element.locked })}>
          {element.locked ? <Lock size={12} /> : <LockOpen size={12} />}
        </button>
      </div>
      {children.map((child) => (
        <LayerNode key={child.id} element={child} project={project} indexes={indexes} depth={depth + 1} selectedIds={selectedIds} onSelect={onSelect} onUpdate={onUpdate} />
      ))}
    </>
  );
}

function ArtboardView({
  artboard,
  project,
  indexes,
  selectedIds,
  onSelect,
  onDragStart
}: {
  artboard: Artboard;
  project: BoardProject;
  indexes: ElementIndexes;
  selectedIds: string[];
  onSelect: (ids: string[], additive?: boolean) => void;
  onDragStart: (state: DragState) => void;
}) {
  const elements = indexes.canvasRootsByArtboard.get(artboard.id) ?? [];
  const selectedElements = project.elements
    .filter((element) => selectedIds.includes(element.id) && element.artboardId === artboard.id && element.visible)
    .map((element) => ({ element, position: elementPositionInArtboard(element, project) }))
    .filter((item): item is { element: BoardElement; position: { x: number; y: number } } => Boolean(item.position));
  const selected = selectedIds.includes(artboard.id);
  return (
    <div
      className={selected ? "artboard-frame selected" : "artboard-frame"}
      style={{ left: CANVAS_ORIGIN_X + artboard.x, top: CANVAS_ORIGIN_Y + artboard.y, width: artboard.width, height: artboard.height }}
      data-board-artboard={artboard.id}
      data-board-name={artboard.name}
      title={`${artboard.name} · ${artboard.id}`}
    >
      <button
        className="artboard-label"
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelect([artboard.id], event.shiftKey);
          if (!artboard.locked && !event.shiftKey) {
            capturePointer(event.currentTarget, event.pointerId);
            onDragStart({ id: artboard.id, target: "artboard", mode: "move", startX: event.clientX, startY: event.clientY, original: artboard });
          }
        }}
      >
        <span>{artboard.name}</span>
        <small>{artboard.id}</small>
      </button>
      <div className="artboard-surface" style={{ background: artboard.background, borderRadius: artboard.type === "mobile" ? 42 : artboard.type === "tablet" ? 30 : 18 }} onPointerDown={(event) => (event.stopPropagation(), onSelect([artboard.id], event.shiftKey))}>
        {elements.map((element) => (
          <ElementView key={element.id} element={element} project={project} indexes={indexes} selectedIds={selectedIds} onSelect={onSelect} onDragStart={onDragStart} />
        ))}
      </div>
      {selectedElements.length ? (
        <div className="selection-badge-layer" aria-hidden="true">
          {selectedElements.map(({ element, position }) => (
            <span key={element.id} className="element-name-badge" style={{ left: position.x - 2, top: position.y - 24 }}>
              {element.name}
              <small>{element.id}</small>
            </span>
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
            onDragStart({ id: artboard.id, target: "artboard", mode: "resize", startX: event.clientX, startY: event.clientY, original: artboard });
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
  onSelect,
  onDragStart
}: {
  element: BoardElement;
  project: BoardProject;
  indexes: ElementIndexes;
  selectedIds: string[];
  onSelect: (ids: string[], additive?: boolean) => void;
  onDragStart: (state: DragState) => void;
}) {
  const selected = selectedIds.includes(element.id);
  const children = indexes.canvasChildrenByParent.get(element.id) ?? [];
  const selectedAncestor = children.some((child) => selectedIds.includes(child.id) || hasSelectedDescendant(child.id, project, selectedIds));
  const style = elementToStyle(element);
  const asset = typeof element.props.assetId === "string" ? project.assets.find((candidate) => candidate.id === element.props.assetId) : undefined;

  return (
    <div
      className={classNames("board-element", `kind-${element.type}`, selected && "selected", selectedAncestor && "selected-ancestor", element.locked && "locked")}
      style={style}
      data-board-element={element.id}
      data-board-name={element.name}
      title={`${element.name} · ${element.type} · ${element.id}`}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect([element.id], event.shiftKey);
        if (!element.locked && !event.shiftKey) {
          capturePointer(event.currentTarget, event.pointerId);
          onDragStart({ id: element.id, target: "element", mode: "move", startX: event.clientX, startY: event.clientY, original: element });
        }
      }}
    >
      <ElementContent element={element} assetSrc={asset?.src} />
      {children.map((child) => (
        <ElementView key={child.id} element={child} project={project} indexes={indexes} selectedIds={selectedIds} onSelect={onSelect} onDragStart={onDragStart} />
      ))}
      {selected && !element.locked ? (
        <button
          className="resize-handle"
          aria-label="Resize"
          onPointerDown={(event) => {
            event.stopPropagation();
            capturePointer(event.currentTarget, event.pointerId);
            onDragStart({ id: element.id, target: "element", mode: "resize", startX: event.clientX, startY: event.clientY, original: element });
          }}
        />
      ) : null}
    </div>
  );
}

function ElementContent({ element, assetSrc }: { element: BoardElement; assetSrc?: string }) {
  switch (element.type) {
    case "frame":
    case "group":
    case "rect":
      return null;
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
    case "image":
    case "screenshotOverlay":
      return assetSrc ? <img src={assetSrc} alt={readString(element.props.alt, element.name)} /> : <span>{element.type === "screenshotOverlay" ? "Screenshot overlay" : "Image"}</span>;
    default:
      return <span>{element.name}</span>;
  }
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

function ConnectorLayer({ project, selectedIds }: { project: BoardProject; selectedIds: string[] }) {
  return (
    <svg className="connector-layer" width={CANVAS_WIDTH} height={CANVAS_HEIGHT} viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}>
      <defs>
        <marker id="arrow-head" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#2563EB" />
        </marker>
      </defs>
      {project.connectors.map((connector) => {
        const from = project.artboards.find((artboard) => artboard.id === connector.fromArtboardId);
        const to = project.artboards.find((artboard) => artboard.id === connector.toArtboardId);
        if (!from || !to) return null;
        const x1 = CANVAS_ORIGIN_X + from.x + from.width;
        const y1 = CANVAS_ORIGIN_Y + from.y + from.height / 2;
        const x2 = CANVAS_ORIGIN_X + to.x;
        const y2 = CANVAS_ORIGIN_Y + to.y + to.height / 2;
        const mid = x1 + Math.max(80, (x2 - x1) / 2);
        const selected = selectedIds.includes(connector.id);
        return (
          <g key={connector.id} className={selected ? "connector selected" : "connector"}>
            <path d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`} stroke={String(connector.style.stroke ?? "#2563EB")} strokeWidth={selected ? 4 : 2.5} fill="none" markerEnd="url(#arrow-head)" />
            {connector.label ? (
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 10} textAnchor="middle">
                {connector.label}
              </text>
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
  onDelete
}: {
  project: BoardProject;
  selectedIds: string[];
  onFocus: () => void;
  onGroup: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
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
      <div className="selection-list">
        {selectedIds.map((id) => {
          const element = project.elements.find((candidate) => candidate.id === id);
          const artboard = project.artboards.find((candidate) => candidate.id === id);
          return (
            <div key={id} className="selection-row">
              <span>{element?.name ?? artboard?.name ?? id}</span>
              <small>{id}</small>
            </div>
          );
        })}
      </div>
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
  return (
    <div className="inspector-fields">
      <ReadOnlyField label="Identifier" value={element.id} />
      <ReadOnlyField label="Path" value={elementPath(project, element)} />
      <Field label="Name" value={element.name} onChange={(name) => onChange({ name })} />
      <Field label="Role" value={element.semanticRole ?? ""} onChange={(semanticRole) => onChange({ semanticRole })} />
      <div className="field-grid two-col">
        <NumberField label="X" value={element.x} min={-5000} max={5000} onChange={(x) => onChange({ x: Math.round(x) })} />
        <NumberField label="Y" value={element.y} min={-5000} max={5000} onChange={(y) => onChange({ y: Math.round(y) })} />
        <NumberField label="Width" value={element.width} min={12} max={3000} onChange={(width) => onChange({ width: Math.round(width) })} />
        <NumberField label="Height" value={element.height} min={12} max={3000} onChange={(height) => onChange({ height: Math.round(height) })} />
      </div>
      {"text" in element.props || ["button", "badge", "sticky", "text"].includes(element.type) ? <Field label="Text" value={readString(element.props.text, "")} onChange={(text) => onChange({ props: { text } })} /> : null}
      {"title" in element.props ? <Field label="Title" value={readString(element.props.title, "")} onChange={(title) => onChange({ props: { title } })} /> : null}
      {"subtitle" in element.props ? <Field label="Subtitle" value={readString(element.props.subtitle, "")} onChange={(subtitle) => onChange({ props: { subtitle } })} /> : null}
      {"body" in element.props ? <Field label="Body" value={readString(element.props.body, "")} onChange={(body) => onChange({ props: { body } })} /> : null}
      <ColorField label="Fill" value={element.style.fill ?? "#FFFFFF"} onChange={(fill) => onChange({ style: { fill } })} />
      <ColorField label="Text" value={element.style.color ?? "#111827"} onChange={(color) => onChange({ style: { color } })} />
      <NumberField label="Radius" value={element.style.radius ?? 0} min={0} max={80} onChange={(radius) => onChange({ style: { radius } })} />
      <NumberField label="Opacity" value={element.style.opacity ?? 1} min={0.1} max={1} step={0.05} onChange={(opacity) => onChange({ style: { opacity } })} />
      <NumberField label="Font" value={element.style.fontSize ?? 14} min={8} max={72} onChange={(fontSize) => onChange({ style: { fontSize } })} />
      <NumberField label="Layer" value={element.zIndex} min={0} max={999} onChange={(zIndex) => onChange({ zIndex: Math.round(zIndex) })} />
      <div className="segmented-row">
        <button onClick={() => onChange({ locked: !element.locked })}>{element.locked ? <Lock size={15} /> : <LockOpen size={15} />} {element.locked ? "Locked" : "Unlocked"}</button>
        <button onClick={() => onChange({ visible: !element.visible })}>{element.visible ? <Eye size={15} /> : <EyeOff size={15} />} {element.visible ? "Visible" : "Hidden"}</button>
      </div>
      <div className="segmented-row">
        <button onClick={() => onReorder(1)}>
          <BringToFront size={15} /> Forward
        </button>
        <button onClick={() => onReorder(-1)}>
          <Layers3 size={15} /> Back
        </button>
      </div>
    </div>
  );
}

function ArtboardInspector({ artboard, onChange }: { artboard: Artboard; onChange: (patch: Partial<Artboard>) => void }) {
  return (
    <div className="inspector-fields">
      <ReadOnlyField label="Identifier" value={artboard.id} />
      <Field label="Name" value={artboard.name} onChange={(name) => onChange({ name })} />
      <ColorField label="Background" value={artboard.background} onChange={(background) => onChange({ background })} />
      <div className="field-grid two-col">
        <NumberField label="X" value={artboard.x} min={-20000} max={20000} onChange={(x) => onChange({ x: Math.round(x) })} />
        <NumberField label="Y" value={artboard.y} min={-20000} max={20000} onChange={(y) => onChange({ y: Math.round(y) })} />
        <NumberField label="Width" value={artboard.width} min={240} max={2400} onChange={(width) => onChange({ width: Math.round(width) })} />
        <NumberField label="Height" value={artboard.height} min={240} max={2400} onChange={(height) => onChange({ height: Math.round(height) })} />
      </div>
      <div className="segmented-row">
        <button onClick={() => onChange({ locked: !artboard.locked })}>{artboard.locked ? <Lock size={15} /> : <LockOpen size={15} />} {artboard.locked ? "Locked" : "Unlocked"}</button>
        <button onClick={() => onChange({ visible: !artboard.visible })}>{artboard.visible ? <Eye size={15} /> : <EyeOff size={15} />} {artboard.visible ? "Visible" : "Hidden"}</button>
      </div>
      <p className="muted">{artboard.type} · {Math.round(artboard.width)} x {Math.round(artboard.height)}</p>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <label className="field readonly-field">
      <span>{label}</span>
      <input value={value} readOnly />
    </label>
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

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field color-field">
      <span>{label}</span>
      <input type="color" value={normalizeColor(value)} onChange={(event) => onChange(event.target.value)} />
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
      <input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
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
    <button className={active ? "icon-button active" : "icon-button"} onClick={onClick} title={label} aria-label={label} disabled={disabled}>
      {children}
    </button>
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
  return {
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    zIndex: element.zIndex,
    background: element.style.fill,
    color: element.style.color,
    borderColor: element.style.stroke,
    borderWidth: element.style.strokeWidth,
    borderStyle: element.style.stroke ? "solid" : undefined,
    borderRadius: element.style.radius,
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

function readStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;
}

function readNumberArray(value: unknown, fallback: number[]): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : fallback;
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
