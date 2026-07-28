import type { BoardConnector, BoardElement, BoardProject, BoardStyle, StrokeStyle } from "./index.js";

/**
 * Connector v2 geometry — shared by the live canvas (apps/web) and the SVG/PNG exporters
 * (packages/renderers) so routing looks identical everywhere. Pure math, no DOM.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type ConnectorPort = BoardConnector["fromPort"];
export type ConnectorRouting = BoardConnector["routing"];

export interface ConnectorGeometry {
  /** SVG path `d` for the connector spine. */
  d: string;
  start: Point;
  end: Point;
  /** Outgoing direction at the start, in radians (for arrowStart). */
  startAngle: number;
  /** Incoming direction at the end, in radians (for arrowEnd). */
  endAngle: number;
  /** Point along the spine for the label (labelPosition 0..1). */
  labelPoint: Point;
  /** Straight polyline through the spine — obstacle tests and label placement use this. */
  samples: Point[];
}

/** Where a connector meets a node when several connectors share the same side. */
export interface AnchorSlot {
  index: number;
  count: number;
}

export interface ConnectorGeometryContext {
  /** Node rects the spine should route around. Endpoint rects must not be included. */
  obstacles?: Rect[];
  /** Fan-out slot for the incoming (target) end, so converging edges don't stack. */
  toSlot?: AnchorSlot;
}

type Side = "n" | "s" | "e" | "w";

/** Distance a connector travels straight out of a node before it is allowed to turn. */
const STUB = 24;
/** Gap kept between a routed trunk and any node it steers around. */
const LANE_CLEARANCE = 20;
/** How far past the two endpoints a detour lane may sit before we give up and route straight. */
const MAX_DETOUR = 140;
/** Largest gap between fanned-out anchors on one side of a node. */
const ANCHOR_SPREAD = 40;
/** Default elbow softening — connectors may override with `cornerRadius`. */
export const CONNECTOR_CORNER_RADIUS = 10;

/**
 * Element types that occupy visual space a connector should route around. Text, ink and icons are
 * excluded on purpose: their boxes are usually far wider than their glyphs (agents give a heading
 * the full artboard width), so treating them as obstacles invents blockages that aren't there.
 */
const TRANSPARENT_TO_CONNECTORS = new Set<BoardElement["type"]>(["text", "line", "ink", "icon", "group", "screenshotOverlay"]);

export function portPoint(rect: Rect, port: ConnectorPort, towards: Point, slot?: AnchorSlot): { point: Point; side: Side } {
  const side: Side = port === "auto" ? autoSide(rect, towards) : port;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const horizontalSide = side === "n" || side === "s";
  const offset = slotOffset(slot, horizontalSide ? rect.width : rect.height);
  switch (side) {
    case "n":
      return { point: { x: cx + offset, y: rect.y }, side };
    case "s":
      return { point: { x: cx + offset, y: rect.y + rect.height }, side };
    case "w":
      return { point: { x: rect.x, y: cy + offset }, side };
    case "e":
      return { point: { x: rect.x + rect.width, y: cy + offset }, side };
  }
}

/** Even spread about the side's midpoint, capped so anchors never crowd a node's corners. */
function slotOffset(slot: AnchorSlot | undefined, sideLength: number): number {
  if (!slot || slot.count < 2) return 0;
  const step = Math.min(ANCHOR_SPREAD, (sideLength * 0.7) / slot.count);
  return (slot.index - (slot.count - 1) / 2) * step;
}

function autoSide(rect: Rect, towards: Point): Side {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  // Normalize by the rect's aspect so wide artboards still prefer e/w sensibly.
  if (Math.abs(dx) / Math.max(1, rect.width) >= Math.abs(dy) / Math.max(1, rect.height)) {
    return dx >= 0 ? "e" : "w";
  }
  return dy >= 0 ? "s" : "n";
}

function sideNormal(side: Side): Point {
  switch (side) {
    case "n":
      return { x: 0, y: -1 };
    case "s":
      return { x: 0, y: 1 };
    case "w":
      return { x: -1, y: 0 };
    case "e":
      return { x: 1, y: 0 };
  }
}

export function connectorGeometry(
  fromRect: Rect,
  toRect: Rect,
  options: Pick<BoardConnector, "fromPort" | "toPort" | "routing" | "waypoints" | "labelPosition"> & Partial<Pick<BoardConnector, "cornerRadius">>,
  context: ConnectorGeometryContext = {}
): ConnectorGeometry {
  const toCenter = center(toRect);
  const fromCenter = center(fromRect);
  const firstTarget = options.waypoints[0] ?? toCenter;
  const lastTarget = options.waypoints[options.waypoints.length - 1] ?? fromCenter;
  const from = portPoint(fromRect, options.fromPort, firstTarget);
  const to = portPoint(toRect, options.toPort, lastTarget, context.toSlot);

  const spine = buildSpine(from.point, from.side, to.point, to.side, options, context.obstacles ?? []);
  const labelPoint = pointAlongPolyline(spine.samples, options.labelPosition);
  return {
    d: spine.d,
    start: from.point,
    end: to.point,
    startAngle: angleBetween(spine.samples[1] ?? to.point, from.point),
    endAngle: angleBetween(spine.samples[spine.samples.length - 2] ?? from.point, to.point),
    labelPoint,
    samples: spine.samples
  };
}

function buildSpine(
  start: Point,
  startSide: Side,
  end: Point,
  endSide: Side,
  options: Pick<BoardConnector, "routing" | "waypoints"> & Partial<Pick<BoardConnector, "cornerRadius">>,
  obstacles: Rect[]
): { d: string; samples: Point[] } {
  if (options.routing === "orthogonal") {
    const points = orthogonalRoute(start, startSide, end, endSide, options.waypoints, obstacles);
    const radius = options.cornerRadius ?? CONNECTOR_CORNER_RADIUS;
    return { d: roundedPolylinePath(points, radius), samples: points };
  }
  if (options.routing === "straight") {
    const points = [start, ...options.waypoints, end];
    return { d: polylinePath(points), samples: points };
  }
  return curvedSpine(start, startSide, end, endSide, options.waypoints);
}

function curvedSpine(start: Point, startSide: Side, end: Point, endSide: Side, waypoints: Point[]): { d: string; samples: Point[] } {
  const n1 = sideNormal(startSide);
  const n2 = sideNormal(endSide);
  if (waypoints.length === 0) {
    const distance = Math.max(40, Math.hypot(end.x - start.x, end.y - start.y) / 2);
    const c1 = { x: start.x + n1.x * distance, y: start.y + n1.y * distance };
    const c2 = { x: end.x + n2.x * distance, y: end.y + n2.y * distance };
    const d = `M ${fmt(start)} C ${fmt(c1)}, ${fmt(c2)}, ${fmt(end)}`;
    return { d, samples: sampleCubic(start, c1, c2, end) };
  }
  // Smooth through waypoints: quadratic segments through midpoints.
  const points = [start, ...waypoints, end];
  let d = `M ${fmt(points[0]!)}`;
  for (let index = 1; index < points.length - 1; index++) {
    const control = points[index]!;
    const mid = midpoint(control, points[index + 1]!);
    d += ` Q ${fmt(control)}, ${fmt(index === points.length - 2 ? points[index + 1]! : mid)}`;
  }
  return { d, samples: points };
}

/**
 * Orthogonal routing with a mid-span trunk. Both endpoints get a straight stub, then the route
 * crosses on a single shared lane placed halfway between them — the classic org-chart/flowchart
 * shape. If that lane (or either stem) would cut through a node, the lane slides to the nearest
 * clear alternative just outside the offending node.
 */
function orthogonalRoute(start: Point, startSide: Side, end: Point, endSide: Side, waypoints: Point[], obstacles: Rect[]): Point[] {
  const n1 = sideNormal(startSide);
  const n2 = sideNormal(endSide);
  const exit = { x: start.x + n1.x * STUB, y: start.y + n1.y * STUB };
  const entry = { x: end.x + n2.x * STUB, y: end.y + n2.y * STUB };

  if (waypoints.length) {
    return dedupePoints(routeThroughWaypoints(start, exit, entry, end, n1, waypoints));
  }

  const verticalPair = n1.y !== 0 && n2.y !== 0;
  const horizontalPair = n1.x !== 0 && n2.x !== 0;

  if (verticalPair) {
    if (Math.abs(exit.x - entry.x) < 0.5) return dedupePoints([start, exit, entry, end]);
    const trunk = chooseLane("y", exit.y, entry.y, exit.x, entry.x, obstacles);
    return dedupePoints([start, exit, { x: exit.x, y: trunk }, { x: entry.x, y: trunk }, entry, end]);
  }
  if (horizontalPair) {
    if (Math.abs(exit.y - entry.y) < 0.5) return dedupePoints([start, exit, entry, end]);
    const trunk = chooseLane("x", exit.x, entry.x, exit.y, entry.y, obstacles);
    return dedupePoints([start, exit, { x: trunk, y: exit.y }, { x: trunk, y: entry.y }, entry, end]);
  }
  // Mixed sides (one vertical, one horizontal): a single corner is already the shortest clean route.
  const corner = n1.y !== 0 ? { x: entry.x, y: exit.y } : { x: exit.x, y: entry.y };
  return dedupePoints([start, exit, corner, entry, end]);
}

function routeThroughWaypoints(start: Point, exit: Point, entry: Point, end: Point, n1: Point, waypoints: Point[]): Point[] {
  const points: Point[] = [start, exit];
  let cursor = exit;
  for (const target of waypoints) {
    // Elbow: move along the dominant axis of the exit direction first.
    if (n1.x !== 0 || Math.abs(target.x - cursor.x) > Math.abs(target.y - cursor.y)) {
      points.push({ x: target.x, y: cursor.y });
    } else {
      points.push({ x: cursor.x, y: target.y });
    }
    points.push(target);
    cursor = target;
  }
  // Connect the last waypoint to the entry stub with one more elbow.
  if (Math.abs(entry.x - cursor.x) > Math.abs(entry.y - cursor.y)) {
    points.push({ x: entry.x, y: cursor.y });
  } else {
    points.push({ x: cursor.x, y: entry.y });
  }
  points.push(entry, end);
  return points;
}

/**
 * Pick the crossing lane for a U-shaped orthogonal route. Candidates are the midpoint plus the
 * clear side of every obstacle; the closest candidate to the midpoint that leaves all three
 * segments clear wins. If nothing is clear we fall back to the midpoint — a visible crossing beats
 * a wild detour, and `validate_board` reports it so the diagram can be fixed properly.
 */
function chooseLane(axis: "x" | "y", fromValue: number, toValue: number, crossA: number, crossB: number, obstacles: Rect[]): number {
  const mid = (fromValue + toValue) / 2;
  if (obstacles.length === 0) return mid;

  const lower = Math.min(fromValue, toValue) - MAX_DETOUR;
  const upper = Math.max(fromValue, toValue) + MAX_DETOUR;
  const candidates = [mid];
  for (const rect of obstacles) {
    const min = axis === "y" ? rect.y : rect.x;
    const max = min + (axis === "y" ? rect.height : rect.width);
    candidates.push(min - LANE_CLEARANCE, max + LANE_CLEARANCE);
  }

  const viable = candidates
    .filter((value) => value >= lower && value <= upper)
    .sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));

  for (const lane of viable) {
    const segments: Array<[Point, Point]> =
      axis === "y"
        ? [
            [{ x: crossA, y: fromValue }, { x: crossA, y: lane }],
            [{ x: crossA, y: lane }, { x: crossB, y: lane }],
            [{ x: crossB, y: lane }, { x: crossB, y: toValue }]
          ]
        : [
            [{ x: fromValue, y: crossA }, { x: lane, y: crossA }],
            [{ x: lane, y: crossA }, { x: lane, y: crossB }],
            [{ x: lane, y: crossB }, { x: toValue, y: crossB }]
          ];
    if (segments.every(([a, b]) => !obstacles.some((rect) => segmentIntersectsRect(a, b, rect)))) {
      return lane;
    }
  }
  return mid;
}

/**
 * Drop repeated points, then drop vertices that sit on a straight run — a corner that isn't a turn
 * would otherwise pick up a fillet and round off a line that should be dead straight.
 */
function dedupePoints(points: Point[]): Point[] {
  const unique: Point[] = [];
  for (const point of points) {
    const last = unique[unique.length - 1];
    if (!last || Math.abs(last.x - point.x) > 0.01 || Math.abs(last.y - point.y) > 0.01) {
      unique.push(point);
    }
  }
  const result: Point[] = [];
  for (let index = 0; index < unique.length; index++) {
    const previous = result[result.length - 1];
    const next = unique[index + 1];
    if (previous && next && Math.abs(cross(previous, unique[index]!, next)) < 0.01) continue;
    result.push(unique[index]!);
  }
  return result;
}

function polylinePath(points: Point[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${fmt(point)}`).join(" ");
}

/** Polyline with quadratic fillets at each interior vertex. radius <= 0 keeps hard corners. */
export function roundedPolylinePath(points: Point[], radius: number): string {
  if (radius <= 0 || points.length < 3) return polylinePath(points);
  let d = `M ${fmt(points[0]!)}`;
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]!;
    const corner = points[index]!;
    const next = points[index + 1]!;
    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const trim = Math.min(radius, inLength / 2, outLength / 2);
    if (trim < 0.5) {
      d += ` L ${fmt(corner)}`;
      continue;
    }
    const enter = { x: corner.x + ((previous.x - corner.x) / inLength) * trim, y: corner.y + ((previous.y - corner.y) / inLength) * trim };
    const leave = { x: corner.x + ((next.x - corner.x) / outLength) * trim, y: corner.y + ((next.y - corner.y) / outLength) * trim };
    d += ` L ${fmt(enter)} Q ${fmt(corner)}, ${fmt(leave)}`;
  }
  d += ` L ${fmt(points[points.length - 1]!)}`;
  return d;
}

function sampleCubic(p0: Point, c1: Point, c2: Point, p1: Point): Point[] {
  const samples: Point[] = [];
  for (let step = 0; step <= 16; step++) {
    const t = step / 16;
    const mt = 1 - t;
    samples.push({
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p1.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p1.y
    });
  }
  return samples;
}

export function pointAlongPolyline(points: Point[], t: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    const length = Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y);
    lengths.push(length);
    total += length;
  }
  let remaining = Math.min(Math.max(t, 0), 1) * total;
  for (let index = 1; index < points.length; index++) {
    const length = lengths[index - 1]!;
    if (remaining <= length || index === points.length - 1) {
      const ratio = length === 0 ? 0 : remaining / length;
      return {
        x: points[index - 1]!.x + (points[index]!.x - points[index - 1]!.x) * ratio,
        y: points[index - 1]!.y + (points[index]!.y - points[index - 1]!.y) * ratio
      };
    }
    remaining -= length;
  }
  return points[points.length - 1]!;
}

export function arrowheadPath(tip: Point, angle: number, kind: BoardConnector["arrowEnd"], size = 10): string {
  if (kind === "none") return "";
  if (kind === "dot") {
    return `M ${fmt({ x: tip.x - size / 2, y: tip.y })} a ${size / 2} ${size / 2} 0 1 0 ${size} 0 a ${size / 2} ${size / 2} 0 1 0 ${-size} 0`;
  }
  const left = rotate({ x: -size, y: -size * 0.55 }, angle);
  const right = rotate({ x: -size, y: size * 0.55 }, angle);
  const back = rotate({ x: -size * 1.6, y: 0 }, angle);
  const pLeft = { x: tip.x + left.x, y: tip.y + left.y };
  const pRight = { x: tip.x + right.x, y: tip.y + right.y };
  if (kind === "arrow") {
    return `M ${fmt(pLeft)} L ${fmt(tip)} L ${fmt(pRight)}`;
  }
  if (kind === "triangle") {
    return `M ${fmt(pLeft)} L ${fmt(tip)} L ${fmt(pRight)} Z`;
  }
  // diamond
  const pBack = { x: tip.x + back.x, y: tip.y + back.y };
  return `M ${fmt(tip)} L ${fmt(pLeft)} L ${fmt(pBack)} L ${fmt(pRight)} Z`;
}

/** Filled arrowheads (triangle/dot/diamond) vs stroked (arrow). */
export function arrowheadIsFilled(kind: BoardConnector["arrowEnd"]): boolean {
  return kind === "triangle" || kind === "dot" || kind === "diamond";
}

/**
 * Dash pattern for a stroke style, scaled to the stroke width so a 1px hairline and a 6px rule
 * read as the same idea. Butt caps on purpose: round caps on a short dash render as blobs in some
 * SVG rasterizers, and the PNG export must match the canvas exactly.
 */
export function strokeDashPattern(strokeStyle: StrokeStyle | undefined, strokeWidth: number): { dashArray: string; lineCap: "butt" | "round" } | undefined {
  if (!strokeStyle || strokeStyle === "solid") return undefined;
  const width = Math.max(0.5, strokeWidth);
  if (strokeStyle === "dotted") {
    return { dashArray: `${round2(width)} ${round2(width * 2)}`, lineCap: "butt" };
  }
  return { dashArray: `${round2(width * 4)} ${round2(width * 3)}`, lineCap: "butt" };
}

/** Convenience for callers that only need the dasharray attribute. */
export function strokeDashArray(style: BoardStyle, fallbackWidth = 1): string | undefined {
  return strokeDashPattern(style.strokeStyle, style.strokeWidth ?? fallbackWidth)?.dashArray;
}

/**
 * Width of a connector's label pill. Canvas and SVG both need the same number, and neither can
 * measure text, so this approximates Inter's advance widths by character class — close enough that
 * the pill hugs its text instead of the old `length * 7.2`, which left "IIII" clipped and "····" swimming.
 */
/** Height of a connector's label pill — fixed by the canvas and SVG label styles. */
export const CONNECTOR_LABEL_HEIGHT = 26;

/**
 * Slide a connector's label along its own spine to the nearest spot where the pill clears every
 * node, including the two it connects. A label lying across a filled box is the single most
 * "unfinished" thing a diagram can do, and the author's requested position is usually only a hint.
 * `fits: false` means no position on this spine works — the caller should surface that rather than
 * quietly drawing the collision.
 */
export function connectorLabelPoint(
  samples: Point[],
  labelPosition: number,
  labelWidth: number,
  blockers: Rect[]
): { point: Point; fits: boolean } {
  const requested = pointAlongPolyline(samples, labelPosition);
  if (blockers.length === 0) return { point: requested, fits: true };

  const clears = (point: Point): boolean => {
    const box: Rect = {
      x: point.x - labelWidth / 2,
      y: point.y - CONNECTOR_LABEL_HEIGHT / 2,
      width: labelWidth,
      height: CONNECTOR_LABEL_HEIGHT
    };
    return !blockers.some((rect) => rectsOverlap(box, rect, 2));
  };

  if (clears(requested)) return { point: requested, fits: true };

  // Walk outwards from the requested position so the label stays as close to it as possible.
  for (let step = 1; step <= 12; step++) {
    for (const direction of [-1, 1]) {
      const t = labelPosition + direction * step * 0.04;
      if (t < 0.06 || t > 0.94) continue;
      const candidate = pointAlongPolyline(samples, t);
      if (clears(candidate)) return { point: candidate, fits: true };
    }
  }
  return { point: requested, fits: false };
}

export function connectorLabelWidth(label: string, fontSize = 12): number {
  let units = 0;
  for (const character of label) {
    if (" ·.,:;'!|il".includes(character)) units += 0.32;
    else if ("fjrt()[]-".includes(character)) units += 0.44;
    else if ("mwMW".includes(character)) units += 0.86;
    else if (character >= "A" && character <= "Z") units += 0.68;
    else units += 0.56;
  }
  return Math.round(units * fontSize) + 20;
}

// ---------------------------------------------------------------------------
// Project-aware helpers — one implementation for the canvas and the exporters.
// ---------------------------------------------------------------------------

/** Element rect in page/world coordinates: artboard origin plus the whole parent chain. */
export function elementWorldRect(project: BoardProject, element: BoardElement): Rect | undefined {
  const artboard = project.artboards.find((candidate) => candidate.id === element.artboardId);
  if (!artboard) return undefined;
  let x = element.x;
  let y = element.y;
  let parentId = element.parentId;
  const seen = new Set<string>([element.id]);
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = project.elements.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    x += parent.x;
    y += parent.y;
    parentId = parent.parentId;
  }
  return { x: artboard.x + x, y: artboard.y + y, width: element.width, height: element.height };
}

/** Rect a connector endpoint attaches to — an element when anchored, else the whole artboard. */
export function connectorEndpointRect(project: BoardProject, artboardId: string, elementId?: string): Rect | undefined {
  const artboard = project.artboards.find((candidate) => candidate.id === artboardId);
  if (!artboard) return undefined;
  if (!elementId) {
    return { x: artboard.x, y: artboard.y, width: artboard.width, height: artboard.height };
  }
  const element = project.elements.find((candidate) => candidate.id === elementId);
  if (!element) return undefined;
  return elementWorldRect(project, element);
}

/**
 * Nodes a connector should steer around: visible, space-occupying elements on either endpoint's
 * artboard, minus the endpoints themselves and anything nested in — or containing — them. Without
 * the containment rule, an edge into a container would be blocked by that container's own children.
 */
export function connectorObstacleElements(project: BoardProject, connector: BoardConnector): Array<{ element: BoardElement; rect: Rect }> {
  const fromRect = connectorEndpointRect(project, connector.fromArtboardId, connector.fromElementId);
  const toRect = connectorEndpointRect(project, connector.toArtboardId, connector.toElementId);
  if (!fromRect || !toRect) return [];
  const artboardIds = new Set([connector.fromArtboardId, connector.toArtboardId]);
  const endpointIds = new Set([connector.fromElementId, connector.toElementId].filter(Boolean) as string[]);

  const obstacles: Array<{ element: BoardElement; rect: Rect }> = [];
  for (const element of project.elements) {
    if (!artboardIds.has(element.artboardId)) continue;
    if (!element.visible || endpointIds.has(element.id)) continue;
    if (TRANSPARENT_TO_CONNECTORS.has(element.type)) continue;
    const rect = elementWorldRect(project, element);
    if (!rect) continue;
    if (rectsNest(rect, fromRect) || rectsNest(rect, toRect)) continue;
    obstacles.push({ element, rect });
  }
  return obstacles;
}

export function connectorObstacles(project: BoardProject, connector: BoardConnector): Rect[] {
  return connectorObstacleElements(project, connector).map(({ rect }) => rect);
}

/**
 * Fan-out slots for connectors converging on the same side of the same node. Only the incoming end
 * is spread: a shared outgoing trunk is exactly what an org chart wants, while two arrowheads
 * landing on one pixel is always wrong.
 */
export function connectorAnchorSlots(project: BoardProject): Map<string, AnchorSlot> {
  const groups = new Map<string, BoardConnector[]>();
  for (const connector of project.connectors) {
    const rect = connectorEndpointRect(project, connector.toArtboardId, connector.toElementId);
    const fromRect = connectorEndpointRect(project, connector.fromArtboardId, connector.fromElementId);
    if (!rect || !fromRect) continue;
    const side = connector.toPort === "auto" ? autoSide(rect, center(fromRect)) : connector.toPort;
    const key = `${connector.toElementId ?? connector.toArtboardId}:${side}`;
    groups.set(key, [...(groups.get(key) ?? []), connector]);
  }

  const slots = new Map<string, AnchorSlot>();
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const side = key.slice(key.lastIndexOf(":") + 1) as Side;
    const horizontal = side === "n" || side === "s";
    // Order by where each edge comes from, so the fanned anchors don't cross each other.
    const ordered = [...members].sort((a, b) => {
      const rectA = connectorEndpointRect(project, a.fromArtboardId, a.fromElementId);
      const rectB = connectorEndpointRect(project, b.fromArtboardId, b.fromElementId);
      if (!rectA || !rectB) return 0;
      return horizontal ? center(rectA).x - center(rectB).x : center(rectA).y - center(rectB).y;
    });
    ordered.forEach((connector, index) => slots.set(connector.id, { index, count: ordered.length }));
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Geometry predicates — shared by routing and by the board layout diagnostics.
// ---------------------------------------------------------------------------

export function rectsOverlap(a: Rect, b: Rect, tolerance = 0): boolean {
  return (
    a.x + a.width - tolerance > b.x &&
    b.x + b.width - tolerance > a.x &&
    a.y + a.height - tolerance > b.y &&
    b.y + b.height - tolerance > a.y
  );
}

/** True when either rect sits (almost) entirely inside the other. */
export function rectsNest(a: Rect, b: Rect): boolean {
  return rectContains(a, b) || rectContains(b, a);
}

function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - 1 &&
    inner.y >= outer.y - 1 &&
    inner.x + inner.width <= outer.x + outer.width + 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1
  );
}

export function segmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  // Cheap reject on the segment's bounding box.
  if (maxX <= rect.x || minX >= rect.x + rect.width || maxY <= rect.y || minY >= rect.y + rect.height) return false;
  // Axis-aligned segments (every orthogonal route) are settled by the bounding-box test alone.
  if (Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01) return true;
  if (pointInRect(a, rect) || pointInRect(b, rect)) return true;
  const edges: Array<[Point, Point]> = [
    [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y }],
    [{ x: rect.x + rect.width, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }],
    [{ x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }],
    [{ x: rect.x, y: rect.y + rect.height }, { x: rect.x, y: rect.y }]
  ];
  return edges.some(([c, d]) => segmentsCross(a, b, c, d));
}

function pointInRect(point: Point, rect: Rect): boolean {
  return point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height;
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function rotate(point: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

function angleBetween(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function center(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function fmt(point: Point): string {
  return `${round2(point.x)} ${round2(point.y)}`;
}
