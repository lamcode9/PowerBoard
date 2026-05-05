import type { Artboard, BoardElement, BoardProject } from "@board/schema";

export interface RenderedFile {
  path: string;
  contents: string;
}

export interface ReactTailwindExport {
  files: RenderedFile[];
  summary: string;
}

export function renderReactTailwind(project: BoardProject): ReactTailwindExport {
  const componentFiles = project.artboards.map((artboard) => {
    const componentName = toComponentName(artboard.name);
    return {
      path: `src/screens/${componentName}.tsx`,
      contents: renderArtboardComponent(project, artboard, componentName)
    };
  });

  const indexImports = project.artboards
    .map((artboard) => {
      const componentName = toComponentName(artboard.name);
      return `import { ${componentName} } from "./screens/${componentName}";`;
    })
    .join("\n");

  const previewGrid = project.artboards
    .map((artboard) => {
      const componentName = toComponentName(artboard.name);
      return `        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-600">${escapeText(artboard.name)}</h2>
          <${componentName} />
        </section>`;
    })
    .join("\n");

  const files: RenderedFile[] = [
    {
      path: "src/design-tokens.ts",
      contents: `export const designTokens = ${JSON.stringify(project.tokens, null, 2)} as const;\n`
    },
    ...componentFiles,
    {
      path: "src/BoardPreview.tsx",
      contents: `${indexImports}

export function BoardPreview() {
  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="flex flex-wrap items-start gap-8">
${previewGrid}
      </div>
    </main>
  );
}
`
    }
  ];

  return {
    files,
    summary: `Exported ${project.artboards.length} React/Tailwind screen component${project.artboards.length === 1 ? "" : "s"}.`
  };
}

export function renderSpecMarkdown(project: BoardProject): string {
  const artboards = project.artboards
    .map((artboard) => {
      const elements = project.elements.filter((element) => element.artboardId === artboard.id);
      const elementRows = elements
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((element) => {
          const position = absoluteElementPosition(project, element);
          return `| ${escapePipe(elementPath(project, element))} | ${element.type} | ${escapePipe(element.semanticRole ?? "-")} | ${Math.round(position.x)}, ${Math.round(position.y)} | ${Math.round(element.width)}x${Math.round(element.height)} |`;
        })
        .join("\n");

      return `## ${artboard.name}

- Type: ${artboard.type}
- Size: ${Math.round(artboard.width)}x${Math.round(artboard.height)}
- Background: \`${artboard.background}\`

| Element | Type | Role | Position | Size |
| --- | --- | --- | --- | --- |
${elementRows || "| - | - | - | - | - |"}`;
    })
    .join("\n\n");

  const flows = project.connectors.length
    ? project.connectors
        .map((connector) => {
          const from = project.artboards.find((artboard) => artboard.id === connector.fromArtboardId)?.name ?? connector.fromArtboardId;
          const to = project.artboards.find((artboard) => artboard.id === connector.toArtboardId)?.name ?? connector.toArtboardId;
          return `- ${from} -> ${to}${connector.label ? `: ${connector.label}` : ""}`;
        })
        .join("\n")
    : "- No flows defined yet.";

  return `# ${project.name} Implementation Spec

Generated from Paper.Design.Danny.

## Tokens

- Colors: ${Object.entries(project.tokens.colors).map(([key, value]) => `\`${key}: ${value}\``).join(", ") || "none"}
- Fonts: ${Object.entries(project.tokens.fonts).map(([key, value]) => `\`${key}: ${value}\``).join(", ") || "none"}
- Radii: ${Object.entries(project.tokens.radii).map(([key, value]) => `\`${key}: ${value}px\``).join(", ") || "none"}

## App Flows

${flows}

${artboards}
`;
}

export function renderArtboardSvg(project: BoardProject, artboardId: string): string {
  const artboard = project.artboards.find((candidate) => candidate.id === artboardId);
  if (!artboard) {
    throw new Error(`Artboard not found: ${artboardId}`);
  }
  const elements = project.elements
    .filter((element) => element.artboardId === artboard.id && element.visible && !element.parentId)
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((element) => renderElementSvg(project, element))
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${artboard.width}" height="${artboard.height}" viewBox="0 0 ${artboard.width} ${artboard.height}">
  <rect width="100%" height="100%" fill="${escapeAttr(artboard.background)}"/>
  ${elements}
</svg>`;
}

function renderArtboardComponent(project: BoardProject, artboard: Artboard, componentName: string): string {
  const elements = project.elements
    .filter((element) => element.artboardId === artboard.id && !element.parentId)
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((element) => renderElementJsx(project, element, 3))
    .join("\n");

  return `import { designTokens } from "../design-tokens";

export function ${componentName}() {
  return (
    <div
      data-board-artboard="${artboard.id}"
      className="${joinClasses(["relative overflow-hidden", `w-[${px(artboard.width)}]`, `h-[${px(artboard.height)}]`, roundedForArtboard(artboard), "font-sans text-slate-950 shadow-2xl ring-1 ring-slate-200"])}"
      style={{ background: "${escapeText(artboard.background)}", fontFamily: designTokens.fonts.sans }}
    >
${elements || "      null"}
    </div>
  );
}
`;
}

function renderElementJsx(project: BoardProject, element: BoardElement, depth: number): string {
  const indent = "  ".repeat(depth);
  const children = project.elements
    .filter((child) => child.parentId === element.id)
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((child) => renderElementJsx(project, child, depth + 1))
    .join("\n");
  const style = element.style;
  const hierarchyOnly = isHierarchyOnly(element);
  const wrapperClass = joinClasses([
    "absolute",
    element.layout.mode === "stack" ? "flex" : "",
    element.layout.mode === "stack" && element.layout.direction === "row" ? "flex-row" : "",
    element.layout.mode === "stack" && element.layout.direction !== "row" ? "flex-col" : "",
    element.layout.mode === "grid" ? "grid" : "",
    `left-[${px(element.x)}]`,
    `top-[${px(element.y)}]`,
    `w-[${px(element.width)}]`,
    `h-[${px(element.height)}]`,
    !hierarchyOnly && style.radius !== undefined ? `rounded-[${px(style.radius)}]` : "",
    !hierarchyOnly && style.fill && style.fill !== "transparent" ? `bg-[${style.fill}]` : "",
    !hierarchyOnly && style.color ? `text-[${style.color}]` : "",
    !hierarchyOnly && style.stroke ? `border border-[${style.stroke}]` : "",
    !hierarchyOnly && style.padding !== undefined ? `p-[${px(style.padding)}]` : "",
    !hierarchyOnly && style.paddingX !== undefined ? `px-[${px(style.paddingX)}]` : "",
    !hierarchyOnly && style.paddingY !== undefined ? `py-[${px(style.paddingY)}]` : "",
    !hierarchyOnly && (style.gap !== undefined || element.layout.gap !== undefined) ? `gap-[${px(style.gap ?? element.layout.gap ?? 0)}]` : "",
    style.opacity !== undefined ? `opacity-[${style.opacity}]` : "",
    alignClass(style.align ?? element.layout.align),
    justifyClass(style.justify ?? element.layout.justify),
    textClass(style)
  ]);
  const inlineStyles = inlineStyle(style, hierarchyOnly);

  switch (element.type) {
    case "text":
      return `${indent}<p data-board-element="${element.id}" className="${wrapperClass}"${inlineStyles}>${escapeText(readString(element.props.text, element.name))}</p>`;
    case "button":
      return `${indent}<button data-board-element="${element.id}" className="${joinClasses([wrapperClass, "inline-flex items-center justify-center"])}"${inlineStyles}>${escapeText(readString(element.props.text, "Continue"))}</button>`;
    case "input":
      return `${indent}<label data-board-element="${element.id}" className="${joinClasses([wrapperClass, "flex flex-col justify-center"])}"${inlineStyles}>
${indent}  <span className="text-xs font-semibold opacity-70">${escapeText(readString(element.props.label, "Label"))}</span>
${indent}  <span className="mt-1 text-sm opacity-80">${escapeText(readString(element.props.placeholder, "Placeholder"))}</span>
${indent}</label>`;
    case "card":
      return `${indent}<article data-board-element="${element.id}" className="${joinClasses([wrapperClass, "flex flex-col justify-center"])}"${inlineStyles}>
${indent}  <p className="text-xs font-bold uppercase tracking-wide opacity-60">${escapeText(readString(element.props.eyebrow, "Metric"))}</p>
${indent}  <h3 className="mt-2 text-3xl font-black">${escapeText(readString(element.props.title, "Card title"))}</h3>
${indent}  <p className="mt-1 text-sm opacity-70">${escapeText(readString(element.props.subtitle, "Supporting detail"))}</p>
${children ? `\n${children}` : ""}
${indent}</article>`;
    case "dialog":
    case "sheet":
      return `${indent}<section data-board-element="${element.id}" className="${wrapperClass}"${inlineStyles}>
${indent}  <h3 className="text-xl font-black">${escapeText(readString(element.props.title, element.type === "sheet" ? "Sheet" : "Dialog"))}</h3>
${indent}  <p className="mt-3 text-sm leading-6 opacity-70">${escapeText(readString(element.props.body, "Body copy"))}</p>
${indent}  <button className="mt-6 h-11 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white">${escapeText(readString(element.props.action, "Continue"))}</button>
${children ? `\n${children}` : ""}
${indent}</section>`;
    case "list":
      return `${indent}<section data-board-element="${element.id}" className="${wrapperClass}"${inlineStyles}>
${indent}  <h3 className="text-sm font-black">${escapeText(readString(element.props.title, "List"))}</h3>
${renderListItems(element, indent)}
${indent}</section>`;
    case "table":
      return `${indent}<section data-board-element="${element.id}" className="${wrapperClass}"${inlineStyles}>
${indent}  <h3 className="text-sm font-black">${escapeText(readString(element.props.title, "Table"))}</h3>
${renderTable(element, indent)}
${indent}</section>`;
    case "nav":
    case "tabbar":
      return `${indent}<nav data-board-element="${element.id}" className="${joinClasses([wrapperClass, "flex items-center"])}"${inlineStyles}>
${indent}  <strong>${escapeText(readString(element.props.title, element.type === "tabbar" ? "Tabs" : "Navigation"))}</strong>
${indent}  <div className="ml-auto flex gap-3 text-sm opacity-75">${readStringArray(element.props.items, ["Home", "Settings"]).map((item) => `<span>${escapeText(item)}</span>`).join("")}</div>
${indent}</nav>`;
    case "chart":
      return `${indent}<section data-board-element="${element.id}" className="${wrapperClass}"${inlineStyles}>
${indent}  <h3 className="text-sm font-black">${escapeText(readString(element.props.title, "Chart"))}</h3>
${indent}  <div className="mt-5 flex h-[120px] items-end gap-3">
${readNumberArray(element.props.values, [30, 50, 80]).map((value) => `${indent}    <div className="flex-1 rounded-t-lg bg-blue-500" style={{ height: "${Math.max(8, Math.min(100, value))}%" }} />`).join("\n")}
${indent}  </div>
${indent}</section>`;
    case "paywall":
      return `${indent}<section data-board-element="${element.id}" className="${wrapperClass}"${inlineStyles}>
${indent}  <p className="text-xs font-black uppercase text-blue-600">Pro</p>
${indent}  <h2 className="mt-2 text-3xl font-black">${escapeText(readString(element.props.title, "Go Pro"))}</h2>
${indent}  <p className="mt-2 text-xl font-black">${escapeText(readString(element.props.price, "$4.99/mo"))}</p>
${indent}  <ul className="mt-6 space-y-3 text-sm">${readStringArray(element.props.features, ["Feature"]).map((feature) => `<li>✓ ${escapeText(feature)}</li>`).join("")}</ul>
${indent}  <button className="mt-7 h-12 w-full rounded-2xl bg-slate-950 text-sm font-black text-white">${escapeText(readString(element.props.action, "Start"))}</button>
${indent}</section>`;
    case "badge":
      return `${indent}<span data-board-element="${element.id}" className="${joinClasses([wrapperClass, "inline-flex items-center justify-center"])}"${inlineStyles}>${escapeText(readString(element.props.text, "Badge"))}</span>`;
    case "sticky":
      return `${indent}<p data-board-element="${element.id}" className="${wrapperClass}"${inlineStyles}>${escapeText(readString(element.props.text, "Note"))}</p>`;
    case "image":
    case "screenshotOverlay": {
      const asset = project.assets.find((candidate) => candidate.id === element.props.assetId);
      if (!asset) {
        return `${indent}<div data-board-element="${element.id}" className="${joinClasses([wrapperClass, "grid place-items-center text-xs text-slate-500"])}"${inlineStyles}>${element.type === "screenshotOverlay" ? "Screenshot overlay" : "Image"}</div>`;
      }
      return `${indent}<img data-board-element="${element.id}" className="${joinClasses([wrapperClass, "object-cover"])}" src="${asset.src}" alt="${escapeText(readString(element.props.alt, asset.name))}"${inlineStyles} />`;
    }
    default:
      return `${indent}<div data-board-element="${element.id}" className="${wrapperClass}"${inlineStyles}>${children}</div>`;
  }
}

function renderListItems(element: BoardElement, indent: string): string {
  const items = readStringArray(element.props.items, ["First item", "Second item", "Third item"]);
  return `${indent}  <div className="mt-4 divide-y divide-slate-200">
${items.map((item) => `${indent}    <div className="py-3 text-sm font-medium">${escapeText(item)}</div>`).join("\n")}
${indent}  </div>`;
}

function renderTable(element: BoardElement, indent: string): string {
  const columns = readStringArray(element.props.columns, ["Name", "Status"]);
  const rows = Array.isArray(element.props.rows) ? element.props.rows : [];
  return `${indent}  <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
${indent}    <div className="grid bg-slate-50 text-xs font-black uppercase text-slate-500" style={{ gridTemplateColumns: "repeat(${columns.length}, minmax(0, 1fr))" }}>
${columns.map((column) => `${indent}      <div className="px-3 py-2">${escapeText(column)}</div>`).join("\n")}
${indent}    </div>
${rows
  .map((row) => {
    const cells = Array.isArray(row) ? row : [];
    return `${indent}    <div className="grid border-t border-slate-200 text-sm" style={{ gridTemplateColumns: "repeat(${columns.length}, minmax(0, 1fr))" }}>
${columns.map((_, index) => `${indent}      <div className="px-3 py-3">${escapeText(readString(cells[index], "-"))}</div>`).join("\n")}
${indent}    </div>`;
  })
  .join("\n")}
${indent}  </div>`;
}

function renderElementSvg(project: BoardProject, element: BoardElement, offsetX = 0, offsetY = 0): string {
  const x = offsetX + element.x;
  const y = offsetY + element.y;
  const fill = element.style.fill ?? "transparent";
  const stroke = element.style.stroke ?? "none";
  const radius = element.style.radius ?? 0;
  const opacity = element.style.opacity ?? 1;
  const color = element.style.color ?? "#111827";
  const fontSize = element.style.fontSize ?? 14;
  const children = project.elements
    .filter((child) => child.parentId === element.id && child.visible)
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((child) => renderElementSvg(project, child, x, y))
    .join("");

  switch (element.type) {
    case "frame":
    case "group":
      return `<g opacity="${opacity}">${isHierarchyOnly(element) ? "" : `<rect x="${x}" y="${y}" width="${element.width}" height="${element.height}" rx="${radius}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${element.style.strokeWidth ?? 0}"/>`}${children}</g>`;
    case "text":
      return `<text x="${x}" y="${y + fontSize}" width="${element.width}" fill="${escapeAttr(color)}" font-size="${fontSize}" font-weight="${escapeAttr(String(element.style.fontWeight ?? 600))}">${escapeXml(readString(element.props.text, element.name))}</text>`;
    case "button":
    case "badge":
      return `<g opacity="${opacity}"><rect x="${x}" y="${y}" width="${element.width}" height="${element.height}" rx="${radius}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}"/><text x="${x + element.width / 2}" y="${y + element.height / 2 + fontSize / 3}" fill="${escapeAttr(color)}" font-size="${fontSize}" font-weight="700" text-anchor="middle">${escapeXml(readString(element.props.text, element.name))}</text>${children}</g>`;
    case "chart": {
      const values = readNumberArray(element.props.values, [20, 48, 34, 72, 55]);
      const bars = values
        .map((value, index) => {
          const gap = 10;
          const barWidth = (element.width - 36 - gap * (values.length - 1)) / values.length;
          const barHeight = Math.max(10, (element.height - 72) * (value / 100));
          const barX = x + 18 + index * (barWidth + gap);
          const barY = y + element.height - 24 - barHeight;
          return `<rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="6" fill="#3B82F6"/>`;
        })
        .join("");
      return `<g opacity="${opacity}"><rect x="${x}" y="${y}" width="${element.width}" height="${element.height}" rx="${radius}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}"/><text x="${x + 18}" y="${y + 32}" fill="${escapeAttr(color)}" font-size="14" font-weight="800">${escapeXml(readString(element.props.title, "Chart"))}</text>${bars}${children}</g>`;
    }
    case "image":
    case "screenshotOverlay": {
      const asset = project.assets.find((candidate) => candidate.id === element.props.assetId);
      const image = asset ? `<image href="${escapeAttr(asset.src)}" x="${x}" y="${y}" width="${element.width}" height="${element.height}" preserveAspectRatio="xMidYMid slice" opacity="${opacity}"/>` : "";
      return `<g><rect x="${x}" y="${y}" width="${element.width}" height="${element.height}" rx="${radius}" fill="${escapeAttr(fill || "#E2E8F0")}" stroke="${escapeAttr(stroke)}" opacity="${opacity}"/>${image}<text x="${x + element.width / 2}" y="${y + element.height / 2}" fill="#64748B" font-size="13" text-anchor="middle">${asset ? "" : escapeXml(element.type === "screenshotOverlay" ? "Screenshot overlay" : "Image")}</text>${children}</g>`;
    }
    default:
      return `<g opacity="${opacity}"><rect x="${x}" y="${y}" width="${element.width}" height="${element.height}" rx="${radius}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}"/><text x="${x + 18}" y="${y + 32}" fill="${escapeAttr(color)}" font-size="${fontSize}" font-weight="800">${escapeXml(readString(element.props.title ?? element.props.text ?? element.name, element.name))}</text>${renderSecondarySvgLines(element, x, y)}${children}</g>`;
  }
}

function renderSecondarySvgLines(element: BoardElement, x: number, y: number): string {
  const subtitle = readString(element.props.subtitle ?? element.props.body ?? element.props.price, "");
  if (!subtitle) {
    return "";
  }
  return `<text x="${x + 18}" y="${y + 58}" fill="${escapeAttr(element.style.color ?? "#64748B")}" opacity="0.7" font-size="13">${escapeXml(subtitle)}</text>`;
}

function absoluteElementPosition(project: BoardProject, element: BoardElement): { x: number; y: number } {
  let x = element.x;
  let y = element.y;
  let parentId = element.parentId;
  while (parentId) {
    const parent = project.elements.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    x += parent.x;
    y += parent.y;
    parentId = parent.parentId;
  }
  return { x, y };
}

function elementPath(project: BoardProject, element: BoardElement): string {
  const parts = [element.name];
  let parentId = element.parentId;
  while (parentId) {
    const parent = project.elements.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    parts.unshift(parent.name);
    parentId = parent.parentId;
  }
  return parts.join(" > ");
}

function inlineStyle(style: BoardElement["style"], hierarchyOnly = false): string {
  const declarations: string[] = [];
  if (!hierarchyOnly && style.shadow) declarations.push(`boxShadow: "${style.shadow}"`);
  if (!hierarchyOnly && style.strokeWidth !== undefined) declarations.push(`borderWidth: "${px(style.strokeWidth)}"`);
  if (!hierarchyOnly && style.blur !== undefined) declarations.push(`backdropFilter: "blur(${px(style.blur)})"`);
  if (style.lineHeight !== undefined) declarations.push(`lineHeight: "${px(style.lineHeight)}"`);
  if (style.fontFamily) declarations.push(`fontFamily: "${style.fontFamily}"`);
  if (style.letterSpacing !== undefined) declarations.push(`letterSpacing: "${px(style.letterSpacing)}"`);
  return declarations.length ? ` style={{ ${declarations.join(", ")} }}` : "";
}

function isHierarchyOnly(element: BoardElement): boolean {
  return (element.type === "frame" || element.type === "group") && element.props.hierarchyOnly === true;
}

function textClass(style: BoardElement["style"]): string {
  return joinClasses([
    style.fontSize !== undefined ? `text-[${px(style.fontSize)}]` : "",
    style.fontWeight !== undefined ? `font-[${style.fontWeight}]` : "",
    style.textAlign ? `text-${style.textAlign}` : ""
  ]);
}

function alignClass(value?: string): string {
  if (!value) return "";
  return ({ start: "items-start", center: "items-center", end: "items-end", stretch: "items-stretch" } as Record<string, string>)[value] ?? "";
}

function justifyClass(value?: string): string {
  if (!value) return "";
  return ({ start: "justify-start", center: "justify-center", end: "justify-end", between: "justify-between" } as Record<string, string>)[value] ?? "";
}

function roundedForArtboard(artboard: Artboard): string {
  return artboard.type === "mobile" ? "rounded-[46px]" : artboard.type === "tablet" ? "rounded-[30px]" : "rounded-[20px]";
}

function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

function joinClasses(classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;
}

function readNumberArray(value: unknown, fallback: number[]): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : fallback;
}

function toComponentName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  const component = cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return component || "BoardScreen";
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/{/g, "&#123;").replace(/}/g, "&#125;");
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeXml(value);
}

function escapePipe(value: string): string {
  return value.replace(/\|/g, "\\|");
}
