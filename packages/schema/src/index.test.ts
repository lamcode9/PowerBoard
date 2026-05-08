import { describe, expect, it } from "vitest";
import { applyBoardOperation, BoardProjectSchema, createDefaultProject, createElementFromPreset, DEVICE_PRESETS } from "./index";

describe("Board schema", () => {
  it("validates the default project", () => {
    const project = createDefaultProject();
    expect(BoardProjectSchema.parse(project).id).toBe("board_default");
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
