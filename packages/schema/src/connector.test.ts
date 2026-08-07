import { describe, expect, it } from "vitest";
import {
  applyBoardOperation,
  BoardProjectSchema,
  connectorAnchorSlots,
  connectorGeometry,
  connectorLabelWidth,
  connectorObstacles,
  createDefaultProject,
  rectsOverlap,
  segmentIntersectsRect,
  strokeDashPattern,
  textAdvanceWidth,
  validateBoardStructure,
  wrapTextToWidth,
  type BoardConnector,
  type BoardElement,
  type BoardProject,
  type Rect
} from "./index.js";

const ORTHOGONAL = {
  fromPort: "s",
  toPort: "n",
  routing: "orthogonal",
  waypoints: [],
  labelPosition: 0.5
} satisfies Pick<BoardConnector, "fromPort" | "toPort" | "routing" | "waypoints" | "labelPosition">;

function corners(d: string): Array<{ x: number; y: number }> {
  return [...d.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
}

describe("orthogonal routing", () => {
  const parent: Rect = { x: 200, y: 0, width: 200, height: 100 };
  const child: Rect = { x: 600, y: 400, width: 200, height: 100 };

  it("crosses on a lane midway between the two nodes, not against the target", () => {
    const geometry = connectorGeometry(parent, child, ORTHOGONAL);
    // Stubs are 24px, so the free span runs 124 → 376 and its midpoint is 250.
    expect(geometry.samples[1]!.y).toBe(250);
    expect(geometry.samples[2]!.y).toBe(250);
    // Straight runs collapse to their endpoints: down, across, down.
    expect(geometry.samples).toHaveLength(4);
  });

  it("routes around a node standing in the way", () => {
    const blocker: Rect = { x: 250, y: 200, width: 300, height: 120 };
    const clear = connectorGeometry(parent, child, ORTHOGONAL, { obstacles: [blocker] });
    const trunkY = clear.samples[2]!.y;
    expect(trunkY).not.toBe(250);
    const crossed = clear.samples.some(
      (point, index) => index > 0 && segmentIntersectsRect(clear.samples[index - 1]!, point, blocker)
    );
    expect(crossed).toBe(false);
  });

  it("keeps the midpoint lane when no clear alternative exists", () => {
    // A wall spanning the whole corridor: no lane is clear, so we take the honest crossing and let
    // validate_board report it rather than flinging the edge off into space.
    const wall: Rect = { x: -2000, y: 200, width: 5000, height: 120 };
    const geometry = connectorGeometry(parent, child, ORTHOGONAL, { obstacles: [wall] });
    expect(geometry.samples[2]!.y).toBe(250);
  });

  it("rounds elbows by default and honours cornerRadius: 0", () => {
    expect(connectorGeometry(parent, child, ORTHOGONAL).d).toContain("Q");
    expect(connectorGeometry(parent, child, { ...ORTHOGONAL, cornerRadius: 0 }).d).not.toContain("Q");
  });

  it("draws a straight drop when the two ports already line up", () => {
    const aligned: Rect = { x: 200, y: 400, width: 200, height: 100 };
    expect(corners(connectorGeometry(parent, aligned, ORTHOGONAL).d)).toHaveLength(2);
  });
});

describe("stroke styles", () => {
  it("has no dash pattern for solid", () => {
    expect(strokeDashPattern("solid", 2)).toBeUndefined();
    expect(strokeDashPattern(undefined, 2)).toBeUndefined();
  });

  it("scales the dash to the stroke width", () => {
    expect(strokeDashPattern("dashed", 2)?.dashArray).toBe("8 6");
    expect(strokeDashPattern("dashed", 4)?.dashArray).toBe("16 12");
    expect(strokeDashPattern("dotted", 2)?.dashArray).toBe("2 4");
  });

  it("uses butt caps so the canvas and the rasterized PNG agree", () => {
    expect(strokeDashPattern("dotted", 2)?.lineCap).toBe("butt");
  });
});

describe("board-level connector helpers", () => {
  function diagram(): BoardProject {
    const project = createDefaultProject("Routing", "diagram") as BoardProject;
    const artboardId = project.artboards[0]!.id;
    const node = (id: string, x: number, y: number) => ({
      id,
      type: "shape" as const,
      name: id,
      artboardId,
      parentId: null,
      x,
      y,
      width: 200,
      height: 100,
      zIndex: 1,
      locked: false,
      visible: true,
      semanticRole: "diagram shape",
      style: { fill: "#FFFFFF", stroke: "#94A3B8", strokeWidth: 1.5 },
      layout: { mode: "absolute" as const },
      props: { shape: "rounded", text: id }
    });
    return {
      ...project,
      elements: [node("a", 0, 0), node("b", 600, 0), node("target", 300, 500)],
      connectors: [
        { ...ORTHOGONAL, id: "c1", fromArtboardId: artboardId, toArtboardId: artboardId, fromElementId: "a", toElementId: "target", arrowStart: "none", arrowEnd: "arrow", style: {} },
        { ...ORTHOGONAL, id: "c2", fromArtboardId: artboardId, toArtboardId: artboardId, fromElementId: "b", toElementId: "target", arrowStart: "none", arrowEnd: "arrow", style: {} }
      ]
    } as BoardProject;
  }

  it("never lists a connector's own endpoints as obstacles", () => {
    const project = diagram();
    const rects = connectorObstacles(project, project.connectors[0]!);
    expect(rects).toHaveLength(1);
    expect(rects[0]!.width).toBe(200);
  });

  it("fans out edges converging on the same side so arrowheads do not stack", () => {
    const project = diagram();
    const slots = connectorAnchorSlots(project);
    expect(slots.get("c1")).toEqual({ index: 0, count: 2 });
    expect(slots.get("c2")).toEqual({ index: 1, count: 2 });

    const rectOf = (x: number): Rect => ({ x: x + project.artboards[0]!.x, y: project.artboards[0]!.y, width: 200, height: 100 });
    const target: Rect = { x: 300 + project.artboards[0]!.x, y: 500 + project.artboards[0]!.y, width: 200, height: 100 };
    const first = connectorGeometry(rectOf(0), target, ORTHOGONAL, { toSlot: slots.get("c1") });
    const second = connectorGeometry(rectOf(600), target, ORTHOGONAL, { toSlot: slots.get("c2") });
    expect(first.end.x).not.toBe(second.end.x);
    expect(second.end.x - first.end.x).toBeCloseTo(40, 5);
  });

  it("reports an edge that cuts through a node instead of passing the board", () => {
    const project = diagram();
    // Drop a node straight onto c1's corridor.
    const blocked: BoardProject = {
      ...project,
      elements: [...project.elements, { ...project.elements[0]!, id: "wall", name: "Wall", x: -400, y: 200, width: 1200, height: 160 }]
    };
    const report = validateBoardStructure(blocked);
    expect(report.issues.some((issue) => issue.code === "connector-crosses-element")).toBe(true);
    // Geometry problems are warnings — a deliberate crossing must not make the board invalid.
    expect(report.valid).toBe(true);
  });

  it("passes a clean diagram with no layout warnings", () => {
    const report = validateBoardStructure(diagram());
    const layoutCodes = ["connector-crosses-element", "connector-endpoints-collide", "elements-overlap", "element-outside-artboard"];
    expect(report.issues.filter((issue) => layoutCodes.includes(issue.code))).toEqual([]);
  });
});

describe("polish_layout", () => {
  function node(id: string, x: number, y: number, width = 200, height = 100): BoardElement {
    return {
      id,
      type: "shape",
      name: id,
      artboardId: "art",
      parentId: null,
      x,
      y,
      width,
      height,
      zIndex: 1,
      locked: false,
      visible: true,
      semanticRole: "diagram shape",
      style: {},
      layout: { mode: "absolute" },
      props: { shape: "rounded", text: id }
    };
  }

  function board(elements: BoardElement[], connectors: BoardConnector[] = []): BoardProject {
    return BoardProjectSchema.parse({
      schemaVersion: 1,
      id: "b",
      name: "Polish",
      pages: [{ id: "p", name: "Main", artboardIds: ["art"] }],
      artboards: [{ id: "art", name: "Canvas", type: "custom", x: 0, y: 0, width: 2000, height: 1200, background: "#FFF", frameless: true, locked: false, visible: true }],
      elements,
      connectors,
      assets: [],
      selection: [],
      metadata: { createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z", createdBy: "test" }
    });
  }

  const polish = (project: BoardProject): BoardProject =>
    applyBoardOperation(project, { type: "polish_layout", artboardId: "art", grid: 8, tolerance: 28 });

  it("aligns a nearly-level row onto one centre line and snaps it to the grid", () => {
    const result = polish(board([node("a", 0, 100), node("b", 300, 107), node("c", 600, 94)]));
    const ys = result.elements.map((element) => element.y);
    expect(new Set(ys).size).toBe(1);
    expect(ys[0]! % 8).toBe(0);
  });

  it("unifies sizes that were meant to match but leaves deliberate differences alone", () => {
    const near = polish(board([node("a", 0, 100, 200, 100), node("b", 300, 100, 200, 108)]));
    expect(new Set(near.elements.map((element) => element.height)).size).toBe(1);

    const deliberate = polish(board([node("a", 0, 100, 200, 100), node("b", 300, 100, 200, 400)]));
    expect(new Set(deliberate.elements.map((element) => element.height)).size).toBe(2);
  });

  it("evens out spacing that was nearly even, and preserves deliberate grouping", () => {
    const ragged = polish(board([node("a", 0, 100), node("b", 240, 100), node("c", 500, 100), node("d", 748, 100)]));
    const xs = ragged.elements.map((element) => element.x).sort((p, q) => p - q);
    const gaps = xs.slice(1).map((x, index) => x - xs[index]! - 200);
    expect(new Set(gaps).size).toBe(1);

    // One tight pair then a wide jump is a grouping decision, not sloppiness.
    const grouped = polish(board([node("a", 0, 100), node("b", 220, 100), node("c", 1200, 100)]));
    const groupedXs = grouped.elements.map((element) => element.x).sort((p, q) => p - q);
    expect(groupedXs[2]! - groupedXs[1]!).toBeGreaterThan(500);
  });

  it("separates overlapping nodes", () => {
    const result = polish(board([node("a", 100, 100), node("b", 160, 130)]));
    const [a, b] = result.elements;
    expect(rectsOverlap({ x: a!.x, y: a!.y, width: a!.width, height: a!.height }, { x: b!.x, y: b!.y, width: b!.width, height: b!.height }, 2)).toBe(false);
  });

  it("pulls elements back inside the artboard", () => {
    const result = polish(board([node("a", -300, 100), node("b", 400, 100)]));
    expect(result.elements.find((element) => element.id === "a")!.x).toBeGreaterThanOrEqual(0);
  });

  it("frees a port left facing away from its partner", () => {
    const connector: BoardConnector = {
      ...ORTHOGONAL,
      id: "c",
      fromArtboardId: "art",
      toArtboardId: "art",
      fromElementId: "a",
      toElementId: "b",
      // "a" sits BELOW "b", so a south-facing exit points the wrong way.
      fromPort: "s",
      toPort: "n",
      arrowStart: "none",
      arrowEnd: "arrow",
      style: {}
    };
    const result = polish(board([node("a", 0, 600), node("b", 800, 100)], [connector]));
    expect(result.connectors[0]!.fromPort).toBe("auto");
  });

  it("drops a waypoint stranded inside a node", () => {
    const connector: BoardConnector = {
      ...ORTHOGONAL,
      id: "c",
      fromArtboardId: "art",
      toArtboardId: "art",
      fromElementId: "a",
      toElementId: "b",
      waypoints: [{ x: 850, y: 140 }],
      arrowStart: "none",
      arrowEnd: "arrow",
      style: {}
    };
    const result = polish(board([node("a", 0, 100), node("b", 800, 100), node("wall", 800, 100)], [connector]));
    expect(result.connectors[0]!.waypoints).toEqual([]);
  });

  it("is idempotent — polishing twice changes nothing", () => {
    const once = polish(board([node("a", 3, 101), node("b", 297, 107), node("c", 601, 94)]));
    const twice = polish(once);
    expect(twice.elements.map((element) => [element.x, element.y, element.width, element.height])).toEqual(
      once.elements.map((element) => [element.x, element.y, element.width, element.height])
    );
  });
});

describe("polish_layout — spacing after resizing", () => {
  function node(id: string, x: number, y: number, width: number, height: number): BoardElement {
    return {
      id, type: "shape", name: id, artboardId: "art", parentId: null, x, y, width, height,
      zIndex: 1, locked: false, visible: true, semanticRole: "diagram shape",
      style: {}, layout: { mode: "absolute" }, props: { shape: "rounded", text: id }
    } as BoardElement;
  }
  const board = (elements: BoardElement[]): BoardProject =>
    BoardProjectSchema.parse({
      schemaVersion: 1, id: "b", name: "Spacing",
      pages: [{ id: "p", name: "Main", artboardIds: ["art"] }],
      artboards: [{ id: "art", name: "Canvas", type: "custom", x: 0, y: 0, width: 4000, height: 1200, background: "#FFF", frameless: true, locked: false, visible: true }],
      elements, connectors: [], assets: [], selection: [],
      metadata: { createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z", createdBy: "test" }
    });

  // The real shape of the bug: unifying widths grows every card around its centre, which eats the
  // gaps. Judging regularity after that growth left two neighbours flush against each other.
  it("keeps even gaps even after unifying sizes", () => {
    const result = applyBoardOperation(
      board([
        node("a", 190, 973, 420, 118),
        node("b", 647, 986, 414, 124),
        node("c", 1083, 977, 420, 120),
        node("d", 1556, 982, 418, 116),
        node("e", 1990, 975, 420, 121)
      ]),
      { type: "polish_layout", artboardId: "art", grid: 8, tolerance: 28 }
    );
    const sorted = [...result.elements].sort((p, q) => p.x - q.x);
    expect(new Set(sorted.map((element) => element.width)).size).toBe(1);
    expect(new Set(sorted.map((element) => element.height)).size).toBe(1);
    expect(new Set(sorted.map((element) => element.y)).size).toBe(1);
    const gaps = sorted.slice(1).map((element, index) => element.x - (sorted[index]!.x + sorted[index]!.width));
    expect(new Set(gaps).size).toBe(1);
    expect(gaps[0]!).toBeGreaterThan(0);
  });

  it("never leaves neighbours touching, even in a deliberately irregular run", () => {
    const result = applyBoardOperation(
      board([node("a", 0, 100, 300, 100), node("b", 310, 100, 300, 100), node("c", 2000, 100, 300, 100)]),
      { type: "polish_layout", artboardId: "art", grid: 8, tolerance: 28 }
    );
    const sorted = [...result.elements].sort((p, q) => p.x - q.x);
    const gaps = sorted.slice(1).map((element, index) => element.x - (sorted[index]!.x + sorted[index]!.width));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(16);
    // The wide deliberate break survives.
    expect(Math.max(...gaps)).toBeGreaterThan(1000);
  });
});

describe("polish_layout — cluster membership guards", () => {
  const el = (id: string, x: number, y: number, width: number, height: number): BoardElement =>
    ({
      id, type: "shape", name: id, artboardId: "art", parentId: null, x, y, width, height,
      zIndex: 1, locked: false, visible: true, semanticRole: "diagram shape",
      style: {}, layout: { mode: "absolute" }, props: { shape: "rounded", text: id }
    }) as BoardElement;

  const run = (elements: BoardElement[]): BoardProject =>
    applyBoardOperation(
      BoardProjectSchema.parse({
        schemaVersion: 1, id: "b", name: "Guards",
        pages: [{ id: "p", name: "Main", artboardIds: ["art"] }],
        artboards: [{ id: "art", name: "Canvas", type: "custom", x: 0, y: 0, width: 3000, height: 2000, background: "#FFF", frameless: true, locked: false, visible: true }],
        elements, connectors: [], assets: [], selection: [],
        metadata: { createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z", createdBy: "test" }
      }),
      { type: "polish_layout", artboardId: "art", grid: 8, tolerance: 28 }
    );

  // A full-width band and a small card can share a centre-x without being a column. Treating them as
  // one used to shove the card ~400px down the artboard.
  it("does not treat a wide band and a narrow card as a column", () => {
    const result = run([el("band", 150, 900, 2300, 470), el("card", 1088, 976, 432, 128)]);
    expect(result.elements.find((element) => element.id === "card")!.y).toBeLessThan(1100);
  });

  it("does not group a container with the element it encloses", () => {
    const result = run([el("band", 150, 900, 2300, 470), el("inner", 190, 1216, 2216, 120)]);
    const inner = result.elements.find((element) => element.id === "inner")!;
    expect(inner.y).toBeGreaterThan(1100);
    expect(inner.y).toBeLessThan(1400);
  });
});

describe("text measurement and wrapping", () => {
  it("keeps connector label pills bit-identical after the shared-measurement refactor", () => {
    // Regression guard: the pill's width feeds `connector-label-collides`, so a silent 2% drift
    // would quietly change which diagrams validate.
    expect(connectorLabelWidth("Approve", 12)).toBe(Math.round(textAdvanceWidth("Approve", 12)) + 20);
    expect(connectorLabelWidth("IIII", 12)).toBeLessThan(connectorLabelWidth("MMMM", 12));
  });

  it("charges wide glyphs more than narrow ones", () => {
    expect(textAdvanceWidth("MMMM", 14)).toBeGreaterThan(textAdvanceWidth("iiii", 14));
  });

  it("wraps to the width budget instead of overflowing", () => {
    const lines = wrapTextToWidth("Customer support escalation queue", 120, 14, 600);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(textAdvanceWidth(line, 14, 600)).toBeLessThanOrEqual(120);
    }
    expect(lines.join(" ")).toBe("Customer support escalation queue");
  });

  it("hard-breaks a word that cannot fit on a line of its own", () => {
    // The common case is a URL or an identifier — the whole point is that nothing bleeds past the box.
    const lines = wrapTextToWidth("https://powerboard.lamonade.xyz/boards/very-long-identifier", 100, 12);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(textAdvanceWidth(line, 12)).toBeLessThanOrEqual(100);
    }
    expect(lines.join("")).toContain("powerboard.lamonade.xyz");
  });

  it("never returns an empty line list", () => {
    expect(wrapTextToWidth("x", 1, 14)).toEqual(["x"]);
  });
});
