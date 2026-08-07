import {
  arrowheadIsFilled,
  arrowheadPath,
  connectorAnchorSlots,
  connectorEndpointRect,
  connectorGeometry,
  connectorLabelPoint,
  connectorLabelWidth,
  connectorObstacles,
  readPointArray,
  strokeDashPattern,
  textAdvanceWidth,
  wrapTextToWidth,
  type AnchorSlot,
  type Artboard,
  type BoardConnector,
  type BoardElement,
  type BoardProject,
  type Rect
} from "@powerboard/schema";

export interface RenderedFile {
  path: string;
  contents: string;
}

export interface ReactTailwindExport {
  files: RenderedFile[];
  summary: string;
}

export function renderReactTailwind(project: BoardProject): ReactTailwindExport {
  const componentFiles = project.artboards.map((artboard) => renderArtboardReactTailwind(project, artboard.id));

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

export function renderArtboardReactTailwind(project: BoardProject, artboardId: string): RenderedFile {
  const artboard = project.artboards.find((candidate) => candidate.id === artboardId);
  if (!artboard) {
    throw new Error(`Artboard not found: ${artboardId}`);
  }
  const componentName = toComponentName(artboard.name);
  return {
    path: `src/screens/${componentName}.tsx`,
    contents: renderArtboardComponent(project, artboard, componentName)
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

Generated from PowerBoard.

## Tokens

- Colors: ${Object.entries(project.tokens.colors).map(([key, value]) => `\`${key}: ${value}\``).join(", ") || "none"}
- Fonts: ${Object.entries(project.tokens.fonts).map(([key, value]) => `\`${key}: ${value}\``).join(", ") || "none"}
- Radii: ${Object.entries(project.tokens.radii).map(([key, value]) => `\`${key}: ${value}px\``).join(", ") || "none"}

## App Flows

${flows}

${artboards}
`;
}

/** Background override for any scene render. `"transparent"` omits the backdrop rect entirely. */
export interface SceneOptions {
  background?: string;
  padding?: number;
}

export function renderArtboardSvg(project: BoardProject, artboardId: string, options: SceneOptions = {}): string {
  const artboard = project.artboards.find((candidate) => candidate.id === artboardId);
  if (!artboard) {
    throw new Error(`Artboard not found: ${artboardId}`);
  }
  const elements = project.elements
    .filter((element) => element.artboardId === artboard.id && element.visible && !element.parentId)
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((element) => renderElementSvg(project, element))
    .join("\n");

  // Connectors are page-level objects, but a diagram exported without its edges is not a diagram.
  // Draw every connector that lives entirely inside this artboard, shifted into artboard-local space.
  const slots = connectorAnchorSlots(project);
  const connectors = project.connectors
    .filter((connector) => connector.fromArtboardId === artboard.id && connector.toArtboardId === artboard.id)
    .map((connector) => renderConnectorSvg(project, connector, slots.get(connector.id), { x: -artboard.x, y: -artboard.y }))
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${artboard.width}" height="${artboard.height}" viewBox="0 0 ${artboard.width} ${artboard.height}">
  ${backdropRect(0, 0, options.background ?? artboard.background)}
  ${elements}
  ${connectors}
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
  // A child of a `stack` parent is laid out by flow, so it must NOT be absolutely positioned — an
  // absolute child is removed from flex layout, which is precisely why the gap/align/justify classes
  // this renderer already emitted did nothing at all.
  const parent = element.parentId ? project.elements.find((candidate) => candidate.id === element.parentId) : undefined;
  const inFlow = parent?.layout.mode === "stack";
  const stack = element.layout.mode === "stack";
  const wrapperClass = joinClasses([
    inFlow ? "" : "absolute",
    stack ? "flex" : "",
    stack && element.layout.direction === "row" ? "flex-row" : "",
    stack && element.layout.direction !== "row" ? "flex-col" : "",
    element.layout.mode === "grid" ? "grid" : "",
    inFlow ? "" : `left-[${px(element.x)}]`,
    inFlow ? "" : `top-[${px(element.y)}]`,
    `w-[${px(element.width)}]`,
    `h-[${px(element.height)}]`,
    stack && element.layout.padding !== undefined ? `p-[${px(element.layout.padding)}]` : "",
    !hierarchyOnly && style.radius !== undefined ? `rounded-[${px(style.radius)}]` : "",
    !hierarchyOnly && style.fill && style.fill !== "transparent" ? `bg-[${style.fill}]` : "",
    !hierarchyOnly && style.color ? `text-[${style.color}]` : "",
    !hierarchyOnly && style.stroke ? `border border-[${style.stroke}]` : "",
    !hierarchyOnly && style.stroke && style.strokeStyle && style.strokeStyle !== "solid" ? `border-${style.strokeStyle}` : "",
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
    case "icon":
      return `${indent}<div data-board-element="${element.id}" className="${joinClasses([wrapperClass, "grid place-items-center"])}"${inlineStyles}>
${indent}  <svg viewBox="0 0 24 24" role="img" aria-label="${escapeAttr(readString(element.props.label, readString(element.props.materialIcon ?? element.props.icon, "Icon")))}" className="h-full w-full p-[22%]" fill="currentColor">
${indent}    ${materialIconSvgMarkup(readString(element.props.materialIcon ?? element.props.icon, "add_circle"))}
${indent}  </svg>
${indent}</div>`;
    case "line": {
      const points = linePrimitivePoints(readString(element.props.direction, "horizontal"));
      return `${indent}<svg data-board-element="${element.id}" className="${wrapperClass}" viewBox="0 0 100 100" preserveAspectRatio="none"${inlineStyles}>
${indent}  <line x1="${points.x1}" y1="${points.y1}" x2="${points.x2}" y2="${points.y2}" stroke="${escapeAttr(style.stroke ?? "#64748B")}" strokeWidth="${style.strokeWidth ?? 2}" strokeLinecap="${escapeAttr(readString(element.props.lineCap, "round"))}" vectorEffect="non-scaling-stroke" />
${indent}</svg>`;
    }
    case "sparkline": {
      const points = sparklinePoints(readNumberArray(element.props.values, [24, 38, 32, 58, 48, 72, 66]), 100, 100, 8);
      const stroke = style.stroke ?? style.color ?? "#44403C";
      return `${indent}<svg data-board-element="${element.id}" className="${wrapperClass}" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="${escapeAttr(readString(element.props.label, "Sparkline"))}"${inlineStyles}>
${element.props.showArea === true ? `${indent}  <polygon points="8,100 ${points} 92,100" fill="${escapeAttr(stroke)}" opacity="0.12" />\n` : ""}${indent}  <polyline points="${points}" fill="none" stroke="${escapeAttr(stroke)}" strokeWidth="${style.strokeWidth ?? 3}" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
${indent}</svg>`;
    }
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
  const fontFamily = escapeAttr(svgFontFamily(project, element));
  const dash = strokeDashPattern(element.style.strokeStyle, element.style.strokeWidth ?? 1);
  const dashAttr = dash ? ` stroke-dasharray="${dash.dashArray}"` : "";
  const children = project.elements
    .filter((child) => child.parentId === element.id && child.visible)
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((child) => renderElementSvg(project, child, x, y))
    .join("");

  switch (element.type) {
    case "frame":
    case "group":
      return `<g opacity="${opacity}">${isHierarchyOnly(element) ? "" : `<rect x="${x}" y="${y}" width="${element.width}" height="${element.height}" rx="${radius}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${element.style.strokeWidth ?? 0}"${dashAttr}/>`}${children}</g>`;
    case "text": {
      const { textX, textAnchor } = svgTextAlignment(element, x);
      return svgTextBlock(readString(element.props.text, element.name), {
        x: textX,
        baseline: y + fontSize,
        width: element.width,
        maxHeight: element.height,
        fontSize,
        fontFamily,
        fontWeight: Number(element.style.fontWeight ?? 600),
        fill: color,
        anchor: textAnchor as "start" | "middle" | "end",
        lineHeight: element.style.lineHeight ? element.style.lineHeight / fontSize : undefined
      });
    }
    case "icon": {
      const size = Math.min(element.width, element.height) * 0.56;
      const iconX = x + (element.width - size) / 2;
      const iconY = y + (element.height - size) / 2;
      return `<g opacity="${opacity}"><rect x="${x}" y="${y}" width="${element.width}" height="${element.height}" rx="${radius}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}" stroke-width="${element.style.strokeWidth ?? 0}"/><svg x="${iconX}" y="${iconY}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${escapeAttr(color)}">${materialIconSvgMarkup(readString(element.props.materialIcon ?? element.props.icon, "add_circle"))}</svg>${children}</g>`;
    }
    case "line": {
      const points = linePrimitivePoints(readString(element.props.direction, "horizontal"));
      const x1 = x + (points.x1 / 100) * element.width;
      const y1 = y + (points.y1 / 100) * element.height;
      const x2 = x + (points.x2 / 100) * element.width;
      const y2 = y + (points.y2 / 100) * element.height;
      return `<g opacity="${opacity}"><line x1="${roundForSvg(x1)}" y1="${roundForSvg(y1)}" x2="${roundForSvg(x2)}" y2="${roundForSvg(y2)}" stroke="${escapeAttr(element.style.stroke ?? color)}" stroke-width="${element.style.strokeWidth ?? 2}" stroke-linecap="${escapeAttr(readString(element.props.lineCap, "round"))}"/>${children}</g>`;
    }
    case "sparkline": {
      const values = readNumberArray(element.props.values, [24, 38, 32, 58, 48, 72, 66]);
      const points = sparklinePoints(values, element.width, element.height, Math.min(12, Math.max(4, element.height * 0.1)), x, y);
      const strokeColor = element.style.stroke ?? color;
      const areaPoints = `${roundForSvg(x)},${roundForSvg(y + element.height)} ${points} ${roundForSvg(x + element.width)},${roundForSvg(y + element.height)}`;
      return `<g opacity="${opacity}">${element.props.showArea === true ? `<polygon points="${areaPoints}" fill="${escapeAttr(strokeColor)}" opacity="0.12"/>` : ""}<polyline points="${points}" fill="none" stroke="${escapeAttr(strokeColor)}" stroke-width="${element.style.strokeWidth ?? 3}" stroke-linecap="round" stroke-linejoin="round"/>${children}</g>`;
    }
    case "button":
    case "badge": {
      const label = svgTextBlock(readString(element.props.text, element.name), {
        x: x + element.width / 2,
        centerY: y + element.height / 2,
        width: element.width - 16,
        maxHeight: element.height,
        fontSize,
        fontFamily,
        fontWeight: 700,
        fill: color,
        anchor: "middle"
      });
      return `<g opacity="${opacity}"><rect x="${x}" y="${y}" width="${element.width}" height="${element.height}" rx="${radius}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}"/>${label}${children}</g>`;
    }
    case "shape": {
      const kind = readString(element.props.shape, "rectangle");
      const outline = shapeOutlineSvg(kind, x, y, element.width, element.height, radius, escapeAttr(fill), escapeAttr(stroke), element.style.strokeWidth ?? 1.5, dashAttr);
      const label = readString(element.props.text, "");
      const subtitle = readString(element.props.subtitle, "");
      // A titled node centres its pair as one optical block rather than centring the title alone —
      // which now means measuring both *after* wrapping, since either can run to several lines.
      const subtitleSize = Math.max(11, Math.round(fontSize * 0.72));
      const labelWeight = Number(element.style.fontWeight ?? 600);
      const inner = Math.max(24, element.width - 24);
      const centerX = x + element.width / 2;
      const labelStep = fontSize * 1.3;
      const subtitleStep = subtitleSize * 1.35;
      const labelLines = label ? wrapTextToWidth(label, inner, fontSize, labelWeight).length : 0;
      const subtitleLines = subtitle ? wrapTextToWidth(subtitle, inner, subtitleSize, 500).length : 0;
      const blockHeight = labelLines * labelStep + (subtitleLines ? subtitleLines * subtitleStep + 4 : 0);
      const top = y + element.height / 2 - blockHeight / 2;
      // Deliberately not clipped: inside a diagram node a silently truncated label reads as a broken
      // renderer, and `text-overflows-box` now tells the author when it genuinely does not fit.
      const text = svgTextBlock(label, {
        x: centerX,
        baseline: top + fontSize,
        width: inner,
        fontSize,
        fontFamily,
        fontWeight: labelWeight,
        fill: color,
        anchor: "middle",
        lineHeight: 1.3
      });
      const subtitleText = svgTextBlock(subtitle, {
        x: centerX,
        baseline: top + labelLines * labelStep + 4 + subtitleSize,
        width: inner,
        fontSize: subtitleSize,
        fontFamily,
        fontWeight: 500,
        fill: color,
        anchor: "middle",
        opacity: 0.72,
        lineHeight: 1.35
      });
      return `<g opacity="${opacity}">${outline}${text}${subtitleText}${children}</g>`;
    }
    case "ink": {
      const points = readPointArray(element.props.points);
      if (points.length < 2) return `<g opacity="${opacity}">${children}</g>`;
      const path = points
        .map(([px, py], index) => `${index === 0 ? "M" : "L"} ${roundForSvg(x + px * element.width)} ${roundForSvg(y + py * element.height)}`)
        .join(" ");
      return `<g opacity="${opacity}"><path d="${path}" fill="none" stroke="${escapeAttr(element.style.stroke ?? color)}" stroke-width="${element.style.strokeWidth ?? 2.5}" stroke-linecap="round" stroke-linejoin="round"/>${children}</g>`;
    }
    case "sticky": {
      const textLines = svgTextBlock(readString(element.props.text, "Note"), {
        x: x + 16,
        baseline: y + 28,
        width: element.width - 32,
        maxHeight: element.height - 32,
        fontSize,
        fontFamily,
        fontWeight: 600,
        fill: color,
        lineHeight: 1.4
      });
      return `<g opacity="${opacity}"><rect x="${x}" y="${y}" width="${element.width}" height="${element.height}" rx="${radius || 12}" fill="${escapeAttr(fill === "transparent" ? "#FEF3C7" : fill)}" stroke="${escapeAttr(stroke)}"/>${textLines}${children}</g>`;
    }
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
      return `<g opacity="${opacity}"><rect x="${x}" y="${y}" width="${element.width}" height="${element.height}" rx="${radius}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}"/><text x="${x + 18}" y="${y + 32}" fill="${escapeAttr(color)}" font-family="${fontFamily}" font-size="14" font-weight="800">${escapeXml(readString(element.props.title, "Chart"))}</text>${bars}${children}</g>`;
    }
    case "image":
    case "screenshotOverlay": {
      const asset = project.assets.find((candidate) => candidate.id === element.props.assetId);
      const image = asset ? `<image href="${escapeAttr(asset.src)}" x="${x}" y="${y}" width="${element.width}" height="${element.height}" preserveAspectRatio="xMidYMid slice" opacity="${opacity}"/>` : "";
      return `<g><rect x="${x}" y="${y}" width="${element.width}" height="${element.height}" rx="${radius}" fill="${escapeAttr(fill || "#E2E8F0")}" stroke="${escapeAttr(stroke)}" opacity="${opacity}"/>${image}<text x="${x + element.width / 2}" y="${y + element.height / 2}" fill="#64748B" font-family="${fontFamily}" font-size="13" text-anchor="middle">${asset ? "" : escapeXml(element.type === "screenshotOverlay" ? "Screenshot overlay" : "Image")}</text>${children}</g>`;
    }
    default: {
      const titleText = readString(element.props.title ?? element.props.text ?? element.name, element.name);
      const titleWidth = element.width - 36;
      // The secondary line sits under the title, so it has to know how tall the title actually got.
      const titleLines = wrapTextToWidth(titleText, titleWidth, fontSize, 800).length;
      const title = svgTextBlock(titleText, {
        x: x + 18,
        baseline: y + 32,
        width: titleWidth,
        fontSize,
        fontFamily,
        fontWeight: 800,
        fill: color
      });
      const secondary = renderSecondarySvgLines(project, element, x, y + (titleLines - 1) * fontSize * 1.35);
      return `<g opacity="${opacity}"><rect x="${x}" y="${y}" width="${element.width}" height="${element.height}" rx="${radius}" fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke)}"/>${title}${secondary}${children}</g>`;
    }
  }
}

function renderSecondarySvgLines(project: BoardProject, element: BoardElement, x: number, y: number): string {
  const subtitle = readString(element.props.subtitle ?? element.props.body ?? element.props.price, "");
  if (!subtitle) {
    return "";
  }
  return svgTextBlock(subtitle, {
    x: x + 18,
    baseline: y + 58,
    width: element.width - 36,
    fontSize: 13,
    fontFamily: escapeAttr(svgFontFamily(project, element)),
    fontWeight: 400,
    fill: element.style.color ?? "#64748B",
    opacity: 0.7
  });
}

function svgFontFamily(project: BoardProject, element: BoardElement): string {
  return element.style.fontFamily ?? project.tokens.fonts.sans ?? "Inter, Arial, Helvetica, sans-serif";
}

function svgTextAlignment(element: BoardElement, x: number): { textX: number; textAnchor: "start" | "middle" | "end" } {
  if (element.style.textAlign === "center") {
    return { textX: x + element.width / 2, textAnchor: "middle" };
  }
  if (element.style.textAlign === "right") {
    return { textX: x + element.width, textAnchor: "end" };
  }
  return { textX: x, textAnchor: "start" };
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
  // De-duplicated: several branches contribute layout classes independently and card elements used to
  // emit `flex flex-col` twice. Order-preserving so the output still reads top-down.
  const seen = new Set<string>();
  for (const chunk of classes) {
    if (!chunk) continue;
    for (const token of chunk.split(/\s+/)) {
      if (token) seen.add(token);
    }
  }
  return [...seen].join(" ");
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function materialIconSvgMarkup(name: string): string {
  switch (name.trim().toLowerCase().replace(/[\s-]+/g, "_")) {
    case "check":
    case "check_circle":
      return `<path d="M9.2 16.4 4.8 12l1.5-1.5 2.9 2.9 8.5-8.5L19.2 6z" />`;
    case "close":
    case "cancel":
      return `<path d="m6.4 19-1.4-1.4 5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6z" />`;
    case "search":
      return `<path d="m19 20.4-5.7-5.7a7 7 0 1 1 1.4-1.4l5.7 5.7zM9.5 14a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9" />`;
    case "home":
      return `<path d="M4 20V9.8L12 4l8 5.8V20h-6v-6h-4v6z" />`;
    case "settings":
      return `<path d="m10.8 21-.4-3a6 6 0 0 1-1.4-.6l-2.4 1.8-1.8-3 2.8-1.2a6 6 0 0 1 0-1.8L4.8 12l1.8-3L9 10.8q.7-.4 1.4-.6l.4-3h3.4l.4 3q.7.2 1.4.6L18.4 9l1.8 3-2.8 1.2a6 6 0 0 1 0 1.8l2.8 1.2-1.8 3-2.4-1.8q-.7.4-1.4.6l-.4 3zm1.7-5.2a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6" />`;
    case "arrow_forward":
      return `<path d="m14 19-1.4-1.4 4.6-4.6H4v-2h13.2l-4.6-4.6L14 5l7 7z" />`;
    case "trending_up":
      return `<path d="m3.8 17.2-1.4-1.4 6.4-6.4 4 4L19.2 7H15V5h7v7h-2V8.4l-7.2 7.2-4-4z" />`;
    case "credit_card":
    case "payments":
      return `<path d="M4 19q-.8 0-1.4-.6T2 17V7q0-.8.6-1.4T4 5h16q.8 0 1.4.6T22 7v10q0 .8-.6 1.4T20 19zm0-10h16V7H4zm0 4v4h16v-4z" />`;
    case "more_horiz":
      return `<path d="M5 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4m7 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4m7 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4" />`;
    case "person":
    case "account_circle":
      return `<path d="M12 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8M4 21v-2q0-2.1 2.1-3.3T12 14.5t5.9 1.2T20 19v2z" />`;
    case "add":
    case "add_circle":
    default:
      return `<path d="M11 20v-7H4v-2h7V4h2v7h7v2h-7v7z" />`;
  }
}

function linePrimitivePoints(direction: string): { x1: number; y1: number; x2: number; y2: number } {
  if (direction === "vertical") return { x1: 50, y1: 6, x2: 50, y2: 94 };
  if (direction === "diagonal-down") return { x1: 6, y1: 6, x2: 94, y2: 94 };
  if (direction === "diagonal-up") return { x1: 6, y1: 94, x2: 94, y2: 6 };
  return { x1: 6, y1: 50, x2: 94, y2: 50 };
}

function sparklinePoints(values: number[], width: number, height: number, padding: number, offsetX = 0, offsetY = 0): string {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - padding * 2);
  return values
    .map((value, index) => {
      const x = offsetX + padding + (values.length === 1 ? usableWidth / 2 : (index / (values.length - 1)) * usableWidth);
      const y = offsetY + padding + (1 - (value - min) / range) * usableHeight;
      return `${roundForSvg(x)},${roundForSvg(y)}`;
    })
    .join(" ");
}

function readStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;
}

function readNumberArray(value: unknown, fallback: number[]): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : fallback;
}

function roundForSvg(value: number): number {
  return Math.round(value * 10) / 10;
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

function shapeOutlineSvg(kind: string, x: number, y: number, w: number, h: number, radius: number, fill: string, stroke: string, strokeWidth: number, dashAttr = ""): string {
  const attrs = `fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"${dashAttr}`;
  const poly = (points: Array<[number, number]>) => `<polygon points="${points.map(([px, py]) => `${roundForSvg(x + px * w)},${roundForSvg(y + py * h)}`).join(" ")}" ${attrs}/>`;
  switch (kind) {
    case "ellipse":
      return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${attrs}/>`;
    case "diamond":
      return poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]);
    case "parallelogram":
      return poly([[0.22, 0], [1, 0], [0.78, 1], [0, 1]]);
    case "triangle":
      return poly([[0.5, 0], [1, 1], [0, 1]]);
    case "hexagon":
      return poly([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]);
    case "star":
      return poly(starPoints());
    case "arrow-right":
      return poly([[0, 0.28], [0.62, 0.28], [0.62, 0], [1, 0.5], [0.62, 1], [0.62, 0.72], [0, 0.72]]);
    case "cylinder": {
      const ry = Math.min(h * 0.16, 22);
      return `<path d="M ${x} ${y + ry} A ${w / 2} ${ry} 0 0 1 ${x + w} ${y + ry} L ${x + w} ${y + h - ry} A ${w / 2} ${ry} 0 0 1 ${x} ${y + h - ry} Z" ${attrs}/><path d="M ${x} ${y + ry} A ${w / 2} ${ry} 0 0 0 ${x + w} ${y + ry}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
    }
    case "document": {
      const wave = h * 0.12;
      return `<path d="M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h - wave} Q ${x + w * 0.75} ${y + h - wave * 2.4} ${x + w / 2} ${y + h - wave} T ${x} ${y + h - wave} Z" ${attrs}/>`;
    }
    case "cloud": {
      const r = Math.min(w, h) / 4;
      return `<path d="M ${x + r} ${y + h * 0.7} A ${r} ${r} 0 1 1 ${x + w * 0.28} ${y + h * 0.32} A ${r * 1.15} ${r * 1.15} 0 1 1 ${x + w * 0.68} ${y + h * 0.3} A ${r} ${r} 0 1 1 ${x + w - r * 0.7} ${y + h * 0.7} Z" ${attrs}/>`;
    }
    case "rounded":
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w, h) / 2}" ${attrs}/>`;
    default:
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" ${attrs}/>`;
  }
}

function starPoints(): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let index = 0; index < 10; index++) {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    const radius = index % 2 === 0 ? 0.5 : 0.21;
    points.push([0.5 + radius * Math.cos(angle), 0.5 + radius * Math.sin(angle)]);
  }
  return points;
}

interface SvgTextBlockOptions {
  x: number;
  /** Baseline of the first line. Mutually exclusive with `centerY`. */
  baseline?: number;
  /** Vertical centre of the wrapped block — what a node label wants, since it grows both ways. */
  centerY?: number;
  /** Wrap budget in user units. */
  width: number;
  /** Clip the block to this many user units, ellipsising the last line that fits. */
  maxHeight?: number;
  fontSize: number;
  fontFamily: string;
  fontWeight?: number;
  fill: string;
  anchor?: "start" | "middle" | "end";
  opacity?: number;
  lineHeight?: number;
}

/**
 * The exporters' text primitive. SVG does not wrap text and `<foreignObject>` is not rendered by the
 * librsvg/sharp path we rasterize PNGs through, so every line break has to be computed here and emitted
 * as its own `<tspan>`. Without this the canvas (a wrapping HTML box) and the export disagree on every
 * label longer than its element, and only the export is wrong.
 */
function svgTextBlock(raw: string, options: SvgTextBlockOptions): string {
  const text = raw.trim();
  if (!text) return "";
  const { x, width, fontSize, fontFamily, fill } = options;
  const weight = options.fontWeight ?? 400;
  const step = fontSize * (options.lineHeight ?? 1.35);
  let lines = wrapTextToWidth(text, width, fontSize, weight);

  if (options.maxHeight !== undefined) {
    const maxLines = Math.max(1, Math.floor(options.maxHeight / step));
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      // Say "there is more" rather than ending mid-word — a clipped label reads as a rendering fault.
      const last = lines[maxLines - 1]!;
      lines[maxLines - 1] = ellipsizeToWidth(last, width, fontSize, weight);
    }
  }

  const firstBaseline =
    options.centerY !== undefined
      ? options.centerY - ((lines.length - 1) * step) / 2 + fontSize / 3
      : (options.baseline ?? 0);
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="${roundForSvg(x)}" y="${roundForSvg(firstBaseline + index * step)}">${escapeXml(line)}</tspan>`
    )
    .join("");
  const opacityAttr = options.opacity !== undefined && options.opacity !== 1 ? ` opacity="${options.opacity}"` : "";
  const anchorAttr = options.anchor ? ` text-anchor="${options.anchor}"` : "";
  return `<text fill="${escapeAttr(fill)}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${weight}"${anchorAttr}${opacityAttr}>${tspans}</text>`;
}

/** Trim a line until it plus an ellipsis fits the width budget. */
function ellipsizeToWidth(line: string, width: number, fontSize: number, fontWeight: number): string {
  if (textAdvanceWidth(`${line}…`, fontSize, fontWeight) <= width) return `${line}…`;
  let trimmed = line;
  while (trimmed.length > 1 && textAdvanceWidth(`${trimmed}…`, fontSize, fontWeight) > width) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed.trimEnd()}…`;
}

/** Render a full page (all artboards + connectors) to one SVG — diagrams export whole. */
export function renderPageSvg(project: BoardProject, pageId?: string, options: SceneOptions = {}): string {
  const page = pageId ? project.pages.find((candidate) => candidate.id === pageId) : project.pages[0];
  const artboards = project.artboards.filter((artboard) => artboard.visible && (!page || page.artboardIds.includes(artboard.id)));
  if (!artboards.length) {
    throw new Error("Page has no visible artboards to export.");
  }
  const pad = options.padding ?? 60;
  const minX = Math.min(...artboards.map((a) => a.x)) - pad;
  const minY = Math.min(...artboards.map((a) => a.y)) - pad;
  const maxX = Math.max(...artboards.map((a) => a.x + a.width)) + pad;
  const maxY = Math.max(...artboards.map((a) => a.y + a.height)) + pad;

  const artboardMarkup = artboards.map((artboard) => renderArtboardBlockSvg(project, artboard)).join("\n  ");

  const artboardIds = new Set(artboards.map((artboard) => artboard.id));
  const slots = connectorAnchorSlots(project);
  const connectors = project.connectors
    .filter((connector) => artboardIds.has(connector.fromArtboardId) && artboardIds.has(connector.toArtboardId))
    .map((connector) => renderConnectorSvg(project, connector, slots.get(connector.id)))
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(maxX - minX)}" height="${Math.round(maxY - minY)}" viewBox="${Math.round(minX)} ${Math.round(minY)} ${Math.round(maxX - minX)} ${Math.round(maxY - minY)}">
  ${backdropRect(Math.round(minX), Math.round(minY), options.background ?? PAGE_BACKGROUND)}
  ${artboardMarkup}
  ${connectors}
</svg>`;
}

/** One artboard drawn in page space: name label, frame chrome, then its element tree. */
function renderArtboardBlockSvg(project: BoardProject, artboard: Artboard): string {
  const chrome = artboard.frameless
    ? artboard.background && artboard.background !== "transparent"
      ? `<rect x="${artboard.x}" y="${artboard.y}" width="${artboard.width}" height="${artboard.height}" fill="${escapeAttr(artboard.background)}"/>`
      : ""
    : `<rect x="${artboard.x}" y="${artboard.y}" width="${artboard.width}" height="${artboard.height}" rx="18" fill="${escapeAttr(artboard.background)}" stroke="#CBD5E1" stroke-width="1"/>`;
  const elements = project.elements
    .filter((element) => element.artboardId === artboard.id && element.visible && !element.parentId)
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((element) => renderElementSvg(project, element, artboard.x, artboard.y))
    .join("");
  const label = artboard.frameless
    ? ""
    : `<text x="${artboard.x}" y="${artboard.y - 12}" fill="#64748B" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="600">${escapeXml(artboard.name)}</text>`;
  return `${label}${chrome}${elements}`;
}

/**
 * Whatever the user has selected, cropped to its own bounds — the "put *this* in my slide" export.
 * Selected frames render whole (chrome + children); selected elements render in page space at their
 * absolute position; a connector is drawn only when both of its endpoints are inside the render set,
 * so a cropped image never shows an arrow pointing at nothing.
 */
export function renderSelectionSvg(project: BoardProject, ids: string[], options: SceneOptions = {}): string {
  const { artboards, elements } = resolveSceneSelection(project, ids);
  if (!artboards.length && !elements.length) {
    throw new Error("Select a frame or element before exporting an image.");
  }
  const pad = options.padding ?? 32;
  const rects: Rect[] = [
    ...artboards.map((artboard) => ({ x: artboard.x, y: artboard.y - (artboard.frameless ? 0 : 26), width: artboard.width, height: artboard.height + (artboard.frameless ? 0 : 26) })),
    ...elements.map((element) => absoluteElementRect(project, element))
  ];
  const minX = Math.min(...rects.map((rect) => rect.x)) - pad;
  const minY = Math.min(...rects.map((rect) => rect.y)) - pad;
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width)) + pad;
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height)) + pad;

  const artboardMarkup = artboards.map((artboard) => renderArtboardBlockSvg(project, artboard)).join("\n  ");
  const elementMarkup = elements
    .map((element) => {
      const origin = absoluteElementRect(project, element);
      return renderElementSvg(project, element, origin.x - element.x, origin.y - element.y);
    })
    .join("\n  ");

  const rendered = renderedIdSet(project, artboards, elements);
  const slots = connectorAnchorSlots(project);
  const connectors = project.connectors
    .filter((connector) => connectorEndpointRendered(connector.fromArtboardId, connector.fromElementId, rendered) && connectorEndpointRendered(connector.toArtboardId, connector.toElementId, rendered))
    .map((connector) => renderConnectorSvg(project, connector, slots.get(connector.id)))
    .join("\n  ");

  // A lone frame keeps its own background; a mixed or multi-object selection sits on the page colour.
  const naturalBackground = artboards.length === 1 && !elements.length ? artboards[0]!.background : PAGE_BACKGROUND;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(maxX - minX)}" height="${Math.round(maxY - minY)}" viewBox="${Math.round(minX)} ${Math.round(minY)} ${Math.round(maxX - minX)} ${Math.round(maxY - minY)}">
  ${backdropRect(Math.round(minX), Math.round(minY), options.background ?? naturalBackground)}
  ${artboardMarkup}
  ${elementMarkup}
  ${connectors}
</svg>`;
}

export type SceneScope = "page" | "artboard" | "selection";

export interface SceneRequest extends SceneOptions {
  scope: SceneScope;
  pageId?: string;
  artboardId?: string;
  ids?: string[];
}

export interface RenderedScene {
  svg: string;
  width: number;
  height: number;
  /** Human-readable name of what was rendered — becomes the download filename. */
  name: string;
}

/**
 * Single entry point for every image export: scope in, SVG + its true pixel size out.
 * Callers rasterize from this and never re-parse the SVG to find its dimensions.
 */
export function renderScene(project: BoardProject, request: SceneRequest): RenderedScene {
  const { scope, pageId, artboardId, ids, ...options } = request;
  if (scope === "artboard") {
    const artboard = project.artboards.find((candidate) => candidate.id === artboardId);
    if (!artboard) throw new Error(`Artboard not found: ${artboardId ?? "(none given)"}`);
    return { svg: renderArtboardSvg(project, artboard.id, options), width: Math.round(artboard.width), height: Math.round(artboard.height), name: artboard.name };
  }
  if (scope === "selection") {
    const svg = renderSelectionSvg(project, ids ?? [], options);
    const { artboards, elements } = resolveSceneSelection(project, ids ?? []);
    // Board-qualified: a cropped element is often called something like "e_right", which is
    // meaningless once it is sitting in a Downloads folder next to everything else.
    const only = artboards.length + elements.length === 1 ? (artboards[0]?.name ?? elements[0]?.name) : undefined;
    return { svg, ...svgViewportSize(svg), name: `${project.name} ${only ?? "selection"}` };
  }
  const page = pageId ? project.pages.find((candidate) => candidate.id === pageId) : project.pages[0];
  const svg = renderPageSvg(project, page?.id, options);
  return { svg, ...svgViewportSize(svg), name: page && project.pages.length > 1 ? `${project.name} — ${page.name}` : project.name };
}

const PAGE_BACKGROUND = "#F1F5F9";

/** `transparent` (or an empty colour) means: draw no backdrop at all, so the PNG keeps its alpha. */
function backdropRect(x: number, y: number, background: string): string {
  if (!background || background === "transparent" || background === "none") return "";
  return `<rect x="${x}" y="${y}" width="100%" height="100%" fill="${escapeAttr(background)}"/>`;
}

function svgViewportSize(svg: string): { width: number; height: number } {
  const width = Number(svg.match(/\swidth="([\d.]+)"/)?.[1] ?? 0);
  const height = Number(svg.match(/\sheight="([\d.]+)"/)?.[1] ?? 0);
  return { width: Math.round(width), height: Math.round(height) };
}

/**
 * Selected ids → the roots actually worth drawing. An element whose frame is also selected, or whose
 * ancestor is selected, is dropped: it is already painted by that ancestor and drawing it twice would
 * put it above its own siblings.
 */
function resolveSceneSelection(project: BoardProject, ids: string[]): { artboards: Artboard[]; elements: BoardElement[] } {
  const selected = new Set(ids);
  const artboards = project.artboards.filter((artboard) => selected.has(artboard.id) && artboard.visible);
  const artboardIds = new Set(artboards.map((artboard) => artboard.id));
  const elements = project.elements.filter((element) => {
    if (!selected.has(element.id) || !element.visible) return false;
    if (artboardIds.has(element.artboardId)) return false;
    for (let parent: string | null | undefined = element.parentId; parent; ) {
      if (selected.has(parent)) return false;
      parent = project.elements.find((candidate) => candidate.id === parent)?.parentId ?? null;
    }
    return true;
  });
  return { artboards, elements };
}

/** Element coordinates are parent-relative; walk up to the artboard to get page space. */
function absoluteElementRect(project: BoardProject, element: BoardElement): Rect {
  let x = element.x;
  let y = element.y;
  for (let parentId = element.parentId; parentId; ) {
    const parent = project.elements.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    x += parent.x;
    y += parent.y;
    parentId = parent.parentId;
  }
  const artboard = project.artboards.find((candidate) => candidate.id === element.artboardId);
  return { x: x + (artboard?.x ?? 0), y: y + (artboard?.y ?? 0), width: element.width, height: element.height };
}

function renderedIdSet(project: BoardProject, artboards: Artboard[], elements: BoardElement[]): Set<string> {
  const rendered = new Set<string>(artboards.map((artboard) => artboard.id));
  for (const artboard of artboards) {
    for (const element of project.elements) {
      if (element.artboardId === artboard.id) rendered.add(element.id);
    }
  }
  const queue = [...elements];
  while (queue.length) {
    const element = queue.pop()!;
    rendered.add(element.id);
    queue.push(...project.elements.filter((child) => child.parentId === element.id));
  }
  return rendered;
}

function connectorEndpointRendered(artboardId: string, elementId: string | undefined, rendered: Set<string>): boolean {
  return elementId ? rendered.has(elementId) : rendered.has(artboardId);
}

function renderConnectorSvg(project: BoardProject, connector: BoardConnector, toSlot?: AnchorSlot, origin?: { x: number; y: number }): string {
  const fromRect = connectorEndpointRect(project, connector.fromArtboardId, connector.fromElementId);
  const toRect = connectorEndpointRect(project, connector.toArtboardId, connector.toElementId);
  if (!fromRect || !toRect) return "";
  const obstacles = connectorObstacles(project, connector);
  const geometry = connectorGeometry(fromRect, toRect, connector, { obstacles, toSlot });
  const stroke = escapeAttr(connector.style.stroke ?? "#44403C");
  const strokeWidth = connector.style.strokeWidth ?? 2;
  const dash = strokeDashPattern(connector.style.strokeStyle, strokeWidth);
  const dashAttr = dash ? ` stroke-dasharray="${dash.dashArray}"` : "";
  const parts: string[] = [
    `<path d="${geometry.d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${dash?.lineCap ?? "round"}" stroke-linejoin="round"${dashAttr}/>`
  ];
  // Arrowheads stay solid on a dashed line — a half-drawn arrow reads as a rendering bug.
  if (connector.arrowEnd !== "none") {
    const head = arrowheadPath(geometry.end, geometry.endAngle, connector.arrowEnd);
    parts.push(`<path d="${head}" fill="${arrowheadIsFilled(connector.arrowEnd) ? stroke : "none"}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`);
  }
  if (connector.arrowStart !== "none") {
    const head = arrowheadPath(geometry.start, geometry.startAngle + Math.PI, connector.arrowStart);
    parts.push(`<path d="${head}" fill="${arrowheadIsFilled(connector.arrowStart) ? stroke : "none"}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`);
  }
  if (connector.label) {
    const labelWidth = connectorLabelWidth(connector.label);
    const { point } = connectorLabelPoint(geometry.samples, connector.labelPosition, labelWidth, [...obstacles, fromRect, toRect]);
    parts.push(
      `<rect x="${roundForSvg(point.x - labelWidth / 2)}" y="${roundForSvg(point.y - 13)}" width="${roundForSvg(labelWidth)}" height="26" rx="13" fill="#FFFFFF" stroke="#E2E8F0"/>`,
      `<text x="${roundForSvg(point.x)}" y="${roundForSvg(point.y + 4.5)}" fill="#334155" font-family="Inter, Arial, sans-serif" font-size="12" font-weight="600" text-anchor="middle">${escapeXml(connector.label)}</text>`
    );
  }
  const transform = origin && (origin.x !== 0 || origin.y !== 0) ? ` transform="translate(${roundForSvg(origin.x)} ${roundForSvg(origin.y)})"` : "";
  return `<g${transform}>${parts.join("")}</g>`;
}

/** Mermaid flowchart export — agents and docs love this for flows and org charts. */
export function renderMermaid(project: BoardProject): string {
  const lines: string[] = ["flowchart LR"];
  const declared = new Set<string>();
  const idMap = new Map<string, string>();
  let counter = 0;

  const mermaidId = (rawId: string): string => {
    const existing = idMap.get(rawId);
    if (existing) return existing;
    const id = `n${++counter}`;
    idMap.set(rawId, id);
    return id;
  };

  const declare = (rawId: string, label: string, element?: BoardElement): string => {
    const id = mermaidId(rawId);
    if (declared.has(id)) return id;
    declared.add(id);
    const safeLabel = label.replace(/["\[\]{}()|]/g, " ").replace(/\s+/g, " ").trim() || "Node";
    const kind = element?.type === "shape" ? readString(element.props.shape, "rectangle") : "rectangle";
    let open = "[";
    let close = "]";
    if (element?.type === "shape") {
      if (kind === "diamond") [open, close] = ["{", "}"];
      else if (kind === "ellipse" || kind === "rounded") [open, close] = ["(", ")"];
      else if (kind === "parallelogram") [open, close] = ["[/", "/]"];
      else if (kind === "cylinder") [open, close] = ["[(", ")]"];
      else if (kind === "hexagon") [open, close] = ["{{", "}}"];
    }
    lines.push(`  ${id}${open}"${safeLabel}"${close}`);
    return id;
  };

  const nodeFor = (artboardId: string, elementId?: string): string | undefined => {
    if (elementId) {
      const element = project.elements.find((candidate) => candidate.id === elementId);
      if (!element) return undefined;
      const label = readString(element.props.text, element.name);
      return declare(element.id, label, element);
    }
    const artboard = project.artboards.find((candidate) => candidate.id === artboardId);
    if (!artboard) return undefined;
    return declare(artboard.id, artboard.name);
  };

  for (const connector of project.connectors) {
    const from = nodeFor(connector.fromArtboardId, connector.fromElementId);
    const to = nodeFor(connector.toArtboardId, connector.toElementId);
    if (!from || !to) continue;
    const edge = connector.arrowEnd === "none" ? "---" : "-->";
    const label = connector.label ? `|"${connector.label.replace(/["|]/g, " ").trim()}"|` : "";
    lines.push(`  ${from} ${edge}${label} ${to}`);
  }

  // Include unconnected diagram nodes so the export is complete.
  for (const element of project.elements) {
    if ((element.type === "shape" || element.type === "sticky") && !idMap.has(element.id)) {
      declare(element.id, readString(element.props.text, element.name), element);
    }
  }

  return `${lines.join("\n")}\n`;
}
