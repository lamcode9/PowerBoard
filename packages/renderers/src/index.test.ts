import { describe, expect, it } from "vitest";
import { BoardProjectSchema, createDefaultProject, createElementFromPreset } from "@powerboard/schema";
import { renderArtboardSvg, renderReactTailwind, renderSpecMarkdown } from "./index";

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

  it("renders a nonblank SVG artboard", () => {
    const project = createDefaultProject();
    const svg = renderArtboardSvg(project, project.artboards[0]!.id);
    expect(svg).toContain("<svg");
    expect(svg).toContain("Add transaction");
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
