import type { BoardConnector } from "./index.js";

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
}

type Side = "n" | "s" | "e" | "w";

const STUB = 24;

export function portPoint(rect: Rect, port: ConnectorPort, towards: Point): { point: Point; side: Side } {
  const side: Side = port === "auto" ? autoSide(rect, towards) : port;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  switch (side) {
    case "n":
      return { point: { x: cx, y: rect.y }, side };
    case "s":
      return { point: { x: cx, y: rect.y + rect.height }, side };
    case "w":
      return { point: { x: rect.x, y: cy }, side };
    case "e":
      return { point: { x: rect.x + rect.width, y: cy }, side };
  }
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
  options: Pick<BoardConnector, "fromPort" | "toPort" | "routing" | "waypoints" | "labelPosition">
): ConnectorGeometry {
  const toCenter = center(toRect);
  const fromCenter = center(fromRect);
  const firstTarget = options.waypoints[0] ?? toCenter;
  const lastTarget = options.waypoints[options.waypoints.length - 1] ?? fromCenter;
  const from = portPoint(fromRect, options.fromPort, firstTarget);
  const to = portPoint(toRect, options.toPort, lastTarget);

  const spine = buildSpine(from.point, from.side, to.point, to.side, options.routing, options.waypoints);
  const labelPoint = pointAlongPolyline(spine.samples, options.labelPosition);
  return {
    d: spine.d,
    start: from.point,
    end: to.point,
    startAngle: angleBetween(spine.samples[1] ?? to.point, from.point),
    endAngle: angleBetween(spine.samples[spine.samples.length - 2] ?? from.point, to.point),
    labelPoint
  };
}

function buildSpine(start: Point, startSide: Side, end: Point, endSide: Side, routing: ConnectorRouting, waypoints: Point[]): { d: string; samples: Point[] } {
  if (routing === "orthogonal") {
    const points = orthogonalRoute(start, startSide, end, endSide, waypoints);
    return { d: polylinePath(points), samples: points };
  }
  if (routing === "straight") {
    const points = [start, ...waypoints, end];
    return { d: polylinePath(points), samples: points };
  }
  return curvedSpine(start, startSide, end, endSide, waypoints);
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

function orthogonalRoute(start: Point, startSide: Side, end: Point, endSide: Side, waypoints: Point[]): Point[] {
  const n1 = sideNormal(startSide);
  const n2 = sideNormal(endSide);
  const exit = { x: start.x + n1.x * STUB, y: start.y + n1.y * STUB };
  const entry = { x: end.x + n2.x * STUB, y: end.y + n2.y * STUB };
  const anchors = waypoints.length ? waypoints : undefined;

  const points: Point[] = [start, exit];
  let cursor = exit;
  for (const target of anchors ?? [entry]) {
    // Elbow: move along the dominant axis of the exit direction first.
    if (n1.x !== 0 || (anchors && Math.abs(target.x - cursor.x) > Math.abs(target.y - cursor.y))) {
      points.push({ x: target.x, y: cursor.y });
    } else {
      points.push({ x: cursor.x, y: target.y });
    }
    points.push(target);
    cursor = target;
  }
  if (anchors) {
    // Connect the last waypoint to the entry stub with one more elbow.
    if (Math.abs(entry.x - cursor.x) > Math.abs(entry.y - cursor.y)) {
      points.push({ x: entry.x, y: cursor.y });
    } else {
      points.push({ x: cursor.x, y: entry.y });
    }
    points.push(entry);
  }
  points.push(end);
  return dedupePoints(points);
}

function dedupePoints(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (!last || Math.abs(last.x - point.x) > 0.01 || Math.abs(last.y - point.y) > 0.01) {
      result.push(point);
    }
  }
  return result;
}

function polylinePath(points: Point[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${fmt(point)}`).join(" ");
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

function fmt(point: Point): string {
  return `${Math.round(point.x * 100) / 100} ${Math.round(point.y * 100) / 100}`;
}
