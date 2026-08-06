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
