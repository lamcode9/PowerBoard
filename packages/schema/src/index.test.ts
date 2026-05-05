import { describe, expect, it } from "vitest";
import { applyBoardOperation, BoardProjectSchema, createDefaultProject, createElementFromPreset } from "./index";

describe("Board schema", () => {
  it("validates the default project", () => {
    const project = createDefaultProject();
    expect(BoardProjectSchema.parse(project).id).toBe("board_default");
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
});
