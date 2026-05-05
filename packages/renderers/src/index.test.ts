import { describe, expect, it } from "vitest";
import { createDefaultProject } from "@board/schema";
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
});
