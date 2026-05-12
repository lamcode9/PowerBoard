# Paper.Design To PowerBoard Gap Plan

Date: 2026-05-07

Scope: learn Paper.Design from the live desktop app, its MCP surface, official Paper public material, and the current PowerBoard code/cloud state; then produce an implementation plan that closes the gap while honoring two explicit constraints:

- PowerBoard does not need to become a native Mac app now.
- PowerBoard is for one owner/user now, so team billing, multi-seat admin, and heavy collaboration can be future-compatible but not v1 requirements.

Product target: PowerBoard should become a polished, cloud-first, agent-first design tool for high-fidelity app mockups. It should not drift into a generic Figma clone. The center of gravity is app screen design, semantic hierarchy, screenshot tracing, MCP editing, inspectable implementation structure, and reliable exports.

## Executive Read

Paper is currently stronger than PowerBoard in four major areas:

1. Editor craft: Paper has a mature design-tool shell with tool modes, direct creation tools, layer controls, rich property panels, canvas settings, zoom settings, nudge settings, pixel grid, snapping, guides, and export panels.
2. CSS-native design model: Paper behaves like a visual HTML/CSS canvas. Its MCP and code output lean on DOM/CSS concepts, which makes agent understanding much better than a purely absolute-positioned mockup model.
3. Agent loop: Paper exposes a very agent-friendly MCP API: inspect file, inspect selection, inspect nodes, inspect children, screenshot, JSX, computed CSS, write HTML, update styles, rename, duplicate, move, delete, and working indicators.
4. Creation breadth: Paper has AI image generation, SVG generation, vectorization/image utilities, shaders/effects, Figma/SVG/web imports, export presets, and video export.

PowerBoard is already stronger than a throwaway mockup board in these areas:

1. It is cloud-first with Supabase Postgres as the working source of truth.
2. It already has a browser editor, REST API, local MCP server, WebSocket live sync, semantic roles, hierarchy paths, screenshot overlays, app-specific component primitives, PNG export, spec export, and React/Tailwind export.
3. It is already tuned toward app mockups and agent workflows rather than broad whiteboarding.

The most important strategic decision is not "copy Paper wholesale." It is:

PowerBoard should become Paper-like where Paper improves the app-mockup and agent loop: CSS-first rendering, stronger layer/inspector/canvas tools, richer MCP inspection/write tools, better import/export, and trace-to-edit workflows. PowerBoard should defer or simplify Paper features that mostly serve broad creative media work: native desktop packaging, team billing/admin, multiplayer cursors, full video timelines, and the complete shader zoo.

## Research Inputs

### Live Paper desktop app

Observed app identity:

- Bundle: `com.todesktop.2601167vjw8xe`.
- Open file URL: `app.paper.design/file/01KQKC74F0TCAN6Z9AGHKNVBYD`.
- Open file name: `CentsCheck Money Habit`.
- Open page: `Page 1`.
- Paper file contained one large artboard named `CentsCheck Money Habit`.

Observed Paper MCP endpoint:

- Local desktop MCP endpoint: `http://127.0.0.1:29979/mcp`.
- Root URL responded with a route-not-found message that pointed to `/mcp`.
- MCP connection succeeded through Streamable HTTP.
- `get_basic_info` succeeded.
- The next read call hit the weekly MCP usage limit in this account, so deeper node tree inspection through MCP was blocked after the basic file overview.

Observed `get_basic_info` result:

- `fileName`: `CentsCheck Money Habit`.
- `pageName`: `Page 1`.
- `pageId`: `1-0`.
- `rootNodeId`: `root_node_1-0`.
- `nodeCount`: 447.
- `artboardCount`: 1.
- Main artboard: id `1-0`, name `CentsCheck Money Habit`, 9 direct children, 1440 x 5900, positioned at x -720 and y -1100.
- Fonts in file: System Sans-Serif and Inter.

Observed MCP limit/account gate:

- Paper showed a Pro upsell after the MCP limit was hit.
- Official pricing currently lists Free at 100 MCP tool calls per week and Pro at 1M MCP tool calls per week.
- The plan should not copy Paper's quota system because PowerBoard is single-user now, but it should add local guardrails, audit logs, and explicit operation previews for safety.

### Official Paper sources used

- [Paper homepage](https://paper.design/)
- [Paper MCP docs](https://paper.design/docs/mcp)
- [Paper pricing](https://paper.design/pricing)
- [Paper build log](https://paper.design/build-log)
- [Paper roadmap](https://paper.design/roadmap)
- [Paper Shaders](https://shaders.paper.design/)
- [Paper Snapshot](https://paper.design/snapshot-extension)

### PowerBoard sources inspected

- `/Users/km/Developer/Board/AGENTS.md`
- `/Users/km/Developer/Board/README.md`
- `/Users/km/Developer/Board/package.json`
- `/Users/km/Developer/Board/packages/schema/src/index.ts`
- `/Users/km/Developer/Board/packages/renderers/src/index.ts`
- `/Users/km/Developer/Board/apps/server/src/mcpServer.ts`
- `/Users/km/Developer/Board/apps/server/src/boardService.ts`
- `/Users/km/Developer/Board/apps/web/src/App.tsx`
- `/Users/km/Developer/Board/apps/web/src/styles.css`
- Production health: `https://lamper-server.vercel.app/api/health`
- Production board list: `https://lamper-server.vercel.app/api/boards`
- Production board summary for `board_r0a28_b1otaq`

Observed PowerBoard production health:

- `ok: true`
- `cloudStore: "supabase-postgres"`
- `storageMode: "cloud"`

Observed live board state:

- `board_r0a28_b1otaq`: `CentsCheck Home Money Control Room - App Section Redesign 2026-05-07`
- Updated during this research window at `2026-05-07T14:35:58.984Z`.
- 1 page.
- 9 artboards.
- 459 elements.
- 7 assets.
- 1 connector.
- Token counts: 6 colors, 1 font, 3 radii, 1 shadow, 1 spacing value.
- Element type counts: 168 frames, 266 text, 15 screenshot overlays, 9 images, 1 badge.

Worktree note:

- Existing unrelated local changes were present before this document was created:
  - `AGENTS.md`
  - `agent.md`
  - `packages/renderers/src/index.ts`
- This plan avoids changing those files.

### Agent Dogfooding Feedback Added 2026-05-08

An agent used PowerBoard and reported that PowerBoard itself made high-fidelity app design harder. This feedback is now treated as roadmap input, not as a one-off complaint.

The reported blockers:

- No reliable Material icon primitive.
- Weak line and sparkline primitives.
- No proper auto-layout or constraint system.
- Visible internal ids in the design UI.
- PNG export breaks editable text.
- MCP tools were not exposed in that agent environment, forcing brittle direct API object mutation.

Roadmap impact:

- MCP exposure, PNG text correctness, internal-id hiding, Material icon support, and line/sparkline primitives move into the early build path.
- The CSS-first auto-layout/constraint work remains P0, but it must be validated against actual app-design scenarios, not only generic layout demos.
- Raw API mutation should become an emergency fallback, not a normal agent workflow.

## Paper Feature Inventory

This section is intentionally exhaustive. It lists what Paper appears to be, not only what PowerBoard should copy.

### 1. Product Shell

Paper has:

- Desktop app wrapper.
- Browser app entry at `app.paper.design`.
- File dashboard.
- File cards and list view.
- Search.
- Filters: all, recents, archived.
- Grid/list toggle.
- New file action.
- Scratchpad concept.
- Current team/workspace selector.
- Account menu and logout.
- Learn/tutorial section.
- Team members page.
- Billing page.
- Team settings page.
- App menus for File/Edit/View/Window/Help.
- Documentation, tutorials, release notes, Discord, Slack, Reddit, and X/Twitter help links.

PowerBoard implication:

- Keep browser-first.
- Add a stronger board dashboard because it materially improves file discovery and repeat design work.
- Skip native Mac wrapper for now.
- Skip team admin/billing for now.
- Keep one-owner identity and storage status visible.
- Add a Learn/Guides surface only if it helps agent workflows, not as marketing.

### 2. Editor Shell

Paper has:

- Dark canvas workspace.
- Left panel for pages/layers or file structure.
- Vertical tool rail.
- Right inspector.
- Top or floating context controls.
- Bottom status feedback: alpha/feedback.
- File title renaming from the title area.
- Page list.
- Canvas viewport with large artboards.
- Selection-dependent inspector.
- Empty inspector state when no selection.

PowerBoard current:

- Top toolbar.
- Left panel with App Kit, Assets, Layers.
- Right panel with Inspector and Flows.
- Status bar.
- Home dashboard.
- Canvas viewport with artboards.
- Board title display.
- Pane hide/show controls.

Gap:

- Paper's editor feels like a focused design tool; PowerBoard feels like an early operational mockup editor.
- PowerBoard needs a real tool-mode system, stronger panel density, direct drawing tools, inspector sections, page/file controls, and more precise canvas status.

### 3. Canvas Navigation

Paper has:

- Cursor-centered zoom.
- Zoom readout and dropdown.
- Zoom in/out.
- Zoom to 100%.
- Zoom to fit.
- Zoom to selection.
- Zoom centers selection toggle.
- Number-key zoom mode toggle.
- Invert zoom direction setting.
- Pixel grid toggle.
- Snap to pixel toggle.
- Layout guides toggle.
- Multiplayer cursor toggle.
- Pan tool.
- Trackpad/mouse panning.
- Nudge settings.
- Small nudge value.
- Large nudge value.

PowerBoard current:

- Cursor/viewport-centered zoom helpers.
- Trackpad pan and modifier zoom.
- Spacebar pan.
- Fit all.
- Focus selection.
- Cmd/Ctrl plus/minus/zero zoom shortcuts.
- Grid background.
- Dragging and resizing.
- Nudge is not exposed as a settings panel.
- Pixel grid and snap are not real features yet.

Gap:

- Add a canvas settings menu modeled on Paper's zoom menu.
- Implement grid visibility, pixel grid at high zoom, snap-to-pixel, guide visibility, nudge settings, keyboard nudge, fit selection, 100% zoom, and stored per-user canvas preferences.

### 4. Creation Tools

Paper has visible creation modes:

- Move.
- Pan.
- Frame.
- Rectangle.
- Text.
- Create image.
- Create SVG.
- Shaders.

PowerBoard current:

- Select is effectively always active.
- Add Frame from device preset.
- Add prebuilt component primitives from App Kit.
- Upload image.
- Upload screenshot overlay.
- No draw-to-create rectangle/text/frame on the canvas.
- No AI image generation.
- No SVG generation.
- No shader/effect insertion.

Gap:

- Add a real tool mode state machine.
- Direct canvas creation must exist for frame, rectangle, text, image placement, screenshot overlay placement, and component insertion.
- AI tools should be added in a prioritized way: first image generation for app mockup assets, then SVG/icon generation, then image utilities, then selected lightweight shader/effect support.

### 5. Inspector And Properties

Paper right inspector observed sections:

- Document metadata when nothing selected.
- Page background color.
- Layout: x, y, rotation, width, height.
- Flex controls.
- Direction toggles.
- Wrap/grid-ish controls.
- Gap and padding fields.
- Clip content.
- Radius slider/value.
- Blending: opacity and blend mode.
- Fill with Solid/Gradient/Image tabs.
- Color with opacity.
- Outline.
- Border.
- Shadow.
- Inner shadow.
- Filters.
- Selection colors with counts.
- Guides.
- Video.
- Export.

PowerBoard current inspector:

- Identifier.
- Hierarchy path.
- Name.
- Semantic role.
- X/Y/W/H.
- Text/title/subtitle/body fields for supported props.
- Fill color.
- Text color.
- Radius.
- Opacity.
- Font size.
- Layer z-index.
- Locked/visible toggles.
- Forward/back actions.
- Artboard background/size/visibility/lock fields.

Gap:

- PowerBoard inspector is semantically useful but visually and functionally shallow.
- Add grouped sections that match real design-tool mental models: Identity, Layout, Auto layout, Typography, Fill, Stroke, Radius, Shadow, Effects, Image, Export, Guides, Semantics, Code.
- Add multi-selection inspector with mixed values, alignment/distribution, batch color replace, batch lock/visibility, and group actions.
- Add selection color inventory and color replacement, because it is high-leverage for mockup cleanup and agent validation.

### 6. Layer/Hierarchy Model

Paper has:

- Named nodes.
- Artboards.
- Layers panel.
- Nested hierarchy.
- Rename.
- Lock/unlock.
- Show/hide.
- Reparenting by drag/drop.
- Deep selection.
- Improved layer tree behavior for deeply nested drags in build log.
- Icons for absolute-positioned nodes.

PowerBoard current:

- Artboards and elements have ids and names.
- Elements can have parentId.
- Layer panel shows nested hierarchy.
- Lock and visibility toggles exist.
- Grouping exists.
- Semantic role exists.
- Hierarchy path exists.
- Reparenting from the layer panel is not implemented.
- Collapse state per layer node is not implemented.
- Rename happens in inspector, not inline in layer panel.

Gap:

- Upgrade layers into a first-class hierarchy editor.
- Add inline rename, expand/collapse, search, filter by type/role, drag reorder, drag reparent, lock/visibility inherited states, absolute/flex badges, and "select all children."
- Preserve semantic role and path as PowerBoard differentiators.

### 7. Layout Model

Paper appears CSS-native:

- Flex layouts.
- Constraints panel.
- Padding/gap handles.
- Relative/absolute layout concepts.
- CSS properties editable from inspector.
- Web-standard model and DOM-friendly MCP.
- Roadmap includes CSS Grid and Tailwind rendering.

PowerBoard current:

- Schema has layout mode: absolute, stack, grid, constraints.
- Renderer mostly positions nodes absolutely.
- Element DOM uses absolute positioning and some flex styling.
- Export can emit some stack/grid class hints but lacks a mature CSS model.
- Resizing/dragging is primarily x/y/w/h.

Gap:

- This is the biggest architecture gap.
- PowerBoard needs a CSS-first node model and renderer while preserving app-screen artboard positioning.
- Absolute mockup editing should remain supported, but frames/groups/cards should be able to use real flex layout, padding, gap, align, justify, sizing modes, and constraints.

### 8. Styling And Effects

Paper has:

- Solid fills.
- Gradient fills.
- Image fills.
- Color opacity.
- Multiple fills likely through panel history/build log.
- Borders/outlines.
- Shadows.
- Inner shadows.
- Filters.
- Backdrop filters.
- Blend modes.
- Radius panel with individual corners.
- Text gradients.
- Variable fonts and OpenType features.
- Selection color replacement.
- LCH/LAB color paste support.
- Shaders.

PowerBoard current:

- Single fill.
- Single stroke/strokeWidth.
- Single shadow string.
- Blur field in schema, but not fully surfaced.
- Radius single value.
- Font family/size/weight/line height/letter spacing/text align in schema.
- Limited inspector controls.

Gap:

- Introduce style arrays and CSS property coverage:
  - fills[]
  - borders[]
  - shadows[]
  - filters[]
  - backdropFilters[]
  - blendMode
  - per-corner radius
  - typography details
  - image fit/crop/focal point
  - color spaces preserved as strings
- Surface these in inspector gradually.

### 9. Text Editing

Paper has:

- Direct text elements.
- Text inspector.
- Font search.
- Local/Google font awareness.
- Font weights/styles/features.
- Text formatting: casing, wrapping, truncation.
- Text selection/caret polish.
- Native editing behavior improvements.

PowerBoard current:

- Text content editable through inspector fields.
- Text rendered as spans.
- No on-canvas text editing.
- Basic typography fields in schema and partial inspector.

Gap:

- Add double-click text edit on canvas.
- Add textarea/text content inspector for multi-line content.
- Add typography panel.
- Add font family picker from local safe list and project tokens.
- Add wrapping/truncation modes.
- Add text auto-size/hug content later.

### 10. Assets And Imports

Paper has:

- Image import.
- SVG import into editable layers.
- Figma copy/paste/import.
- Screenshot/image/web import from "Start with anything."
- Paper Snapshot extension copies web components into editable layers.
- Fill image extraction through MCP.
- HEIC/HEIF support per build log.
- Asset hosting roadmap.

PowerBoard current:

- Image upload.
- Screenshot overlay upload.
- Assets are cloud-stored.
- Screenshot overlays are locked and support tracing.
- No SVG parser.
- No Figma import.
- No web snapshot.
- No asset hosting/CDN semantics beyond API file serving.

Gap:

- Prioritize imports by app-mockup value:
  1. SVG upload/import to editable elements.
  2. Browser screenshot plus locked overlay flow.
  3. HTML paste/import to editable DOM-like nodes.
  4. Web snapshot helper for selected DOM sections.
  5. Figma import only after CSS/node model is strong enough.
  6. HEIC/HEIF optional.

### 11. AI Generation

Paper has:

- Create image prompt.
- Model picker with OpenAI, Flux, Imagen, Seedream, Recraft, Ideogram, Nano Banana Pro.
- Aspect ratio picker.
- Create SVG prompt.
- Quiver SVG model picker.
- Vectorize.
- Extract colors.
- Remove background.
- AI sidekick/build with natural language.
- "Write small, write often" design guidance for agents.

PowerBoard current:

- No built-in image/SVG generation.
- Codex can edit through MCP/API.
- No prompt panel in the product.
- No AI operation preview or prompt history.

Gap:

- Build a PowerBoard "Agent Workbench" before trying to match every model.
- Add OpenAI image generation first because it is controllable from this workspace.
- Add SVG/icon generation as a constrained feature that outputs editable vector-ish PowerBoard nodes.
- Add extract-colors from image/screenshot as local utility.
- Add remove-background later.
- Keep model variety deferred; one reliable provider is better for the sole-user v1.

### 12. Shaders And Advanced Visual Effects

Paper has:

- Image filters: Paper Texture, Fluted Glass, Water, Image Dithering, Halftone Dots, Halftone CMYK.
- Logo animations: Heatmap, Liquid Metal, Gem Smoke.
- Effects: Mesh Gradient, Static Mesh Gradient, Static Radial Gradient, Dithering, Grain Gradient, Dot Orbit, Dot Grid, Warp, Spiral, Swirl, Waves, Neuro Noise, Perlin Noise, Simplex Noise, Voronoi, Pulsing Border, Metaballs, Color Panels, Smoke Ring, God Rays.
- Separate shader package with React components.

PowerBoard current:

- No shader node type.
- No animation timeline.
- Basic CSS shadow/blur only.

Gap:

- Do not chase the whole shader feature set for app mockups.
- Add a generic `effect` element with CSS gradient/noise/filter presets first.
- Add optional `shader` element support using `@paper-design/shaders-react` or a similar dependency only if it does not harm export/readability.
- Treat shader support as presentation polish, not core app-mockup infrastructure.

### 13. Export

Paper has:

- Export panel per selection/frame.
- Scale presets: 0.5x, 1x, 2x, 3x, 4x.
- Resolution presets: 720p, 1080p, 1440p, 2160p.
- Size presets: 512w, 512h.
- Formats: PNG, JPG, AVIF, WebP.
- Video export on Pro.
- Copy as React CSS/Tailwind.
- Code output improvements over time.

PowerBoard current:

- PNG export through server/renderers.
- Markdown spec export.
- React/Tailwind export.
- No user-facing export preset panel.
- No JPG/WebP/AVIF in UI.
- No per-node export settings.
- No video export.

Gap:

- Add export settings to schema and UI.
- Add scale/format presets.
- Use `sharp` for raster conversion where possible.
- Add nonblank export tests and browser-verified visual checks.
- Improve React/Tailwind from absolute mockup output to readable implementation output.
- Defer video export until the product needs animated demos.

### 14. Prototyping/Interactions

Paper has:

- No-code experiences and prototypes described publicly.
- Motion/interactions in build log: transitions, hover, click, page load, in view, timelines, JSON import/export.
- Video timeline/export capabilities.

PowerBoard current:

- Connectors between artboards.
- Flows panel.
- No interactive preview mode.
- No hotspots/actions/transition metadata.

Gap:

- Add app-mockup prototype metadata:
  - element hotspots
  - on click navigate to artboard
  - overlay/sheet/dialog targets
  - transition type
  - preview mode
- Keep it screen-flow oriented, not a full animation product.

### 15. Collaboration And Teams

Paper has:

- Team workspace.
- Members page.
- Admin role.
- Billing page.
- Team settings.
- Multiplayer cursors.
- Unlimited collaboration files on Pro.
- Organization tier planned.

PowerBoard current:

- Cloud storage with no public browser mutation policy.
- Single-user workflow.
- No team UI.
- No auth UI in current app shell.
- WebSocket live sync for local agent/browser loop.

Gap:

- Since the user is the sole user, do not build teams now.
- Add owner identity and simple access boundary when needed.
- Keep schema fields future-compatible: ownerId, workspaceId, updatedBy, lock metadata.
- Do not spend v1 time on billing, roles, invites, or multiplayer cursor polish.

## Gap Matrix

| Area | Paper state | PowerBoard state | Build decision | Priority |
| --- | --- | --- | --- | --- |
| Native desktop | Desktop app starts local MCP | Browser app plus Node server | Defer native app | Later |
| Cloud app | Paper web app and account workspace | Production Vercel app with Supabase | Keep and strengthen | P0 |
| Dashboard | Search, filters, list/grid, scratchpad, team nav | Board cards, basic stats, new board | Add search/list/archive/recent | P1 |
| File title | Inline rename | Project name display only | Add inline rename | P1 |
| Pages | Page list | Schema has pages, UI mostly artboards | Add page panel and page CRUD | P1 |
| Tool modes | Move/pan/frame/rect/text/image/SVG/shader | Mostly select plus add buttons | Add tool mode state machine | P0 |
| Direct drawing | Draw objects on canvas | Add preset/components only | Add drag-to-create | P0 |
| Canvas settings | Zoom menu, grid, snap, guides, nudge | Zoom buttons, fit/focus, fixed grid | Add menu/preferences | P1 |
| Layers | Mature hierarchy, rename, reparent, lock, hide | Nested list, lock/hide, no reparent | Upgrade layer editor | P0 |
| Inspector | Rich grouped property panels | Basic fields | Replace with sectioned inspector | P0 |
| CSS layout | Flex/constraints/CSS properties | Mostly absolute plus partial schema | CSS-first renderer/model | P0 |
| Auto-layout reliability | Flex/constraints are core design primitives | Schema hints exist, behavior is not reliable enough | Build real auto-layout and constraints, test with app screens | P0 |
| Text editing | Direct on-canvas text edit | Inspector-only text | Add direct text editing | P1 |
| Material icons | Rich icon use through design/code workflows | No reliable Material icon primitive | Add deterministic Material Symbols/Icon node with export support | P0 |
| Lines/sparklines | Shape/vector/chart primitives support detailed UI | Weak line/sparkline primitives | Add line/polyline/sparkline primitives and SVG export | P0 |
| Selection colors | Counts and replacement | None | Add color inventory/replacement | P1 |
| Imports | Image, SVG, Figma, web snapshot | Image/screenshot overlay | Add SVG, HTML paste, snapshot helper | P1/P2 |
| AI image | Prompt, model, ratio | None | Add one-provider image generation | P2 |
| AI SVG | Prompt and vector tools | None | Add constrained icon/SVG generation | P2 |
| Shaders | Large shader library | None | Add lightweight effect nodes only | P3 |
| Exports | PNG/JPG/AVIF/WebP/video/code presets | PNG/spec/React Tailwind | Add export panel and formats | P1 |
| PNG text fidelity | Visual export should match editable design text | Editable text can break in PNG exporter | Fix text rendering before broad export polish | P0 |
| Codegen | CSS/React/Tailwind oriented | Basic React/Tailwind | Improve semantic CSS output | P0/P1 |
| MCP reads | Strong inspection suite | read/summarize/selection/validate | Add Paper-compatible inspection tools | P0 |
| MCP writes | HTML/style/text/rename/move/delete/duplicate | operation tools | Add write_html/update_styles wrappers | P0 |
| MCP exposure | Paper desktop exposes MCP directly to agents | Some agent contexts cannot see PowerBoard MCP | Add status checks, stdio/HTTP setup, and remote/local exposure docs | P0 |
| Working indicators | start/finish working nodes | agent-active ids from socket activity | Add explicit start/finish tools | P1 |
| Internal ids in UI | IDs are available, not primary visual labels | IDs are visibly noisy in layer/artboard labels | Hide ids by default; expose via copy/detail/developer mode | P0 |
| Prototypes | No-code interactions, motion | Connectors only | Add click hotspots and preview | P2 |
| Teams/billing | Built-in | None | Defer | Later |
| Multiplayer cursors | Toggle and build-log polish | Agent activity pulse only | Defer live cursors | Later |
| Video export | Pro feature | None | Defer | Later |

## North Star Architecture

PowerBoard should move toward a CSS-first semantic board engine:

- The board file remains a structured JSON model in Supabase.
- All browser edits and MCP edits go through the same operation service.
- The canvas renders real DOM/CSS for each artboard and node.
- Selection boxes, resize handles, snap lines, and hierarchy badges are editor overlays computed from DOM layout and board model.
- Absolute positioning remains supported for screenshot tracing and freeform mockups.
- Flex/stack/grid layout becomes real, not just a schema label.
- Export reads the same semantic node tree and outputs readable React/Tailwind or implementation specs.

This is the key to closing Paper's strongest advantage: agents understand DOM/CSS better than arbitrary mockup primitives.

## Detailed Implementation Plan

### Phase 0 - Product Boundary And Safety Rails

Goal: make sure the rebuild does not accidentally become a broad Figma clone or disrupt live boards.

Tasks:

- Create a durable roadmap doc from this plan. This file is that artifact.
- Keep source of truth in Supabase; no direct `boards/*/board.json` editing.
- Add a migration strategy before changing schema:
  - `schemaVersion: 2`.
  - explicit migration from v1 to v2.
  - fixture tests for current live board shapes.
  - rollback path by preserving v1 fields until renderers support v2.
- Add a board backup/export command before destructive migrations:
  - `npm run board:backup -- --board board_r0a28_b1otaq`.
  - saves a timestamped JSON backup outside tracked `boards/` or in a clearly named `backups/` ignored path.
- Add a "live board protection" rule in code:
  - operations validate the target board id.
  - destructive operations require explicit ids and fail on broad deletes.
  - MCP tools never mutate all boards.
- Define non-goals for v1:
  - native Mac app.
  - team billing.
  - organization admin.
  - full multiplayer.
  - full video editor.
  - complete shader library.

Acceptance:

- A current production board can be read and backed up.
- A v1 board can round-trip through schema validation.
- No local board files are modified by normal app/MCP work.

Files likely touched:

- `packages/schema/src/index.ts`
- `packages/schema/src/index.test.ts`
- `apps/server/src/boardService.ts`
- `apps/server/src/cloudStore.ts`
- `README.md`
- `AGENTS.md`

### Phase 0.5 - Agent Dogfooding Repair Batch

Goal: fix the concrete app-design blockers reported by an agent before the broader Paper-parity rebuild gets too abstract.

Why this phase exists:

- If agents cannot access MCP, they will mutate cloud board JSON through brittle API objects.
- If PNG export breaks editable text, the board cannot be trusted for visual handoff.
- If internal ids dominate labels, the UI feels like a database inspector rather than a design tool.
- If Material icons, lines, and sparklines are missing, agents have to fake common app UI with generic shapes.
- If auto-layout remains theoretical, app mockups will keep degrading as soon as screens need realistic adaptive structure.

Tasks:

- MCP exposure and status:
  - Add an obvious browser status panel for MCP availability: local HTTP endpoint, stdio command, storage mode, cloud store, and last successful tool call.
  - Add `npm run mcp:check` to verify the stdio MCP server can list tools with `POWERBOARD_STORAGE_MODE=cloud`.
  - Add a local HTTP MCP smoke command for `http://127.0.0.1:4318/mcp`.
  - Update `get_guide` and docs so another project agent knows exactly how to connect.
  - Treat direct REST mutation as a fallback for read/status and emergency recovery, not the normal design path.
- PNG editable text repair:
  - Create a fixture artboard with editable text covering multiline text, font weight, line height, letter spacing, color, opacity, alignment, and clipped containers.
  - Fix the PNG exporter so this fixture renders as nonbroken text.
  - Prefer exporting from the same DOM/CSS rendering path used by the editor where possible; avoid a separate handwritten text layout path unless tests cover it.
  - Add a regression test that fails when editable text disappears, clips incorrectly, or renders as fallback placeholders.
- Hide internal ids in the UI:
  - Remove ids from default artboard labels, layer rows, and selection badges.
  - Keep ids accessible through tooltip/detail rows, copy-id actions, and an optional developer/agent mode.
  - Keep semantic names and roles visible because those are useful for design review.
- Material icon primitive:
  - Add `icon` or `materialIcon` element support with deterministic properties:
    - icon name.
    - style family: outlined, rounded, sharp.
    - fill.
    - weight.
    - grade.
    - optical size.
    - color.
    - size.
  - Validate icon names against a known registry or local bundled metadata.
  - Render missing icons as explicit broken-icon states, not blank boxes.
  - Export icons to PNG and React/Tailwind without depending on invisible local fonts.
- Line and sparkline primitives:
  - Add `line`, `polyline`, and `sparkline` element types or one `vectorLine` type with modes.
  - Support stroke color, width, opacity, dash, cap, join, points, smoothing, and arrowheads.
  - For sparklines, support data values, min/max domain, positive/negative color, and optional baseline.
  - Render/export as SVG so chart-like UI does not need to be faked with many rectangles.
- Auto-layout proving ground:
  - Add two app-screen fixtures that require real layout:
    - a settings/list screen with rows, icons, labels, trailing values, and dividers.
    - a dashboard card with sparkline, metric label, value, and responsive padding.
  - The fixtures must be editable, exportable, and inspectable through MCP.

Acceptance:

- A separate agent can connect through the documented MCP route and list tools without editing raw board JSON.
- Exporting a text-heavy editable artboard produces a nonblank PNG with readable text.
- Default UI labels show human names/roles, not raw internal ids.
- Material icons render in editor, PNG export, spec export, and React/Tailwind export.
- Lines and sparklines render in editor, PNG export, spec export, and React/Tailwind export.
- At least one fixture proves auto-layout/constraints with icons, text, dividers, and a sparkline.

Files likely touched:

- `package.json`
- `apps/server/src/mcpServer.ts`
- `apps/server/src/index.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/styles.css`
- `packages/schema/src/index.ts`
- `packages/renderers/src/index.ts`
- `packages/renderers/src/index.test.ts`
- `README.md`
- `AGENTS.md`

### Phase 1 - Split The Editor Into Maintainable Modules

Goal: make the editor extensible before adding Paper-scale surface area.

Current problem:

- `apps/web/src/App.tsx` is carrying shell, routing, API calls, canvas camera, operation flow, toolbar, home, layers, artboards, elements, inspectors, field controls, utility functions, and interaction state.
- Adding Paper-grade inspector/layers/tools inside this file would produce a fragile product.

Tasks:

- Create `apps/web/src/editor/` modules:
  - `EditorShell.tsx`
  - `TopToolbar.tsx`
  - `LeftSidebar.tsx`
  - `RightInspector.tsx`
  - `CanvasViewport.tsx`
  - `ArtboardView.tsx`
  - `ElementView.tsx`
  - `LayersPanel.tsx`
  - `AssetsPanel.tsx`
  - `FlowsPanel.tsx`
  - `HomeView.tsx`
  - `fields/`
  - `hooks/useBoardOperations.ts`
  - `hooks/useCanvasCamera.ts`
  - `hooks/useSelection.ts`
  - `state/editorReducer.ts`
- Keep behavior identical during extraction.
- Add tests around pure editor utilities:
  - selection toggling.
  - element path.
  - bounds calculation.
  - camera transform.
  - layer indexing.

Acceptance:

- No user-visible behavior changes except cleaner code structure.
- `npm run typecheck`, `npm run build`, and `npm test` pass.
- Existing boards load in browser.

### Phase 2 - CSS-First Schema V2

Goal: add the model needed for Paper-like editing without breaking current boards.

Current v1 model:

- Artboards and elements are separate arrays.
- Elements have x/y/width/height.
- Elements have `layout.mode`, but rendering/export is mostly absolute.
- Style is a flat object.

Proposed v2 additions:

```ts
type BoardNodeKind =
  | "artboard"
  | "frame"
  | "group"
  | "rect"
  | "text"
  | "image"
  | "svg"
  | "component"
  | "hotspot"
  | "effect"
  | "screenshotOverlay";

type NodeSizing = {
  widthMode: "fixed" | "hug" | "fill";
  heightMode: "fixed" | "hug" | "fill";
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
};

type NodeLayout = {
  mode: "absolute" | "flex" | "grid";
  position: "absolute" | "relative";
  direction?: "row" | "column";
  wrap?: boolean;
  gap?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  alignItems?: "start" | "center" | "end" | "stretch";
  justifyContent?: "start" | "center" | "end" | "between" | "around" | "evenly";
  constraints?: {
    left?: boolean;
    right?: boolean;
    top?: boolean;
    bottom?: boolean;
    centerX?: boolean;
    centerY?: boolean;
    scaleX?: boolean;
    scaleY?: boolean;
  };
  ignoreParentLayout?: boolean;
};

type Paint =
  | { type: "solid"; color: string; opacity: number }
  | { type: "linearGradient"; stops: ColorStop[]; angle: number; opacity: number }
  | { type: "radialGradient"; stops: ColorStop[]; center: Point; radius: number; opacity: number }
  | { type: "image"; assetId: string; fit: "cover" | "contain" | "fill" | "crop"; opacity: number };

type NodeStyleV2 = {
  css?: Record<string, string | number>;
  fills: Paint[];
  strokes: Stroke[];
  shadows: Shadow[];
  innerShadows: Shadow[];
  filters: FilterEffect[];
  backdropFilters: FilterEffect[];
  blendMode?: string;
  radius?: number | { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number };
  opacity: number;
  typography?: TypographyStyle;
};
```

Required schema concepts:

- `pages[]` with page-level background and canvas settings.
- `nodesById` optional derived index server-side, not source of truth.
- `artboards[]` can remain as top-level nodes for v2 compatibility.
- `elements[]` remains for v1 compatibility, but new code treats all editable items as nodes.
- `exportSettings` on board, artboard, and node.
- `interaction` metadata for prototype preview.
- `component` metadata for variants/props later.
- `asset` metadata: mime, dimensions, size, source, dominant colors, hash.
- `editorPreferences`: grid, snap, guides, nudge, zoom behavior.
- `audit`: createdBy, updatedBy, lastAgentEditedAt.

Migration:

- `migrateBoardProject(project)` detects schema version.
- v1 flat style maps into v2 `fills`, `strokes`, `shadows`, `typography`.
- v1 `layout.mode === "stack"` maps to v2 `mode: "flex"`, direction column by default unless props indicate nav/tabbar horizontal.
- v1 x/y/w/h remains as fixed bounds.

Acceptance:

- All current boards validate after migration.
- Existing renderers can still render migrated boards.
- Existing MCP tools still work.
- Tests cover v1 to v2 migration for at least:
  - text element.
  - frame with children.
  - screenshot overlay.
  - artboard.
  - current live board fixture summary.

### Phase 3 - CSS-First Canvas Renderer

Goal: make the browser canvas reflect real CSS layout so agents and exports see the same structure.

Renderer design:

- Keep the large canvas plane and camera transform.
- Render artboards as positioned surfaces.
- Inside an artboard, render nodes as DOM elements with actual CSS:
  - absolute nodes use `position: absolute`.
  - flex nodes use `display: flex`.
  - grid nodes use `display: grid` when introduced.
  - fill/hug/fixed sizing maps to CSS width/height/min/max.
- Compute selection overlays from DOM `getBoundingClientRect` plus camera transform.
- Store model bounds separately from measured bounds:
  - model bounds for absolute nodes.
  - measured bounds for flex children.
- Add a measurement service:
  - map node id to DOM rect.
  - expose to inspector and snap engine.
  - expose to MCP `get_computed_styles`.

Why this matters:

- Paper's agent quality comes from web standards and DOM/CSS.
- React/Tailwind export becomes much easier when the board already behaves like a web layout.
- Screenshot tracing still works because absolute overlays stay supported.

Tasks:

- Create `nodeToCss.ts`.
- Create `CanvasNode.tsx`.
- Create `SelectionOverlay.tsx`.
- Create `ResizeHandles.tsx`.
- Create `measurementStore.ts`.
- Update renderer to use v2 style and layout fields.
- Support basic transforms:
  - rotation.
  - opacity.
  - blend mode.
- Keep current visual output as close as possible for existing boards.

Acceptance:

- Existing board renders without major visual regressions.
- Selecting flex children shows accurate overlays.
- Moving absolute nodes still works.
- Resizing fixed nodes still works.
- Inspector displays measured layout values for relative/flex children.

### Phase 4 - Tool Mode System And Direct Creation

Goal: match the basic Paper editor feel: move, pan, frame, rectangle, text, image, screenshot overlay, component.

Tool modes:

- `select`
- `pan`
- `frame`
- `rect`
- `text`
- `image`
- `screenshot`
- `component`
- `hotspot`

Not v1:

- `shader` can wait until effect nodes exist.

Behavior:

- Toolbar uses icons and tooltips.
- `V` selects.
- `H` pans.
- `F` frame.
- `R` rectangle.
- `T` text.
- `I` image.
- Drag on canvas creates the item.
- Click with text tool creates editable text.
- Drag with frame tool creates custom frame; dropdown still provides device presets.
- Component insertion can be click-to-place or drag-to-place.
- Escape returns to select.
- Space temporarily pans.

Creation rules:

- New nodes always get:
  - id.
  - name.
  - semantic role placeholder.
  - hierarchy path.
  - createdAt/updatedAt metadata.
- New nodes land inside the artboard under cursor if possible.
- If no artboard under cursor, frame tool can create an artboard; other tools require an artboard and show status feedback.
- Snapshot overlays default locked and low z-index.

Acceptance:

- Browser-tested direct creation for frame, rect, text, image, screenshot overlay.
- No console errors.
- Undo/redo works for creation.
- MCP-created and browser-created nodes use same operation path.

### Phase 5 - Canvas Settings, Guides, Snapping, Nudge

Goal: close the daily interaction gap with Paper.

Canvas settings menu:

- Zoom in.
- Zoom out.
- Zoom to 100%.
- Zoom to fit all.
- Zoom to selection.
- Center zoom on selection.
- Invert zoom direction.
- Show grid.
- Show pixel grid.
- Snap to pixel.
- Show layout guides.
- Show rulers later.
- Small nudge value.
- Large nudge value.

Snapping:

- Snap to pixel.
- Snap to artboard edges.
- Snap to sibling edges.
- Snap to centers.
- Snap to spacing when equal gaps detected.
- Show snap lines.
- Snap disabled while holding modifier.

Nudge:

- Arrow keys move selected absolute nodes by small nudge.
- Shift+arrow moves by large nudge.
- Nudge values stored in editor preferences.
- Nudge uses operation service and preserves undo history.

Acceptance:

- Keyboard and pointer interactions are browser-tested.
- Snapping never moves locked nodes.
- Hidden nodes are ignored.
- Pixel grid only appears at useful high zoom threshold.

### Phase 6 - Paper-Grade Layer Panel

Goal: make hierarchy inspection and cleanup fast enough for agent-created boards.

Layer panel features:

- Page grouping.
- Artboard grouping.
- Nested elements.
- Inline rename.
- Expand/collapse per node.
- Search.
- Filter by node type.
- Filter by semantic role.
- Lock/hide toggles.
- Drag reorder within parent.
- Drag reparent.
- Badges:
  - absolute.
  - flex.
  - grid.
  - locked.
  - hidden.
  - screenshot overlay.
  - agent working.
- Context menu:
  - rename.
  - duplicate.
  - group.
  - ungroup.
  - lock/unlock.
  - show/hide.
  - delete.
  - copy id.
  - copy hierarchy path.
- "Clean hierarchy" action for agent boards:
  - flags unnamed nodes.
  - flags missing semantic roles.
  - flags overlapping ungrouped clusters.
  - suggests group names.

Acceptance:

- Deeply nested board remains usable.
- Reparenting cannot create cycles.
- Locked nodes cannot be accidentally reparented.
- Layer selection and canvas selection stay in sync.

### Phase 7 - Sectioned Inspector

Goal: bring Paper's right inspector depth into PowerBoard while preserving PowerBoard's semantic model.

Inspector sections:

- Identity:
  - name.
  - id.
  - type.
  - semantic role.
  - hierarchy path.
  - created/updated metadata.
- Layout:
  - x/y/w/h for absolute/fixed nodes.
  - measured x/y/w/h for flex children.
  - rotation.
  - sizing modes fixed/hug/fill.
  - constraints.
  - clip content.
- Auto layout:
  - mode none/flex/grid.
  - direction.
  - wrap.
  - gap.
  - padding.
  - align.
  - justify.
  - ignore parent layout.
- Typography:
  - text content.
  - font family.
  - size.
  - weight.
  - line height.
  - letter spacing.
  - alignment.
  - wrap/truncate/case.
- Fill:
  - solid.
  - gradient.
  - image fill.
  - opacity.
  - multiple fills later.
- Stroke/outline:
  - side/all.
  - width.
  - color.
  - opacity.
  - style.
- Radius:
  - uniform.
  - individual corners.
- Shadow:
  - outer shadow.
  - inner shadow.
  - multiple shadows later.
- Effects:
  - blur.
  - backdrop blur.
  - brightness/saturation/grayscale/invert/hue rotate later.
  - blend mode.
- Image:
  - asset.
  - fit.
  - crop/focal point.
  - replace asset.
  - extract colors.
- Export:
  - format.
  - scale.
  - width/height presets.
  - transparent background.
  - export selected/artboard.
- Semantics:
  - role.
  - data binding placeholder.
  - implementation note.
  - accessibility label.
- Code:
  - copy React/Tailwind for selection.
  - copy implementation spec for selection.
  - validate implementation readiness.

Multi-selection inspector:

- Shows count of artboards/elements.
- Mixed values state.
- Align/distribute.
- Batch lock/visibility.
- Batch semantic prefix.
- Batch replace color.
- Group/ungroup/duplicate/delete.

Acceptance:

- Inspector sections are collapsible.
- Fields use appropriate controls: icons, swatches, segmented controls, toggles, sliders, number inputs.
- Every visible control works or has a clear disabled state.
- Text does not overflow controls.

### Phase 8 - Color Inventory And Design Tokens

Goal: match Paper's selection colors while using PowerBoard tokens as a differentiator.

Features:

- Selection color inventory:
  - color swatch.
  - hex/string value.
  - opacity.
  - usage count.
  - node list.
  - replace selected color.
- Board color inventory:
  - all colors across board.
  - token-linked colors.
  - unlinked colors.
  - near-duplicate colors.
- Token sync:
  - create token from color.
  - apply token to selected nodes.
  - rename token.
  - detect orphan token.
- Agent validation:
  - `validate_board` reports excessive color drift.
  - `summarize_board` includes token coverage.

Acceptance:

- Counts match actual node styles.
- Color replacement is undoable.
- Screenshot overlays are excluded from editable color counts unless explicitly included.

### Phase 9 - MCP Parity Layer

Goal: let Codex operate PowerBoard with the same confidence Paper's MCP enables, while keeping PowerBoard's cloud operation model.

Current PowerBoard MCP tools:

- `list_boards`
- `read_board`
- `summarize_board`
- `create_board`
- `create_artboard`
- `update_artboard`
- `create_variant`
- `add_element`
- `update_element`
- `delete_element`
- `move_resize_element`
- `get_selection`
- `set_selection`
- `describe_selection`
- `add_connector`
- `import_screenshot_overlay`
- `export_artboard_png`
- `export_react_tailwind`
- `export_board_spec`
- `validate_board`

Paper-compatible tools to add:

- `get_basic_info`
  - board name, page name, node count, artboards, fonts.
- `get_node_info`
  - id, name, type, parent, children, bounds, visibility, lock, text, semantic role, layout.
- `get_children`
  - direct children with counts and order.
- `get_tree_summary`
  - compact hierarchy text by node/artboard/page.
- `get_screenshot`
  - node/artboard screenshot at 1x/2x.
- `get_jsx`
  - JSX for node/artboard, inline styles or Tailwind.
- `get_computed_styles`
  - CSS/model styles for node ids.
- `get_fill_image`
  - asset/image fill extraction.
- `get_font_family_info`
  - project/local/web-safe font info; can start with project fonts and system-safe list.
- `get_guide`
  - PowerBoard-specific guides:
    - `agent-design-workflow`
    - `screenshot-tracing`
    - `app-screen-mockup`
    - `react-tailwind-export`
    - `cloud-source-of-truth`
    - `paper-gap-plan`
- `find_placement`
  - place artboard without overlap.
- `write_html`
  - parse constrained HTML/CSS into editable nodes.
- `set_text_content`
  - batch text changes.
- `rename_nodes`
  - batch rename.
- `duplicate_nodes`
  - deep clone with id map.
- `update_styles`
  - batch style updates.
- `delete_nodes`
  - batch delete with child handling.
- `move_nodes`
  - position/reparent/reorder.
- `start_working_on_nodes`
  - show agent active indicators.
- `finish_working_on_nodes`
  - clear indicators.
- `export`
  - unified export for png/jpg/webp/avif/spec/react/tailwind.

Tool design rules:

- All writes use the same board operation service.
- Tools return ids, names, changed counts, and validation warnings.
- Tools accept boardId explicitly unless a single active board is configured.
- Tools never write raw SQL.
- Tools never edit local board files.
- Tools include `dryRun` where useful for bulk operations.
- Tools are documented in `get_guide`.

Acceptance:

- Codex can:
  - inspect a board.
  - select an artboard.
  - get screenshot.
  - get JSX.
  - write a small HTML section.
  - rename layers.
  - update styles.
  - export React/Tailwind.
  - validate.
- Browser shows MCP edits live over WebSocket.

### Phase 10 - HTML And Web Snapshot Import

Goal: close Paper's "design/code loop" and Snapshot-style advantage without waiting for Figma import.

`write_html` parser:

- Input:
  - HTML string.
  - optional CSS string.
  - parent node id or artboard id.
  - mode: insert children, replace children, replace node.
  - placement.
- Supported tags first:
  - div.
  - section.
  - header.
  - footer.
  - nav.
  - main.
  - article.
  - button.
  - input placeholder representation.
  - img.
  - svg.
  - span/p/strong/h1-h6.
  - ul/ol/li.
- CSS support first:
  - display flex.
  - position absolute/relative.
  - width/height.
  - padding/gap.
  - background.
  - color.
  - border.
  - radius.
  - shadow.
  - font.
  - opacity.
- Security:
  - sanitize HTML.
  - no script execution.
  - no external network fetch unless explicitly allowed.

Snapshot helper:

- Browser bookmarklet or small local route that captures a selected DOM subtree.
- Captures computed styles and asset references.
- Sends HTML/CSS payload to PowerBoard import.
- Keeps source URL metadata.

Acceptance:

- Import a small live app section into an editable artboard.
- Imported layers have useful names.
- Generated hierarchy passes validation.
- No script or unsafe HTML executes.

### Phase 11 - SVG Import, SVG Creation, And Icon Workflow

Goal: make app mockups more complete without depending on raster screenshots.

SVG import:

- Upload SVG.
- Sanitize.
- Convert simple shapes:
  - rect.
  - circle/ellipse.
  - line.
  - path as svg/path node.
  - text if present.
- Preserve colors.
- Add selection color inventory support.

SVG generation:

- Prompt panel for icon/SVG.
- Start with one provider or local structured SVG prompt.
- Output editable SVG node or converted simple nodes.
- Generate name and semantic role.

Vector utilities:

- Extract colors from SVG/image.
- Vectorize can wait unless a reliable local dependency is chosen.
- Remove background can wait.

Acceptance:

- Uploading an SVG creates editable/selectable nodes.
- Export preserves SVG appearance.
- React/Tailwind export handles inline SVG or componentized SVG.

### Phase 12 - AI Image Generation

Goal: match the useful part of Paper's image generation for app mockups.

V1 controls:

- Prompt.
- Aspect ratio:
  - 1:1.
  - 4:3.
  - 16:9.
  - 3:4.
  - 9:16.
  - custom artboard ratio.
- Style preset:
  - product screenshot.
  - icon.
  - illustration.
  - texture.
  - avatar.
- Insert target:
  - new image element.
  - selected image fill.
  - selected frame background.
- Save to cloud assets.
- Store generation metadata in asset.

Provider:

- Start with OpenAI image generation if configured.
- Use environment variables server-side.
- No API keys in browser.

Safety:

- User-visible generation status.
- Failed generation leaves no broken node.
- Large images are resized/compressed server-side.

Acceptance:

- Generate image and insert into selected artboard.
- Asset persists in Supabase.
- Export includes image.

### Phase 13 - Export Panel And Codegen Upgrade

Goal: make PowerBoard exports implementation-ready, not merely visual.

Export panel:

- Appears for selected artboard/node.
- Presets:
  - 0.5x, 1x, 2x, 3x, 4x.
  - 512w, 512h.
  - 720p, 1080p, 1440p, 2160p.
- Formats:
  - PNG.
  - JPG.
  - WebP.
  - AVIF.
  - Spec Markdown.
  - React/Tailwind.
  - React/CSS inline.
- Options:
  - transparent background.
  - include/exclude locked screenshot overlays.
  - include/exclude annotations.
  - selected node vs entire artboard.

Codegen upgrade:

- Use CSS-first node tree.
- Component output:
  - one React component per artboard.
  - optional subcomponents for named semantic groups.
  - tokens file.
  - assets manifest.
  - interaction map.
- Tailwind output:
  - idiomatic utility classes where practical.
  - arbitrary values only when needed for fidelity.
  - flex layout instead of absolute positioning when model uses flex.
- Spec output:
  - hierarchy tree.
  - token table.
  - interaction table.
  - accessibility notes.
  - image asset list.
  - implementation caveats.

Acceptance:

- Exported PNG is nonblank and visually matches browser artboard.
- Exported React/Tailwind builds in a simple fixture app.
- Spec references semantic roles and hierarchy paths.
- Export behavior has tests.

### Phase 14 - Prototype Preview

Goal: add the app-flow parts Paper hints at while staying focused on screen mockups.

Data model:

- `interactions[]` on nodes:
  - trigger: click/tap/hover.
  - action: navigate/openOverlay/closeOverlay/toggleState.
  - target artboard/node id.
  - transition: instant/fade/slide.

UI:

- Hotspot tool.
- Flow lines remain.
- Preview button.
- Preview mode opens selected starting artboard.
- Click through artboards.
- Show missing target warnings.

Acceptance:

- Can create a simple 3-screen tap-through.
- Export spec includes interaction map.
- MCP can add and inspect interactions.

### Phase 15 - Light Effects And Shader Bridge

Goal: capture the useful design polish without turning PowerBoard into a visual effects app.

V1 effects:

- CSS blur.
- backdrop blur.
- saturation/brightness/grayscale.
- grain/noise overlay as CSS/image asset.
- mesh/static gradient element.

Optional shader node:

- `effect` node with `engine: "css" | "paper-shader"`.
- If using Paper Shaders package, keep it isolated:
  - renderer can show it.
  - export can emit dependency or raster fallback.
  - validation warns if target app cannot use it.

Deferrals:

- Video shader animations.
- Full parameter panels for every shader.
- Particle/Three.js islands.

Acceptance:

- Effects do not break PNG export.
- Code export either emits supported React code or clear fallback.

### Phase 16 - Dashboard And Single-User Workspace

Goal: close Paper's dashboard gap without building team SaaS.

Features:

- Search boards.
- Recents.
- Archived.
- Grid/list toggle.
- Sort by name/updated/created.
- New board.
- Duplicate board.
- Rename board.
- Archive/unarchive.
- Delete with explicit confirmation.
- Board thumbnail generation.
- Storage status.
- Source of truth badge.
- Last agent edit badge.
- Owner account label from env/auth if available.

Skip:

- Billing.
- Members.
- Roles.
- Invites.

Acceptance:

- User can find and open boards quickly.
- Archive does not delete data.
- Thumbnails update after board save/export.

### Phase 17 - Validation, Audits, And Agent Review

Goal: make PowerBoard safer than Paper for solo agent collaboration.

Validation checks:

- Every artboard has name/id/type/background.
- Every element has name/id/type/role/path.
- No cycles.
- No orphan parent ids.
- No missing assets.
- No invisible selected nodes.
- Locked screenshot overlays are behind editable recreation layers.
- Color token drift.
- Excessive absolute positioning inside intended flex groups.
- Text overflow likely.
- Missing export settings.
- Broken interactions.
- Board schema version current.

Agent review panel:

- Shows validation issues.
- Lets user select issue target.
- Lets Codex/MCP fix issue.
- Stores last validation timestamp.

Acceptance:

- `validate_board` and browser validation show same issue list.
- Export refuses or warns on severe broken state.

## Implementation Order

This is the recommended sequence. It is intentionally ordered to reduce rewrites.

1. Backups, migration harness, MCP exposure checks, and PNG editable-text regression fixture.
2. Agent dogfooding repairs: hide internal ids, add Material icon primitive, add line/sparkline primitives, and prove one auto-layout fixture.
3. Editor module split.
4. Schema v2 style/layout model.
5. CSS-first canvas renderer with selection overlay.
6. Tool modes and direct creation.
7. Layer panel upgrade.
8. Sectioned inspector.
9. MCP parity read tools.
10. MCP parity write tools.
11. Export panel and codegen upgrade.
12. HTML import/write_html.
13. SVG import and icon workflow.
14. Canvas settings, snapping, nudge, and guides.
15. Color inventory/tokens.
16. Dashboard polish.
17. AI image generation.
18. Prototype preview.
19. Lightweight effects/shader bridge.

Reasoning:

- MCP exposure must be fixed before agents are asked to dogfood the product again.
- PNG text export and human-readable labels must be fixed before visual review is trusted.
- Material icons and line/sparkline primitives must land early because they are common app UI, not optional decoration.
- Schema and renderer must come before full inspector/codegen parity.
- MCP parity should deepen once the internal model can answer Paper-like questions, but basic MCP availability is immediate P0.
- AI generation is useful, but not as foundational as inspectable layout and export correctness.
- Shaders/video/team features are not core to the user's stated PowerBoard goal.

## File-Level Work Map

### Schema

- `packages/schema/src/index.ts`
  - Add v2 style/layout/export/interaction types.
  - Add migration function.
  - Preserve v1 compatibility.
- `packages/schema/src/index.test.ts`
  - Migration tests.
  - validation tests.
  - fixture tests.

### Server

- `apps/server/src/boardService.ts`
  - Add schema migration on read/save.
  - Add backup helper.
  - Add stronger operation validation.
  - Add explicit batch operations.
- `apps/server/src/cloudStore.ts`
  - Preserve Supabase source of truth.
  - Add optional thumbnail/export metadata writes.
- `apps/server/src/mcpServer.ts`
  - Add Paper-compatible MCP tools.
  - Add `get_guide` content.
  - Add `write_html`.
  - Add batch style/text/rename/duplicate/delete.
- `apps/server/src/index.ts`
  - Add API routes for export presets, thumbnails, snapshot import, AI generation.

### Web App

- `apps/web/src/App.tsx`
  - Shrink into shell/routing only.
- `apps/web/src/editor/*`
  - New editor modules.
- `apps/web/src/editor/canvas/*`
  - CSS-first renderer.
  - selection overlay.
  - measurement store.
  - snap engine.
- `apps/web/src/editor/inspector/*`
  - sectioned inspector.
- `apps/web/src/editor/layers/*`
  - hierarchy editor.
- `apps/web/src/editor/tools/*`
  - tool mode system.
- `apps/web/src/editor/assets/*`
  - upload, image generation, SVG import.
- `apps/web/src/styles.css`
  - Rework to denser design-tool UI.
  - Keep 8px radius or less for cards/panels unless existing controls require otherwise.
  - Avoid decorative background noise.

### Renderers

- `packages/renderers/src/index.ts`
  - Render v2 CSS model.
  - Export PNG/JPG/WebP/AVIF.
  - Improve React/Tailwind output.
  - Add selection/node export.
- `packages/renderers/src/index.test.ts`
  - nonblank export tests.
  - React/Tailwind snapshot tests.
  - spec export tests.

### Docs

- `README.md`
  - Update when commands/features change.
- `AGENTS.md`
  - Update only when a durable rule changes.
- `Documents/`
  - Keep planning/assessment docs here.

## Verification Plan

For each implementation batch:

- Unit tests for schema/operation changes.
- Typecheck.
- Build.
- Focused browser test for UI changes.
- Browser console check.
- MCP smoke test for MCP changes.
- Export smoke test for export changes.
- Live cloud read-back for cloud changes.

Minimum browser scenarios:

- Open board list.
- Open `board_r0a28_b1otaq`.
- Pan and zoom.
- Select artboard.
- Select child element.
- Rename layer.
- Toggle lock/visibility.
- Create rectangle/text/frame.
- Undo/redo.
- Export PNG.
- Export React/Tailwind.
- Validate board.

Minimum MCP scenarios:

- `get_basic_info`
- `get_tree_summary`
- `get_node_info`
- `get_screenshot`
- `get_jsx`
- `write_html`
- `update_styles`
- `rename_nodes`
- `duplicate_nodes`
- `delete_nodes`
- `validate_board`

Export checks:

- PNG nonblank.
- PNG dimensions match requested preset.
- JPG/WebP/AVIF conversion works.
- React/Tailwind output compiles.
- Spec includes hierarchy, semantics, tokens, and interactions.

Cloud checks:

- Health reports Supabase cloud direct.
- Board save updates `updatedAt`.
- Browser and MCP see same board after save.
- No local `boards/*` writes during normal work.

## Risk Register

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| CSS-first renderer breaks current boards | Existing CentsCheck boards are valuable live work | v1 compatibility layer, fixture tests, visual browser checks |
| Schema expands too fast | Complex schema can slow implementation | Add v2 fields in thin slices, migrate lazily |
| Inspector becomes cluttered | Paper depth can overwhelm | Collapsible sections, mixed value states, hide irrelevant fields |
| MCP tools diverge from browser behavior | Agent edits become unsafe | All writes go through operation service |
| HTML import becomes unsafe | Imported scripts/styles can break app | Sanitize, whitelist CSS, no script execution |
| Codegen remains too absolute | Exports are hard to implement | CSS-first renderer before codegen rewrite |
| AI tools distract from core editor | Easy to chase model variety | One reliable provider after core inspect/export loop |
| Shaders bloat product | Not central to app mockups | Effects only after core product is strong |
| Live board data loss | User has real work in cloud | Backups, explicit destructive ops, no raw local edits |

## What To Defer Explicitly

Defer now:

- Native Mac app.
- Team/member management.
- Billing.
- Organization/SAML/admin controls.
- Multiplayer cursors.
- Full video export.
- Timeline animation editor.
- Full shader library.
- Broad Figma clone features that do not help app mockups.
- Public sharing/permission system unless user needs it.

Do not defer:

- Cloud source of truth.
- MCP exposure and documented agent connection.
- PNG editable-text correctness.
- Human-readable UI labels without visible internal ids by default.
- Material icon primitive.
- Line and sparkline primitives.
- Strong MCP inspection and write operations.
- CSS-first semantic structure.
- Layer/inspector maturity.
- Screenshot tracing.
- Reliable exports.
- Browser verification.

## First Concrete Build Batch

If implementation starts immediately, the first batch should be:

1. Add board backup/migration harness.
2. Add MCP exposure checks:
   - `npm run mcp:check`.
   - local HTTP MCP smoke test.
   - visible browser MCP/storage status.
   - docs that make raw API mutation a fallback, not the normal agent path.
3. Add PNG editable-text regression fixture and fix the exporter until it passes.
4. Hide internal ids by default in artboard labels, layer rows, and selection badges while preserving copy-id/detail access.
5. Add Material icon and line/sparkline schema/render/export primitives.
6. Split `App.tsx` into editor modules without behavior changes.
7. Add Paper-compatible MCP read tools:
   - `get_basic_info`
   - `get_node_info`
   - `get_children`
   - `get_tree_summary`
   - `get_jsx`
   - `get_computed_styles`
8. Add `get_guide` with PowerBoard-specific agent workflows.
9. Add tests and run typecheck/build/test.

Why this batch first:

- It improves agent collaboration immediately.
- It addresses the exact dogfooding failures that forced brittle direct API mutation.
- It makes exported visual proof trustworthy again.
- It does not require major renderer rewrites yet.
- It creates a safer base for the larger CSS/layout migration.
- It honors the user's cloud-first and agent-first priorities.

## Second Concrete Build Batch

1. Introduce schema v2 style/layout fields behind compatibility helpers.
2. Add migration tests.
3. Add CSS serialization helpers.
4. Add inspector sections for Identity, Layout, Fill, Typography, Semantics.
5. Keep existing visual output stable.

## Third Concrete Build Batch

1. Add tool modes.
2. Add direct rectangle/text/frame creation.
3. Add keyboard nudge settings.
4. Add grid/snap/guides toggles.
5. Browser-test interactions.

## Definition Of Airtight For This Roadmap

This roadmap is airtight when every build slice satisfies all of these:

- It names the exact user-facing behavior being added.
- It names the schema/API/MCP surface affected.
- It preserves cloud as source of truth.
- It keeps browser and MCP edits on the same operation path.
- It has a migration or compatibility story.
- It has tests proportional to risk.
- It has browser verification for interaction changes.
- It has export verification for export changes.
- It avoids unrelated worktree changes.
- It does not spend time on native app/team/billing/video/shaders before the core app-mockup loop is excellent.
