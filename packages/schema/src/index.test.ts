import { describe, expect, it } from "vitest";
import { applyBoardOperation, BoardProjectSchema, createCommentMessage, createCommentThread, createDefaultProject, createElementFromPreset, DEVICE_PRESETS, inspectBoardHierarchy, validateBoardStructure } from "./index";

describe("Board schema", () => {
  it("validates the default project", () => {
    const project = createDefaultProject();
    expect(BoardProjectSchema.parse(project).id).toBe("board_default");
  });

  it("creates empty boards for non-starter templates", () => {
    for (const template of ["blank", "diagram"] as const) {
      const project = createDefaultProject("New", template);
      expect(project.artboards).toHaveLength(1);
      expect(project.artboards[0]!.frameless).toBe(true);
      expect(project.elements).toHaveLength(0);
      expect(project.connectors).toHaveLength(0);
      expect(BoardProjectSchema.parse(project).name).toBe("New");
    }
  });

  it("creates single-frame device boards for mobile/web templates with no seeded elements", () => {
    const mobile = createDefaultProject("M", "mobile");
    expect(mobile.artboards).toHaveLength(1);
    expect(mobile.artboards[0]!.type).toBe("mobile");
    expect(mobile.artboards[0]!.frameless).toBe(false);
    expect(mobile.elements).toHaveLength(0);
    const web = createDefaultProject("W", "web");
    expect(web.artboards[0]!.type).toBe("web");
    expect(web.artboards[0]!.width).toBe(1440);
    expect(web.elements).toHaveLength(0);
  });

  it("keeps the starter demo as the default template", () => {
    expect(createDefaultProject("Demo").elements.length).toBeGreaterThanOrEqual(10);
    expect(createDefaultProject("Demo", "starter").artboards).toHaveLength(2);
  });

  it("ships a broad set of named frame presets", () => {
    const ids = new Set(DEVICE_PRESETS.map((preset) => preset.id));
    expect(ids.size).toBe(DEVICE_PRESETS.length);
    expect(ids.has("iphone-15")).toBe(true);
    expect(ids.has("iphone-15-pro-max")).toBe(true);
    expect(ids.has("iphone-16-pro")).toBe(true);
    expect(ids.has("galaxy-s24-ultra")).toBe(true);
    expect(ids.has("ipad-pro-13")).toBe(true);
    expect(ids.has("desktop-1920")).toBe(true);
    expect(ids.has("web-dashboard")).toBe(true);
    expect(ids.has("app-store-phone")).toBe(true);
    expect(DEVICE_PRESETS.length).toBeGreaterThanOrEqual(30);
  });

  it("creates named hierarchy frames in the default project", () => {
    const project = createDefaultProject();
    const frames = project.elements.filter((element) => element.type === "frame");
    expect(frames.length).toBeGreaterThanOrEqual(5);
    expect(frames.every((frame) => frame.name.includes(" / "))).toBe(true);
    expect(project.elements.find((element) => element.id === "el_mobile_card")?.parentId).toBe("el_mobile_summary_frame");
    expect(frames.every((frame) => frame.props.hierarchyOnly === true)).toBe(true);
  });

  it("rejects duplicate ids", () => {
    const project = createDefaultProject();
    const duplicate = { ...project, elements: [project.elements[0], project.elements[0]] };
    expect(() => BoardProjectSchema.parse(duplicate)).toThrow(/Duplicate id/);
  });

  it("rejects unknown asset refs", () => {
    const project = createDefaultProject();
    const image = createElementFromPreset("image", project.artboards[0]!.id, 20, 20);
    image.props.assetId = "missing_asset";
    expect(() => BoardProjectSchema.parse({ ...project, elements: [...project.elements, image] })).toThrow(/Unknown asset id/);
  });

  it("creates app-mockup drawing primitives from presets", () => {
    const project = createDefaultProject();
    const artboardId = project.artboards[0]!.id;
    const icon = createElementFromPreset("icon", artboardId, 20, 20);
    const line = createElementFromPreset("line", artboardId, 20, 88);
    const sparkline = createElementFromPreset("sparkline", artboardId, 20, 124);

    expect(icon.props.materialIcon).toBe("add_circle");
    expect(icon.semanticRole).toBe("material icon");
    expect(line.props.direction).toBe("horizontal");
    expect(line.style.strokeWidth).toBeGreaterThan(0);
    expect(sparkline.props.values).toEqual(expect.arrayContaining([24, 72]));
    expect(sparkline.semanticRole).toBe("sparkline chart");
  });

  it("inspects hierarchy with stable agent-readable paths", () => {
    const project = createDefaultProject();
    const hierarchy = inspectBoardHierarchy(project);
    const mobile = hierarchy.find((artboard) => artboard.id === "art_home_mobile");
    const summaryFrame = mobile?.children.find((element) => element.id === "el_mobile_summary_frame");
    const card = summaryFrame?.children.find((element) => element.id === "el_mobile_card");

    expect(mobile?.path).toBe("Mobile Home");
    expect(summaryFrame?.path).toBe("Mobile Home / Summary Frame");
    expect(card?.path).toBe("Mobile Home / Summary Frame / Safe-to-Spend Card");
  });

  it("reports hierarchy and primitive diagnostics without rejecting valid schema", () => {
    const project = createDefaultProject();
    const icon = createElementFromPreset("icon", project.artboards[0]!.id, 20, 20);
    const line = createElementFromPreset("line", project.artboards[0]!.id, 20, 80);
    const sparkline = createElementFromPreset("sparkline", project.artboards[0]!.id, 20, 120);
    const crossArtboardChild = createElementFromPreset("text", project.artboards[1]!.id, 20, 20);
    icon.props = {};
    line.props.direction = "sideways";
    sparkline.props.values = [12];
    crossArtboardChild.parentId = project.elements[0]!.id;
    const parsed = BoardProjectSchema.parse({
      ...project,
      elements: [...project.elements, icon, line, sparkline, crossArtboardChild]
    });

    const report = validateBoardStructure(parsed);

    expect(report.valid).toBe(false);
    expect(report.summary.errors).toBe(1);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["parent-on-different-artboard", "icon-missing-material-name", "line-unknown-direction", "sparkline-needs-values"])
    );
  });
});

describe("Board operations", () => {
  it("adds, updates, moves, groups, and deletes elements", () => {
    const project = createDefaultProject();
    const artboardId = project.artboards[0]!.id;
    const button = createElementFromPreset("button", artboardId, 40, 40);
    let next = applyBoardOperation(project, { type: "add_element", element: button });
    expect(next.elements.some((element) => element.id === button.id)).toBe(true);

    next = applyBoardOperation(next, { type: "update_element", elementId: button.id, patch: { props: { text: "Ship it" } } });
    expect(next.elements.find((element) => element.id === button.id)?.props.text).toBe("Ship it");

    next = applyBoardOperation(next, { type: "move_resize_element", elementId: button.id, x: 80, width: 260 });
    expect(next.elements.find((element) => element.id === button.id)?.x).toBe(80);
    expect(next.elements.find((element) => element.id === button.id)?.width).toBe(260);

    const group = createElementFromPreset("group", artboardId, 30, 30);
    next = applyBoardOperation(next, { type: "group_elements", group, elementIds: [button.id] });
    expect(next.elements.find((element) => element.id === button.id)?.parentId).toBe(group.id);

    next = applyBoardOperation(next, { type: "delete_element", elementId: group.id });
    expect(next.elements.some((element) => element.id === button.id)).toBe(false);
  });

  it("updates artboards through the shared operation service", () => {
    const project = createDefaultProject();
    const artboardId = project.artboards[0]!.id;

    const next = applyBoardOperation(project, {
      type: "update_artboard",
      artboardId,
      patch: { name: "Mobile Home Iteration", x: 240, width: 414, background: "#FFFFFF" }
    });

    const artboard = next.artboards.find((candidate) => candidate.id === artboardId);
    expect(artboard?.name).toBe("Mobile Home Iteration");
    expect(artboard?.x).toBe(240);
    expect(artboard?.width).toBe(414);
    expect(artboard?.background).toBe("#FFFFFF");
    expect(next.selection).toEqual([artboardId]);
  });

  it("filters invalid and duplicate selection ids", () => {
    const project = createDefaultProject();
    const artboardId = project.artboards[0]!.id;
    const elementId = project.elements[0]!.id;

    const next = applyBoardOperation(project, {
      type: "set_selection",
      selection: ["missing", artboardId, elementId, artboardId]
    });

    expect(next.selection).toEqual([artboardId, elementId]);
  });
});

describe("Connector v2 + diagram operations", () => {
  it("defaults new connector fields and updates them via update_connector", () => {
    const project = createDefaultProject();
    const connector = project.connectors[0]!;
    expect(connector.routing).toBe("curved");
    expect(connector.arrowEnd).toBe("arrow");
    expect(connector.waypoints).toEqual([]);

    const next = applyBoardOperation(project, {
      type: "update_connector",
      connectorId: connector.id,
      patch: { routing: "orthogonal", arrowEnd: "triangle", waypoints: [{ x: 500, y: 300 }], label: "Go", style: { stroke: "#DC2626" } }
    });
    const updated = next.connectors[0]!;
    expect(updated.routing).toBe("orthogonal");
    expect(updated.arrowEnd).toBe("triangle");
    expect(updated.waypoints).toEqual([{ x: 500, y: 300 }]);
    expect(updated.style.stroke).toBe("#DC2626");
    expect(next.selection).toEqual([connector.id]);
  });

  it("swaps connector direction via update_connector, clearing element endpoints with explicit null", () => {
    let project = createDefaultProject();
    const artboardId = project.artboards[0]!.id;
    const shape = createElementFromPreset("shape", artboardId, 40, 40);
    project = applyBoardOperation(project, { type: "add_element", element: shape });
    const toArtboardId = project.artboards[1]!.id;
    project = applyBoardOperation(project, {
      type: "add_connector",
      connector: {
        id: "conn_swap",
        fromArtboardId: artboardId,
        toArtboardId,
        fromElementId: shape.id,
        fromPort: "auto",
        toPort: "auto",
        routing: "orthogonal",
        arrowStart: "none",
        arrowEnd: "arrow",
        waypoints: [],
        labelPosition: 0.5,
        style: {}
      }
    });
    const connector = project.connectors.find((candidate) => candidate.id === "conn_swap")!;
    const swapped = applyBoardOperation(project, {
      type: "update_connector",
      connectorId: connector.id,
      patch: {
        fromArtboardId: connector.toArtboardId,
        toArtboardId: connector.fromArtboardId,
        fromElementId: connector.toElementId ?? null,
        toElementId: connector.fromElementId ?? null
      }
    }).connectors.find((candidate) => candidate.id === "conn_swap")!;
    expect(swapped.fromArtboardId).toBe(toArtboardId);
    expect(swapped.toArtboardId).toBe(artboardId);
    expect(swapped.fromElementId).toBeUndefined();
    expect(swapped.toElementId).toBe(shape.id);
  });

  it("deletes connectors and rejects unknown ids", () => {
    const project = createDefaultProject();
    const next = applyBoardOperation(project, { type: "delete_connector", connectorId: project.connectors[0]!.id });
    expect(next.connectors).toHaveLength(0);
    expect(() => applyBoardOperation(project, { type: "delete_connector", connectorId: "nope" })).toThrow(/not found/i);
  });

  it("delete_artboard removes elements, connectors, and page references", () => {
    const project = createDefaultProject();
    const artboardId = project.artboards[0]!.id;
    const next = applyBoardOperation(project, { type: "delete_artboard", artboardId });
    expect(next.artboards.some((artboard) => artboard.id === artboardId)).toBe(false);
    expect(next.elements.some((element) => element.artboardId === artboardId)).toBe(false);
    expect(next.connectors.some((connector) => connector.fromArtboardId === artboardId || connector.toArtboardId === artboardId)).toBe(false);
    expect(next.pages.every((page) => !page.artboardIds.includes(artboardId))).toBe(true);
  });

  it("lays out an org tree from connectors", () => {
    let project = createDefaultProject();
    const artboardId = project.artboards[0]!.id;
    const root = createElementFromPreset("shape", artboardId, 0, 0);
    const childA = createElementFromPreset("shape", artboardId, 10, 10);
    const childB = createElementFromPreset("shape", artboardId, 20, 20);
    for (const element of [root, childA, childB]) {
      project = applyBoardOperation(project, { type: "add_element", element });
    }
    for (const child of [childA, childB]) {
      project = applyBoardOperation(project, {
        type: "add_connector",
        connector: { id: `conn_${child.id}`, fromArtboardId: artboardId, toArtboardId: artboardId, fromElementId: root.id, toElementId: child.id }
      });
    }
    const next = applyBoardOperation(project, { type: "apply_layout", layout: "tree", elementIds: [root.id, childA.id, childB.id], spacingX: 40, spacingY: 60 });
    const laidRoot = next.elements.find((element) => element.id === root.id)!;
    const laidA = next.elements.find((element) => element.id === childA.id)!;
    const laidB = next.elements.find((element) => element.id === childB.id)!;
    expect(laidA.y).toBe(laidRoot.y + laidRoot.height + 60);
    expect(laidB.y).toBe(laidA.y);
    expect(laidB.x).toBeGreaterThan(laidA.x);
    // Root is centered over its children.
    const childrenCenter = (laidA.x + (laidB.x + laidB.width)) / 2;
    expect(Math.abs(laidRoot.x + laidRoot.width / 2 - childrenCenter)).toBeLessThan(1);
  });

  it("aligns and distributes elements", () => {
    let project = createDefaultProject();
    const artboardId = project.artboards[0]!.id;
    const a = { ...createElementFromPreset("shape", artboardId, 0, 5), width: 50, height: 20 };
    const b = { ...createElementFromPreset("shape", artboardId, 100, 40), width: 50, height: 20 };
    const c = { ...createElementFromPreset("shape", artboardId, 400, 80), width: 50, height: 20 };
    for (const element of [a, b, c]) {
      project = applyBoardOperation(project, { type: "add_element", element });
    }
    const aligned = applyBoardOperation(project, { type: "apply_layout", layout: "align-top", elementIds: [a.id, b.id, c.id], spacingX: 80, spacingY: 64 });
    const ys = [a.id, b.id, c.id].map((id) => aligned.elements.find((element) => element.id === id)!.y);
    expect(new Set(ys).size).toBe(1);

    const distributed = applyBoardOperation(project, { type: "apply_layout", layout: "distribute-horizontal", elementIds: [a.id, b.id, c.id], spacingX: 80, spacingY: 64 });
    const xs = [a.id, b.id, c.id].map((id) => distributed.elements.find((element) => element.id === id)!.x).sort((x1, x2) => x1 - x2);
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!, 5);
  });

  it("flags unknown shape kinds and empty ink strokes as warnings", () => {
    let project = createDefaultProject();
    const artboardId = project.artboards[0]!.id;
    const shape = { ...createElementFromPreset("shape", artboardId, 0, 0), props: { shape: "dodecahedron", text: "?" } };
    const ink = createElementFromPreset("ink", artboardId, 0, 0);
    project = applyBoardOperation(project, { type: "add_element", element: shape });
    project = applyBoardOperation(project, { type: "add_element", element: ink });
    const report = validateBoardStructure(project);
    expect(report.issues.some((issue) => issue.code === "shape-unknown-kind")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "ink-needs-points")).toBe(true);
    expect(report.valid).toBe(true);
  });
});

describe("text-overflows-box", () => {
  const nodeBoard = (text: string, width: number, height: number): BoardProject =>
    BoardProjectSchema.parse({
      ...createDefaultProject(),
      elements: [
        {
          id: "node", type: "shape", name: "Decision", artboardId: "art", parentId: null,
          x: 0, y: 0, width, height, zIndex: 0, locked: false, visible: true,
          style: { fontSize: 14, fontWeight: 600 }, layout: { mode: "absolute" },
          props: { shape: "rounded", text }
        }
      ],
      artboards: [
        { id: "art", name: "Sheet", type: "custom", x: 0, y: 0, width: 900, height: 600,
          background: "#FFFFFF", frameless: true, locked: false, visible: true }
      ],
      pages: [{ id: "page", name: "Page 1", artboardIds: ["art"] }],
      connectors: []
    });

  const codes = (project: BoardProject) => validateBoardStructure(project).issues.map((issue) => issue.code);

  it("stays quiet when the label fits its node", () => {
    expect(codes(nodeBoard("Approve", 200, 80))).not.toContain("text-overflows-box");
  });

  it("fires when the node is too small for its own label", () => {
    expect(codes(nodeBoard("Escalate to the regional compliance review board", 120, 40)))
      .toContain("text-overflows-box");
  });

  it("does not flag a single line in a box sized snug to its glyphs", () => {
    // The real board had 11 of these — a 32px heading in a 40px box, even a 15px letter in an 18px
    // box — all fine on canvas and in export. Charging a full line-height to the first line is wrong.
    const snug = BoardProjectSchema.parse({
      ...createDefaultProject(),
      elements: [
        { id: "t", type: "text", name: "Heading", artboardId: "art", parentId: null,
          x: 0, y: 0, width: 3100, height: 40, zIndex: 0, locked: false, visible: true,
          style: { fontSize: 32, fontWeight: 700 }, layout: { mode: "absolute" },
          props: { text: "AI-Embedded Organization — the operating matrix" } }
      ],
      artboards: [{ id: "art", name: "Sheet", type: "custom", x: 0, y: 0, width: 3200, height: 600,
        background: "#FFFFFF", frameless: true, locked: false, visible: true }],
      pages: [{ id: "page", name: "Page 1", artboardIds: ["art"] }],
      connectors: []
    });
    expect(validateBoardStructure(snug).issues.map((i) => i.code)).not.toContain("text-overflows-box");
  });

  it("says how much height the text actually needs", () => {
    const issue = validateBoardStructure(nodeBoard("Escalate to the regional compliance review board", 120, 40))
      .issues.find((candidate) => candidate.code === "text-overflows-box");
    expect(issue?.message).toMatch(/needs \d+px of height in a 40px box/);
    expect(issue?.severity).toBe("warning");
  });
});

describe("auto-layout (stack)", () => {
  const stackBoard = (
    layout: Record<string, unknown>,
    sizes: Array<{ id: string; width: number; height: number; zIndex: number; visible?: boolean }>
  ): BoardProject =>
    BoardProjectSchema.parse({
      ...createDefaultProject(),
      artboards: [{ id: "art", name: "Sheet", type: "custom", x: 0, y: 0, width: 900, height: 600,
        background: "#FFFFFF", frameless: true, locked: false, visible: true }],
      pages: [{ id: "page", name: "Page 1", artboardIds: ["art"] }],
      connectors: [],
      elements: [
        { id: "frame", type: "frame", name: "Frame", artboardId: "art", parentId: null,
          x: 0, y: 0, width: 300, height: 400, zIndex: 0, locked: false, visible: true,
          style: {}, layout, props: {} },
        ...sizes.map((size) => ({
          id: size.id, type: "shape", name: size.id, artboardId: "art", parentId: "frame",
          x: 999, y: 999, width: size.width, height: size.height, zIndex: size.zIndex,
          locked: false, visible: size.visible ?? true, style: {}, layout: { mode: "absolute" }, props: {}
        }))
      ]
    });

  const frames = (project: BoardProject) =>
    Object.fromEntries(project.elements.filter((e) => e.parentId === "frame").map((e) => [e.id, { x: e.x, y: e.y, w: e.width, h: e.height }]));

  // Every assertion goes through applyBoardOperation, because reflow-on-write at that one chokepoint
  // is the whole design (D-a) — testing the resolver alone would not prove writers get it.
  const settle = (project: BoardProject) => applyBoardOperation(project, { type: "set_selection", selection: [] });

  it("stacks children in a column, ignoring their authored x/y", () => {
    const out = settle(stackBoard({ mode: "stack", direction: "column", gap: 10, padding: 20 }, [
      { id: "a", width: 100, height: 40, zIndex: 0 },
      { id: "b", width: 100, height: 60, zIndex: 1 }
    ]));
    expect(frames(out)).toEqual({
      a: { x: 20, y: 20, w: 100, h: 40 },
      b: { x: 20, y: 70, w: 100, h: 60 }
    });
  });

  it("orders by zIndex, not array order", () => {
    const out = settle(stackBoard({ mode: "stack", direction: "column", gap: 0, padding: 0 }, [
      { id: "a", width: 100, height: 40, zIndex: 5 },
      { id: "b", width: 100, height: 40, zIndex: 1 }
    ]));
    expect(frames(out).b!.y).toBe(0);
    expect(frames(out).a!.y).toBe(40);
  });

  it("gives hidden children no space", () => {
    const out = settle(stackBoard({ mode: "stack", direction: "column", gap: 10, padding: 0 }, [
      { id: "a", width: 100, height: 40, zIndex: 0 },
      { id: "ghost", width: 100, height: 999, zIndex: 1, visible: false },
      { id: "b", width: 100, height: 40, zIndex: 2 }
    ]));
    expect(frames(out).b!.y).toBe(50);
  });

  it("stretches children across the cross axis when asked", () => {
    const out = settle(stackBoard({ mode: "stack", direction: "column", padding: 20, align: "stretch" }, [
      { id: "a", width: 10, height: 40, zIndex: 0 }
    ]));
    expect(frames(out).a).toMatchObject({ x: 20, w: 260 });
  });

  it("spreads the slack across gaps for 'between'", () => {
    // 400 tall, no padding, two 40px rows => 320 of slack lands in the single gap.
    const out = settle(stackBoard({ mode: "stack", direction: "column", padding: 0, justify: "between" }, [
      { id: "a", width: 100, height: 40, zIndex: 0 },
      { id: "b", width: 100, height: 40, zIndex: 1 }
    ]));
    expect(frames(out).a!.y).toBe(0);
    expect(frames(out).b!.y).toBe(360);
  });

  it("lays a row along x instead of y", () => {
    const out = settle(stackBoard({ mode: "stack", direction: "row", gap: 8, padding: 0 }, [
      { id: "a", width: 50, height: 40, zIndex: 0 },
      { id: "b", width: 50, height: 40, zIndex: 1 }
    ]));
    expect(frames(out).b).toMatchObject({ x: 58, y: 0 });
  });

  it("leaves absolute frames completely alone", () => {
    const out = settle(stackBoard({ mode: "absolute" }, [{ id: "a", width: 100, height: 40, zIndex: 0 }]));
    expect(frames(out).a).toMatchObject({ x: 999, y: 999 });
  });

  it("reflows after set_layout, so switching a frame to stack fixes its children immediately", () => {
    const board = stackBoard({ mode: "absolute" }, [
      { id: "a", width: 100, height: 40, zIndex: 0 },
      { id: "b", width: 100, height: 40, zIndex: 1 }
    ]);
    const out = applyBoardOperation(board, { type: "set_layout", elementId: "frame", layout: { mode: "stack", gap: 4, padding: 0 } });
    expect(frames(out).a!.y).toBe(0);
    expect(frames(out).b!.y).toBe(44);
  });

  it("merges a set_layout patch instead of clearing the rest", () => {
    const board = stackBoard({ mode: "stack", direction: "row", gap: 10, padding: 5 }, [{ id: "a", width: 50, height: 40, zIndex: 0 }]);
    const out = applyBoardOperation(board, { type: "set_layout", elementId: "frame", layout: { gap: 20 } });
    const frame = out.elements.find((e) => e.id === "frame")!;
    expect(frame.layout).toMatchObject({ mode: "stack", direction: "row", gap: 20, padding: 5 });
  });

  it("reorders a child in one operation and reflows it into place", () => {
    const board = stackBoard({ mode: "stack", direction: "column", gap: 0, padding: 0 }, [
      { id: "a", width: 100, height: 40, zIndex: 0 },
      { id: "b", width: 100, height: 40, zIndex: 1 },
      { id: "c", width: 100, height: 40, zIndex: 2 }
    ]);
    const out = applyBoardOperation(board, { type: "reorder_child", elementId: "c", toIndex: 0 });
    expect(frames(out).c!.y).toBe(0);
    expect(frames(out).a!.y).toBe(40);
    expect(frames(out).b!.y).toBe(80);
  });

  it("clamps an out-of-range reorder rather than throwing", () => {
    const board = stackBoard({ mode: "stack", direction: "column", gap: 0, padding: 0 }, [
      { id: "a", width: 100, height: 40, zIndex: 0 },
      { id: "b", width: 100, height: 40, zIndex: 1 }
    ]);
    const out = applyBoardOperation(board, { type: "reorder_child", elementId: "a", toIndex: 99 });
    expect(frames(out).a!.y).toBe(40);
  });
});

describe("Comments", () => {
  const boardWithElement = () => {
    const project = createDefaultProject("C", "blank");
    const element = createElementFromPreset("button", project.artboards[0]!.id, 24, 24);
    return { project: applyBoardOperation(project, { type: "add_element", element }), element };
  };

  it("adds a thread anchored to a real element and refuses a missing one", () => {
    const { project, element } = boardWithElement();
    const thread = createCommentThread(element.id, "Make this bigger", "You", "user");
    const out = applyBoardOperation(project, { type: "add_comment", thread });
    expect(out.comments).toHaveLength(1);
    expect(out.comments[0]!.messages[0]!.text).toBe("Make this bigger");
    expect(() =>
      applyBoardOperation(project, { type: "add_comment", thread: createCommentThread("ghost", "hi", "You", "user") })
    ).toThrow(/not found/i);
  });

  it("appends a reply and bumps the thread's updatedAt to the reply's timestamp", () => {
    const { project, element } = boardWithElement();
    const thread = createCommentThread(element.id, "First", "You", "user");
    const withThread = applyBoardOperation(project, { type: "add_comment", thread });
    const message = createCommentMessage("Done — resized it", "Claude", "agent");
    const out = applyBoardOperation(withThread, { type: "reply_comment", threadId: thread.id, message });
    expect(out.comments[0]!.messages.map((m) => m.text)).toEqual(["First", "Done — resized it"]);
    expect(out.comments[0]!.updatedAt).toBe(message.createdAt);
    expect(out.comments[0]!.messages[1]!.authorKind).toBe("agent");
  });

  it("resolves and reopens through the same operation, without auto-reopen on reply", () => {
    const { project, element } = boardWithElement();
    const thread = createCommentThread(element.id, "Check spacing", "You", "user");
    let out = applyBoardOperation(project, { type: "add_comment", thread });
    out = applyBoardOperation(out, { type: "set_comment_resolved", threadId: thread.id, resolved: true });
    expect(out.comments[0]!.resolved).toBe(true);
    out = applyBoardOperation(out, { type: "reply_comment", threadId: thread.id, message: createCommentMessage("late note", "You", "user") });
    expect(out.comments[0]!.resolved).toBe(true);
    out = applyBoardOperation(out, { type: "set_comment_resolved", threadId: thread.id, resolved: false });
    expect(out.comments[0]!.resolved).toBe(false);
  });

  it("deletes a thread and throws for an unknown one", () => {
    const { project, element } = boardWithElement();
    const thread = createCommentThread(element.id, "temp", "You", "user");
    const withThread = applyBoardOperation(project, { type: "add_comment", thread });
    const out = applyBoardOperation(withThread, { type: "delete_comment", threadId: thread.id });
    expect(out.comments).toHaveLength(0);
    expect(() => applyBoardOperation(out, { type: "delete_comment", threadId: thread.id })).toThrow(/not found/i);
  });

  it("comment ops leave the user's selection alone", () => {
    const { project, element } = boardWithElement();
    const selected = applyBoardOperation(project, { type: "set_selection", selection: [element.id] });
    const out = applyBoardOperation(selected, { type: "add_comment", thread: createCommentThread(element.id, "note", "You", "user") });
    expect(out.selection).toEqual([element.id]);
  });

  it("deleting an element (or its ancestor) removes its threads", () => {
    const { project, element } = boardWithElement();
    const child = { ...createElementFromPreset("text", project.artboards[0]!.id, 30, 30), parentId: element.id };
    let out = applyBoardOperation(project, { type: "add_element", element: child });
    out = applyBoardOperation(out, { type: "add_comment", thread: createCommentThread(child.id, "on the child", "You", "user") });
    out = applyBoardOperation(out, { type: "delete_element", elementId: element.id });
    expect(out.comments).toHaveLength(0);
  });

  it("deleting an artboard removes the threads of its elements", () => {
    const { project, element } = boardWithElement();
    const out = applyBoardOperation(project, { type: "add_comment", thread: createCommentThread(element.id, "note", "You", "user") });
    const gone = applyBoardOperation(out, { type: "delete_artboard", artboardId: element.artboardId });
    expect(gone.comments).toHaveLength(0);
  });

  it("duplicating a frame does not clone its feedback", () => {
    const { project, element } = boardWithElement();
    const out = applyBoardOperation(project, { type: "add_comment", thread: createCommentThread(element.id, "original only", "You", "user") });
    const varied = applyBoardOperation(out, { type: "create_variant", sourceArtboardId: element.artboardId });
    expect(varied.comments).toHaveLength(1);
    expect(varied.comments[0]!.elementId).toBe(element.id);
  });

  it("rejects a board whose thread points at a missing element", () => {
    const { project, element } = boardWithElement();
    const out = applyBoardOperation(project, { type: "add_comment", thread: createCommentThread(element.id, "note", "You", "user") });
    const corrupted = { ...structuredClone(out), comments: [{ ...out.comments[0]!, elementId: "ghost" }] };
    expect(() => BoardProjectSchema.parse(corrupted)).toThrow(/Unknown element id/);
  });
});
