import { describe, expect, it } from "vitest";
import { applyBoardOperation, BoardProjectSchema, createDefaultProject, createElementFromPreset, DEVICE_PRESETS, inspectBoardHierarchy, validateBoardStructure } from "./index";

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
