import { describe, expect, it } from "vitest";
import { BoardProjectSchema, createDefaultProject, createElementFromPreset } from "@powerboard/schema";
import { renderArtboardReactTailwind, renderArtboardSvg, renderReactTailwind, renderScene, renderSelectionSvg, renderSpecMarkdown } from "./index";

describe("renderers", () => {
  it("exports readable React/Tailwind files", () => {
    const project = createDefaultProject();
    const result = renderReactTailwind(project);
    expect(result.files.some((file) => file.path.endsWith("MobileHome.tsx"))).toBe(true);
    expect(result.files.map((file) => file.contents).join("\n")).toContain("data-board-element");
    expect(result.summary).toContain("React/Tailwind");
  });

  it("exports a markdown implementation spec", () => {
    const spec = renderSpecMarkdown(createDefaultProject());
    expect(spec).toContain("Implementation Spec");
    expect(spec).toContain("App Flows");
  });

  it("exports one artboard React/Tailwind component for handoff", () => {
    const project = createDefaultProject();
    const file = renderArtboardReactTailwind(project, project.artboards[0]!.id);

    expect(file.path).toBe("src/screens/MobileHome.tsx");
    expect(file.contents).toContain("export function MobileHome");
    expect(file.contents).toContain("data-board-artboard=\"art_home_mobile\"");
    expect(file.contents).not.toContain("Web Dashboard");
  });

  it("renders a nonblank SVG artboard", () => {
    const project = createDefaultProject();
    const svg = renderArtboardSvg(project, project.artboards[0]!.id);
    expect(svg).toContain("<svg");
    expect(svg).toContain("Add transaction");
  });

  it("drops the backdrop rect when the scene is exported transparent", () => {
    const project = createDefaultProject();
    const opaque = renderArtboardSvg(project, project.artboards[0]!.id);
    const transparent = renderArtboardSvg(project, project.artboards[0]!.id, { background: "transparent" });

    expect(opaque).toContain('width="100%"');
    expect(transparent).not.toContain('width="100%"');
    expect(transparent).toContain("Add transaction");
  });

  it("crops a selection to its own bounds and keeps the element's own artwork", () => {
    const project = createDefaultProject();
    const element = project.elements.find((candidate) => candidate.parentId === undefined || candidate.parentId === null)!;
    const svg = renderSelectionSvg(project, [element.id]);
    const width = Number(svg.match(/\swidth="([\d.]+)"/)![1]);
    const height = Number(svg.match(/\sheight="([\d.]+)"/)![1]);

    // 32px of padding on each side of the element, and nothing like the full artboard.
    expect(width).toBe(Math.round(element.width) + 64);
    expect(height).toBe(Math.round(element.height) + 64);
    // Cropped, not a full artboard: the frame is many times taller than one element plus padding.
    expect(height).toBeLessThan(project.artboards[0]!.height / 2);
  });

  it("renders a selected frame whole and reports its true size through renderScene", () => {
    const project = createDefaultProject();
    const artboard = project.artboards[0]!;
    const scene = renderScene(project, { scope: "artboard", artboardId: artboard.id });

    expect(scene.width).toBe(Math.round(artboard.width));
    expect(scene.height).toBe(Math.round(artboard.height));
    expect(scene.name).toBe(artboard.name);

    const page = renderScene(project, { scope: "page" });
    expect(page.width).toBeGreaterThan(scene.width);
    expect(page.svg).toContain("<svg");
  });

  it("refuses an empty selection instead of producing a blank image", () => {
    expect(() => renderSelectionSvg(createDefaultProject(), [])).toThrow(/Select a frame or element/);
  });

  it("exports icon, line, and sparkline primitives across SVG, spec, and React", () => {
    const project = createPrimitiveProject();
    const svg = renderArtboardSvg(project, project.artboards[0]!.id);
    const spec = renderSpecMarkdown(project);
    const react = renderReactTailwind(project).files.map((file) => file.contents).join("\n");

    expect(svg).toContain("<line");
    expect(svg).toContain("<polyline");
    expect(svg).toContain("viewBox=\"0 0 24 24\"");
    expect(spec).toContain("| Mobile Home / Material Search Icon | icon | material icon |");
    expect(spec).toContain("| Mobile Home / Revenue Sparkline | sparkline | sparkline chart |");
    expect(react).toContain("aria-label=\"Search\"");
    expect(react).toContain("<polyline");
    expect(react).toContain("strokeLinecap=\"round\"");
  });
});

function createPrimitiveProject() {
  const project = createDefaultProject();
  const artboardId = project.artboards[0]!.id;
  const icon = createElementFromPreset("icon", artboardId, 42, 42);
  icon.name = "Mobile Home / Material Search Icon";
  icon.props.materialIcon = "search";
  icon.props.label = "Search";
  const line = createElementFromPreset("line", artboardId, 32, 112);
  line.name = "Mobile Home / Section Divider";
  const sparkline = createElementFromPreset("sparkline", artboardId, 42, 152);
  sparkline.name = "Mobile Home / Revenue Sparkline";
  return BoardProjectSchema.parse({ ...project, elements: [...project.elements, icon, line, sparkline] });
}

describe("SVG text wrapping (canvas/export parity)", () => {
  // The canvas draws element text as a <span> in a sized box, so CSS wraps it. SVG has no wrapping and
  // the sharp/librsvg raster path ignores <foreignObject>, so the exporter has to wrap explicitly —
  // otherwise long labels look right on screen and bleed out of the node in every PNG and SVG.
  const boardWithNode = (text: string, width: number, height: number) => {
    const project = BoardProjectSchema.parse(createDefaultProject());
    const artboard = project.artboards[0]!;
    project.elements = [
      {
        id: "node", type: "shape", name: "Node", artboardId: artboard.id, parentId: null,
        x: 20, y: 20, width, height, zIndex: 0, locked: false, visible: true,
        style: { fill: "#FFFFFF", stroke: "#94A3B8", fontSize: 14, fontWeight: 600 },
        layout: { mode: "absolute" }, props: { shape: "rounded", text }
      } as never
    ];
    return { project, artboardId: artboard.id };
  };

  it("breaks a long node label into several tspans", () => {
    const { project, artboardId } = boardWithNode("Customer support escalation queue", 160, 90);
    const svg = renderArtboardSvg(project, artboardId);
    expect((svg.match(/<tspan/g) ?? []).length).toBeGreaterThan(1);
    expect(svg).not.toContain(">Customer support escalation queue<");
  });

  it("keeps a short label on one line", () => {
    const { project, artboardId } = boardWithNode("Queue", 160, 90);
    const svg = renderArtboardSvg(project, artboardId);
    expect((svg.match(/<tspan/g) ?? []).length).toBe(1);
    expect(svg).toContain(">Queue</tspan>");
  });

  it("emits no width attribute on <text> — SVG 1.1 ignores it, which is why this bug existed", () => {
    const { project, artboardId } = boardWithNode("Queue", 160, 90);
    expect(renderArtboardSvg(project, artboardId)).not.toMatch(/<text[^>]*\swidth=/);
  });

  it("centres a wrapped label as one block, not on the first line", () => {
    const { project, artboardId } = boardWithNode("Customer support escalation queue", 160, 90);
    const svg = renderArtboardSvg(project, artboardId);
    const ys = [...svg.matchAll(/<tspan x="[^"]*" y="([\d.]+)"/g)].map((match) => Number(match[1]));
    expect(ys.length).toBeGreaterThan(1);
    // Node spans y 20..110, centre 65. The line block should straddle it.
    const first = ys[0]!;
    const last = ys[ys.length - 1]!;
    expect(first).toBeLessThan(65);
    expect(last).toBeGreaterThan(65);
  });
});

describe("React/Tailwind flow output for stack frames", () => {
  // The bug this feature exists to fix: the renderer emitted `flex flex-col gap-[12px]` on a parent
  // whose every child was `absolute`, and CSS removes absolute children from flex flow — so the
  // classes were decoration. A stack parent must produce children that actually flow.
  const stackProject = () => {
    const project = BoardProjectSchema.parse(createDefaultProject());
    const artboard = project.artboards[0]!;
    const base = {
      artboardId: artboard.id, locked: false, visible: true, style: {}, props: {},
      layout: { mode: "absolute" as const }
    };
    project.elements = [
      { ...base, id: "frame", type: "frame", name: "List", parentId: null, x: 20, y: 20, width: 300, height: 200, zIndex: 0,
        layout: { mode: "stack" as const, direction: "column" as const, gap: 12, padding: 16 } },
      { ...base, id: "row1", type: "shape", name: "Row 1", parentId: "frame", x: 16, y: 16, width: 268, height: 40, zIndex: 0 },
      { ...base, id: "row2", type: "shape", name: "Row 2", parentId: "frame", x: 16, y: 68, width: 268, height: 40, zIndex: 1 }
    ] as never;
    return { project, artboardId: artboard.id };
  };

  const classesFor = (jsx: string, id: string) =>
    jsx.match(new RegExp(`data-board-element="${id}" className="([^"]*)"`))?.[1] ?? "";

  it("puts the parent in flex flow with its gap and padding", () => {
    const { project, artboardId } = stackProject();
    const classes = classesFor(renderArtboardReactTailwind(project, artboardId).contents, "frame");
    expect(classes).toContain("flex");
    expect(classes).toContain("flex-col");
    expect(classes).toContain("gap-[12px]");
    expect(classes).toContain("p-[16px]");
  });

  it("takes children OUT of absolute positioning so the flex actually applies", () => {
    const { project, artboardId } = stackProject();
    const jsx = renderArtboardReactTailwind(project, artboardId).contents;
    for (const id of ["row1", "row2"]) {
      const classes = classesFor(jsx, id);
      expect(classes).not.toContain("absolute");
      expect(classes).not.toMatch(/left-\[/);
      expect(classes).not.toMatch(/top-\[/);
      expect(classes).toContain("w-[268px]");
    }
  });

  it("leaves children of an absolute parent absolutely positioned", () => {
    const { project, artboardId } = stackProject();
    project.elements[0]!.layout = { mode: "absolute" };
    const classes = classesFor(renderArtboardReactTailwind(project, artboardId).contents, "row1");
    expect(classes).toContain("absolute");
    expect(classes).toMatch(/left-\[/);
  });

  it("keeps an escaped child absolutely positioned inside a flex parent", () => {
    // The overlay case: a badge on top of a stacked card. It must NOT lose left/top, or it collapses
    // into the flow it was explicitly taken out of.
    const { project, artboardId } = stackProject();
    project.elements[2]!.layout = { mode: "absolute", position: "absolute" };
    const jsx = renderArtboardReactTailwind(project, artboardId).contents;
    const escaped = classesFor(jsx, "row2");
    expect(escaped).toContain("absolute");
    expect(escaped).toMatch(/left-\[/);
    expect(escaped).toMatch(/top-\[/);
    // its flowing sibling is unaffected
    expect(classesFor(jsx, "row1")).not.toContain("absolute");
  });

  it("never emits a duplicated layout class", () => {
    const jsx = renderReactTailwind(createDefaultProject()).files.map((file) => file.contents).join("\n");
    for (const className of jsx.match(/className="[^"]*"/g) ?? []) {
      const tokens = className.slice(11, -1).split(/\s+/).filter(Boolean);
      expect(new Set(tokens).size).toBe(tokens.length);
    }
  });
});
