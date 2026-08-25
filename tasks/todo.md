# PowerBoard v2 — Desktop-first master plan

Source of truth for the v2 pivot. Full rationale + feature matrix: `docs/powerboard-desktop-roadmap.html`.
Written 2026-07-04. Status legend: [ ] todo · [~] in progress · [x] done.

## Active — Comments: right-click → comment on any element (2026-08-08)

User ask: right-click a selected element → add a comment; polished end-to-end, then TestFlight.
Greenfield — repo-wide grep confirms no comment/annotation code and **no context menu of any kind** exists.

**The product frame.** Comments are the human↔agent feedback channel: the user leaves a comment on an
element, an agent reads it over MCP, fixes the thing, replies, and resolves. So comments must be
first-class board data flowing through the operation model — not UI-local state — and the MCP surface
ships in the same pass as the pins.

### Decisions taken before coding

- **D-i — Sibling collection, not an element type.** `comments: CommentThread[]` beside `connectors`.
  A comment has no zIndex/style/export representation; renderers iterate `elements` + `connectors`
  only, so annotations stay out of every export for free. D5 ("extend the existing object") doesn't
  apply — a thread is not a canvas object.
- **D-ii — Threads with embedded messages**, anchored to one `elementId`. No `parentCommentId` graph:
  a flat `messages[]` inside the thread means no cycle checks, one popover, one resolve bit. Free-
  floating canvas comments (Figma's click-anywhere) are out of scope — the ask is element comments.
- **D-iii — No schemaVersion bump.** `.default([])` IS the migration; bumping the `z.literal(1)`
  would hard-fail every stored board (no migrator exists).
- **D-iv — Comments are not selectable.** No `filterValidSelection` change; comment ops leave
  `selection` untouched.
- **D-v — Ops: `add_comment` (thread, first message inside), `reply_comment`, `set_comment_resolved`
  (boolean, so reopen is the same op), `delete_comment`.** Replying does NOT auto-reopen a resolved
  thread — resolution is an explicit act. No message-edit op in v1 (flagged follow-up).
- **D-vi — Cascades**: `delete_element`/`delete_artboard` prune threads of removed elements (same as
  connectors). `create_variant` does NOT clone comments — feedback belongs to the original.
- **D-vii — Right-click menu is element-scoped v1**: Add comment · Duplicate · Delete. Native menu
  suppressed on canvas. Multi-select right-click anchors the comment to the clicked element.

### Build — in dependency order

- [x] `packages/schema` (schemas live in `index.ts` — the `connector.ts` split is for geometry, which
      comments don't have): `CommentMessageSchema` /
      `CommentThreadSchema` + factories (`createCommentThread`/`createCommentMessage` — id + nowIso
      stamping in one place); collection + superRefine (unique ids, dangling `elementId` = error,
      matching connectors); 4 op variants + `applyBoardOperation` cases (throw `... not found` — the
      string is load-bearing for MCP error codes); cascade pruning; tests.
- [x] `apps/server`: `targetIdsForOperation` cases (pulse the commented element), `projectCounts.comments`;
      MCP tools `list_comments` / `add_comment` / `reply_comment` / `resolve_comment` / `delete_comment`
      (author = `currentAgent().name`, `authorKind: "agent"`); `mcpCheck` REQUIRED_TOOLS; undo/redo +
      attribution test; connector doc update.
- [x] `apps/web` — context menu: `onContextMenu` on the viewport (preventDefault, screen-coords menu),
      right-click selects the element under cursor if unselected; fixed the latent `ElementView`
      `onPointerDown` bug (button 2 selected AND started a drag — now guarded `button !== 0`).
      Native menu preserved inside text fields so cut/copy/paste survive.
- [x] `apps/web` — pins: plane-level layer beside `.selection-actionbar-anchor`, anchored at
      `elementWorldBounds` top-right, counter-scaled `1/zoom`; unresolved threads only; message-count
      chip; accent dot when an agent has written in the thread (agent-presence language); entrance
      animation opacity-only (the transform slot is the positioning math) and registered in the
      reduce-motion block.
- [x] `apps/web` — thread popover (same counter-scale pattern, edge-flip when the right edge would
      leave the viewport): messages (author · humanized time, "You" for user-kind, agent-lane dot for
      agents), composer (Enter submits, Shift+Enter newline, Esc closes), Resolve/Reopen, two-step
      Delete confirm. Composer-only mode for a fresh thread. All writes via `runOperation` →
      undo/WS/failLoud for free. Actionbar gained an Add-comment button; ⌘K palette gained
      "Add comment on selection".
- [x] `apps/web` — Comments panel in the right rail: unresolved rows (element name · snippet · time)
      with click-to-focus + open thread; "N resolved" expander so resolved threads stay reachable.
      `agentOperationVerb` cases so agent comments read "left a comment", not "edited the board".
- [x] Verified in the running app, console clean throughout: right-click → menu → composer → Enter →
      pin; reply; resolve (pin leaves, banner + Reopen); reopen from the panel's resolved expander
      (row click focuses + zooms to the element and opens the thread); two-step delete then **⌘Z
      brought the thread back** (server-snapshot undo covers comments with zero new code); full
      reload → pins/panel restore from disk. **Agent path over live MCP**: a "Claude" client ran
      list → reply → resolve → add_comment; the open popover live-updated with the reply mid-view,
      the feed logged "AI replied to a comment / resolved a comment / left a comment", the status
      bar read "AI left a comment", and the new agent thread's pin carried the accent dot. Both
      themes verified (popover/menu/panel are all-token, zero dark overrides needed). 120 tests
      (10 new), typecheck, build, `mcp:check` 47 exposed / 46 checked.
- [x] Verification notes: the browser harness's synthetic Return never reaches React's keydown —
      a real dispatched KeyboardEvent proved Enter-submit works; don't chase phantom bugs there.
      Known minor nit: a thread popover anchored to an element at the very top of the viewport can
      clip its header until the canvas is panned; focus-from-panel centres the element so the
      common path is unaffected.
- [x] Shipped: commit `f9e7869`, pushed to main, `fastlane mac beta` → build **202608081257**
      (v0.1.0), **VALID** in ASC ~4 min after upload (polled, not diagnosed — the lesson held).
      `bundle exec fastlane` failed fast on the missing Gemfile (caught in the log this time, not
      swallowed by a pipe); plain `fastlane mac beta` exit 0, 112MB `.pkg` verified on disk before
      trusting the exit code. Shipped `app.asar` verified to carry this session's code:
      `comment-pin`, "Leave feedback", "Add comment on selection", "Delete thread?",
      `reply_comment`/`list_comments`/`set_comment_resolved` all baked in; CFBundleVersion
      202608081257.

## Active — Auto-layout, finished: hug, escape hatch, honest modes (2026-08-07)

Closing every item left open by the first auto-layout pass rather than leaving them as "noted".

- [x] **A — Layer tree reads in flow order inside a stack.** The tree sorts `zIndex` descending, which is
      right for absolute z-order and backwards for a stack, where `zIndex` *is* the flow order — so the
      panel read bottom-to-top against the canvas. Stack children sort ascending; everything else is
      untouched.
- [x] **B — Hug sizing (`layout.sizing: "fixed" | "hug"`).** Today a fifth row in a four-row frame just
      overflows the box, silently. Hug makes the frame grow to its content on the main axis. Reflow becomes
      two passes: size **deepest-first** (a nested hug must be measured before its parent can measure
      itself), then position **shallowest-first**.
- [x] **C — `stack-overflows-frame` diagnostic.** Hug is opt-in, so a *fixed* frame can still be too small.
      That is now a real authoring error the agent can act on, and it should be told — same reasoning that
      made `text-overflows-box` worth shipping once wrapping was real.
- [x] **D — Per-child escape hatch (`layout.position: "flow" | "absolute"`).** Without it a badge, close
      button or overlay cannot sit on top of a stacked card — the whole frame has to be restructured.
      Figma has this for the same reason. Excluded from flow, stays absolute in the export.
- [x] **E — Delete `grid` and `constraints` from `layoutModes`.** They have never done anything. Leaving
      inert values in the enum is precisely the "declared but not implemented" disease this whole feature
      was built to cure, and documenting them as dead is a weaker fix than removing them. No board on disk
      uses either (checked); a legacy value still coerces to `absolute` on load so nothing can fail to
      open. `columns` goes with them.
- [x] Tests for each; verify in the running app.

**Result (verified live through the agent path, not just unit tests).** Hugging the 4-row frame took it
320 → **280px** (32 padding + 212 children + 36 gaps). Adding a fifth row grew it to **286** by itself.
Lifting a child out of the flow left it at its last position while its successor took the vacated slot,
and the hug measurement correctly ignored it; putting it back regrew the frame to **342**. The React
export tells the same story: parent `flex flex-col … p-[16px]`, flowing children with no positioning at
all, and the escaped child keeping `absolute left-[16px] top-[152px]` — which is what an overlay needs.
Layer tree now reads top-down in flow order inside a stack. 130 tests, typecheck, build,
`mcp:check` 47 exposed / 46 checked, console clean.

**Two things the work itself decided.**
1. **Coerce on read, reject on write.** A legacy `grid` board opens (mode coerced to `absolute`, which is
   what it always rendered as), but `set_layout {mode: "grid"}` now *throws* instead of quietly storing
   `absolute`. Silently granting a different thing than was asked for is the same class of dishonesty as
   the inert enum this change removed. A test asserts both halves.
2. **`laidOutByParent` was doing two jobs**, and it took looking at the screen to see it: the moment you
   set a child to Free, the control that would put it back disappeared, because the same flag gated both
   "is x/y derived?" and "is this inside a stack?". Split into `insideStack` and `laidOutByParent`.

Also corrected `inspect_selection`'s computed style, which reported `position: absolute` with a left/top
for every element — for a flow child that is CSS contradicting the export generated from the same board.
It now reports `position: static` and omits left/top for flowing children.

## Active — Auto-layout frames: make `layout.mode` real (2026-08-07)

Scope endorsed by the user after the 2026-07-29 finding. **`stack` only** — direction, gap, padding, align,
justify. `absolute` stays the default and stays correct for diagrams (D5 already allows both per element).
`grid` and `constraints` are explicitly NOT built; they keep their schema slots and stay inert, documented.

**The problem being fixed.** `layoutModes` has declared `stack` since the beginning and nothing honoured it:
the canvas always emitted `left/top/width/height`, and the React exporter wrote `flex flex-col gap-[12px]` on
a parent whose every child was `absolute` — which CSS discards, so the classes were decoration. The seed
board's three `stack` elements had zero children, so it never looked broken.

**Why it earns the work.** Not Paper parity — agent economics. Under absolute positioning "add a row to this
list" forces an agent to recompute every sibling below it, which is the damage `polish_layout` exists to
undo. Flow makes structural edits local. And "the export is real code" is the mockup half's whole value
proposition; `absolute left-[24px]` is not code anyone ships.

### Decisions taken before coding

- **D-a — One resolver, reflow on write.** `reflowStackLayouts(project)` runs at the single chokepoint at the
  end of `applyBoardOperation`, materialising children's x/y. Rejected the alternative (resolve lazily at
  render time) because it would force *every* consumer — canvas, SVG, React, connector geometry, layout
  diagnostics — to learn about layout, and any one that forgot would disagree with the others. That is
  exactly the divergence class the text-wrap bug came from. Derived x/y is safe here only because the
  operation model is the sole write path.
- **D-b — Stack order is `zIndex` ascending.** Renderers already sort children that way, so order on canvas,
  in the export and in the layer tree agree for free. Makes "reorder" reuse the existing forward/back ops.
- **D-c — Hidden children take no space**, matching Figma and CSS `display:none`.
- **D-d — No per-child absolute escape hatch.** Figma's `layoutPositioning: absolute` is real and useful, but
  it is a new schema field and a new inspector control; out of scope, noted here so it isn't re-derived.
- **D-e — Parent keeps its authored size.** Hug/fill sizing cascades to grandparents and is its own piece of
  work; `stretch` on the cross axis is included because it is free.

### Build

- [x] `packages/schema`: `resolveStackChildren()` + `reflowStackLayouts()`; wire into `applyBoardOperation`'s
      single return path so every writer — browser, MCP, migration — reflows identically.
- [x] `set_layout` operation (merging patch, so setting `gap` doesn't clear `direction`), Zod + undo + MCP.
- [x] React/Tailwind renderer: a `stack` parent emits real flow — children drop `absolute`/`left`/`top`, the
      parent gets `flex`+direction+`gap`+padding+align+justify. This is the half of the bug that makes the
      export a lie today.
- [x] Canvas: dragging a child inside a stack **reorders** it (drop position vs sibling midpoints → zIndex)
      rather than silently snapping back.
- [x] Inspector: Layout group gains mode (Absolute | Stack) and, when stack, direction/gap/padding/align/
      justify.
- [x] Tests: reflow geometry per justify/align, nesting, hidden children, reorder, export flow output.
- [x] Verify in the running app + re-export; then TestFlight.

**Result.** Verified end to end against a live board through the *agent* path, which is the path this
feature exists for: three rows authored at x=999,y=999 snapped to x=16, y=16/84/152, width stretched
345→313. Then the actual argument, demonstrated: **add a row + `reorder_child` = two operations, and
every sibling below repositioned itself** — no per-sibling arithmetic, no `polish_layout` pass. Canvas
drag reorders in both directions, one ⌘Z restores the previous order exactly (the reason reorder had to
be a single operation), and the inspector shows x/y dimmed with "Position is set by the parent's
auto-layout." 110 tests, typecheck, build, `mcp:check` 42 exposed / 41 checked, console clean.

The export is no longer a lie. The same frame now emits
`absolute flex flex-col … p-[16px] gap-[12px] items-stretch` with children carrying **no `absolute`,
no `left-`, no `top-`** — shippable React instead of a picture drawn in JSX.

**The bug that only a real drag could find.** `stackReorderTarget` returns an index, and `if (reorder)`
treats **index 0 — dragging to the top of the stack, the most likely reorder there is** — as falsy. It
fell through to a plain move, which the reflow then silently undid, so the canvas looked frozen. Every
unit test passed; the model was correct the whole time. Fixed to `!== undefined`.

- [x] Shipped: commit `a89d3d4`, pushed to main, `fastlane mac beta` → build **202608071519** (v0.1.0),
      **VALID** in ASC ~3 min after upload. Verified the shipped `app.asar` before trusting it: the web
      bundle carries `set_layout`, `reorder_child`, the "Position is set by the parent's auto-layout."
      hint, the Auto-layout inspector band and the layer-order hint; the bundled server carries
      `reflowStackLayouts`/`reorder_child` (5 refs); CFBundleVersion 202608071519, and the `!== undefined`
      reorder fix is in `HEAD` with a clean tree at build time.

**Release-lane note.** `fastlane mac beta` succeeded, but I ran it as `fastlane mac beta 2>&1 | tail -5`,
so the exit code I read was `tail`'s and the outcome was truncated away. Seeing the `.pkg` on disk and no
build in ASC ~2 min later, I called it a failed upload and re-ran `upload_only` — Apple rejected that with
**Redundant Binary Upload**, which is what proved the first upload had worked. ASC indexing lag is ~3–4
minutes, already observed twice this session. Never pipe a release lane through `tail`, and never read
"absent from ASC" as "failed" inside the indexing window.

**Follow-up noticed, not taken:** the layer tree lists highest `zIndex` first, so inside a stack the
panel reads bottom-to-top relative to the canvas. Correct for z-order, confusing for flow order, and
Figma solves it by matching layer order to flow order. Changing the tree's sort affects every element
type, so it needs its own decision.

## Active — Text that fits the box: canvas/SVG wrap parity + the deferred diagnostic (2026-08-07)

**Why now.** Deferred on 2026-07-28 because exports only wrote files to a sandbox path nobody could reach,
so the divergence was invisible. Since 2026-08-06 **Export → Download lands a real file in Downloads**, so it
now ships to whoever the user hands the file to. Same bug, new blast radius.

**The bug.** The canvas renders element text as a `<span>` inside a sized div, so CSS wraps it.
`renderElementSvg` emits **one unwrapped `<text>` per element** — the `text` branch even carries a `width=`
attribute, which SVG 1.1 ignores outright. Any label longer than its box looks correct on screen and
overflows in every SVG and PNG export.

**Why not `<foreignObject>`** (the obvious "just embed the HTML" fix): the PNG path rasterizes through
`sharp`/librsvg, which does not render `foreignObject`. That would silently drop *all* text from PNG
exports — strictly worse than the bug being fixed. Wrapping has to be computed, then emitted as `tspan`s.

### Fix — in dependency order

- [x] **Measurement, shared.** `packages/schema`: generalize `connectorLabelWidth`'s per-character-class
      Inter approximation into `textAdvanceWidth(text, fontSize, fontWeight)` + `wrapTextToWidth(...)`.
      `connectorLabelWidth` becomes `textAdvanceWidth(…) + 20` — one implementation, not two. Long words
      with no space must hard-break, or a URL still runs out of the box.
- [x] **Renderer.** Emit `<text>` + one `<tspan>` per line for `text`, `shape` (label *and* subtitle),
      `button`/`badge`, and the `default` card/section title + secondary line; clip to the box height the
      way `sticky` already does. Replace `sticky`'s `width / (fontSize * 0.62)` char-count guess with the
      measured wrapper.
- [x] **The deferred diagnostic.** `validate_board` gains `text-overflows-box` — honest now that wrapping is
      real: it fires when the text still exceeds the box *after* wrapping, which is a genuine authoring
      problem the agent can fix, not a rendering artefact.
- [x] **Verify.** Tests; re-export the real 506-element board to PNG *and* SVG and confirm long labels wrap
      inside their nodes instead of bleeding past the edge.

### Plan hygiene (same pass)

- [x] Reconcile Phase 9 P1–P7 and Phase 0 checkboxes against what the code actually does — P1 tokens, P2
      typography, P4 signature surface and P7 taste pass all shipped while their boxes stayed empty.
- [x] `AGENTS.md` (`CLAUDE.md` symlinks to it) said **24 MCP tools**; `mcp:check` reports **41 exposed /
      40 checked**. Corrected, and pointed at `mcp:check` so the number cannot rot again.

**Result.** 395 `<tspan>`s and **zero `width=` attributes on `<text>`** across the real 506-element board;
the label that used to run out of its node now wraps, a bare URL hard-breaks, and a title+subtitle pair
centres as one block. 95 tests (up from 81), typecheck and build clean.

**Two things the verification caught that the code review would not have.**
1. **The diagnostic's first formula was wrong and the seed board never showed it.** Charging a full
   line-height to the *first* line flagged 11 healthy labels on the real board — a 32px heading in a 40px
   box, and a 15px single letter in an 18px box. Only the first line costs its glyph height; the extras
   cost line-height. The synthetic tests all passed either way; the real board is what exposed it.
2. **`sharp`'s `stats()` reads the input image, not the queued pipeline.** Two different crops both
   reported the whole picture's numbers, so the containment check passed while measuring nothing. The crop
   has to be materialised with `toBuffer()` first — a green assertion that measures the wrong pixels is
   worse than a red one.

Also worth keeping: the server imports `@powerboard/renderers` from `dist`, so a renderer change is invisible
to `apps/server` tests until `npm run build` runs. The first raster run rendered the *old* unwrapped `<text>`
— which accidentally proved the new test detects the bug it was written for.

## Active — Export: the file never reaches the user (2026-08-06)

**Verified against the running TestFlight build**, not from source. `POST /export/png` on the live board
`board_hf75v_veggid` returned
`/Users/km/Library/Containers/com.lamonade.powerboard/Data/Library/Application Support/PowerBoard/boards/…/exports/Org-Structure-Matrix-v3-detailed.png`
— 6660×6160, 2.4 MB, and the raster itself is **excellent** (connectors, dashes, labels, crisp text at 144 dpi).
The image is not the problem. **Delivery is.** Every export path in the app writes a file server-side and
returns a *path string* that the UI prints into the status bar. Under App Sandbox that path is inside
`~/Library/Containers/…`, which a normal user cannot navigate to. So today: **you cannot download anything.**

Gaps, in the order they hurt:
1. **No download.** No `Content-Disposition`, no anchor, no save panel. Six export actions, zero files delivered.
2. **No page or selection raster.** PNG is artboard-only; a diagram that spans frames can only leave as SVG/PDF —
   which also just write paths.
3. **Resolution is hardcoded 2×** in the web client (the service accepts 1–4, the UI never passes it) and the user
   is never told the output pixel size. "Is this big enough for a slide?" is unanswerable.
4. **No background control.** Slides on dark backgrounds need transparency; docs need white. Neither exists.
5. **No copy-to-clipboard** — the <5s path from canvas to Keynote/Slides/Notion.

### Build

- [x] `packages/renderers`: `renderScene()` dispatcher + `renderSelectionSvg()`; `background`/`padding` options on
      artboard and page renderers; scene returns real width/height so the caller never re-parses the SVG.
- [x] `boardService.renderExport()` — pure (no disk write): scope × format × scale × background → bytes.
      `exportArtboardPng` delegates to it, so there is one rasterizer, not two. Pixel cap so a 4× poster can't
      exhaust memory, and the **clamped scale is reported back** rather than silently applied.
- [x] `POST /api/boards/:id/render` streams the bytes with `Content-Disposition` + size headers. The existing
      `/export/*` routes keep writing files — that is the right shape for agents, wrong for humans.
- [x] Web: real Export dialog (what / format / size / background), live pixel readout, **Copy image** and
      **Download**. ⌘⇧E. Errors surface in the dialog; nothing fails silently.
- [x] Electron: `will-download` → native save panel defaulted to Downloads. Required under sandbox —
      `files.user-selected.read-write` only grants access to a powerbox-chosen path, so no new entitlement.
- [x] MCP: `scale`/`background` on `export_artboard_png`, new `export_page_png`. Same rasterizer.
- [x] Tests + verify in the running app, then TestFlight.

**Verified, not assumed.** In a browser against a real 506-element board: dialog defaults to Selection when
something is selected (readout `1,008 × 480 px`, matching the element's 440×176 at 2× plus 32px padding each
side), Frame otherwise; SVG swaps the size row for "Vector — stays sharp at any size"; JPG disables Transparent
with a reason; **Copy image put a real PNG on the macOS clipboard** — `osascript clipboard info` reported
`«class PNGf»` and the IHDR bytes decode to 1008 × 480, the exact size promised. Page export of the same board
returned 14,880 × 5,344 with all three frames and their connectors, and the 2× request was **clamped to 1.67×
and said so** in the header and the status line. In the sandboxed Electron shell: Export → Download →
**native save panel defaulted to Downloads** → `AI-Embedded-Organization-m_rail_cto.png` (1008 × 480) written
and revealed in Finder. Both themes, console clean, 81 tests, typecheck, build, `mcp:check` 41 tools.

**One real bug found and fixed mid-verification:** the status line said "choose where to save" in a plain
browser. It was sniffing `navigator.userAgent` for "Electron" — which is true inside any Electron-hosted
browser view. Replaced with a fact the server actually knows: the desktop shell sets `POWERBOARD_SHELL` and
`/api/health` reports `shell: "desktop" | "browser"`.

## Active — Paper.design UI parity: the inspector is the gap (2026-07-29)

Benchmarked against paper.design's editor (hero capture on paper.design + `Documents/paper-design-gap-plan-2026-05-07.md`;
the installed Paper.app could not be opened — access denied — so the read is from public material + prior notes).
Measured PowerBoard live at 1280×720, dark theme, one element selected. Full write-up:
`docs/design/powerboard-vs-paper-ui-gap.html`.

**The measurements that matter.** One selected element renders an inspector **1481px tall inside a 626px panel** —
21 fields, **9 range sliders**, all full-width, all with 11px UPPERCASE BOLD labels stacked above. Paper fits
X/Y/rotation/W/H/flip into **two ~28px rows**. Second: **Layers starts at y=709 in a 626px-tall panel** — the
structure tree, the most-used surface in any design tool, is permanently below the fold behind 449px of App Kit +
151px of Assets. Third: with nothing selected, **Agent activity (265px) is bigger than the Inspector (246px)** — an
empty-state poster outweighing the working panel, where Paper shows real Document properties. Fourth: canvas is
**56.6% of a 1280px screen** (724px of 1280); 43% is chrome.

This pass is **design/UI only** — no new capability. Feature gaps (flex/auto-layout, gradients, multi-fill,
shadows, AI generation, import) are catalogued in the doc and explicitly NOT built here.

### Fix — in dependency order

- [x] **P0 `NumberField` — delete the slider.** A range input is the wrong control for an unbounded spatial
      coordinate: you can never hit an exact value and it costs 4× the height. Replace with one compact numeric
      field whose label is a **drag-scrub handle** (Figma/Paper muscle memory), still clamped by min/max, still
      keyboard-typable. Removes 9 sliders from a single-element inspector.
- [x] **P0 Compact field vocabulary.** `.field.compact`: label lives *inside* the control's left gutter as a dim
      glyph, one ~30px row, no stacked caps label. `.field-grid.two-col` pairs X|Y and W|H.
- [x] **P0 Inspector sections.** Element inspector regrouped: identity header (name + role, no section chrome) →
      **Layout** (X Y / W H) → **Text** (only when the element has text props) → **Appearance** (fill, text, stroke +
      width + style, radius, opacity, font) → **Arrange** (order, lock, visible) → **Reference** (collapsed:
      internal id + path). Machine metadata stops being fields #1 and #2.
- [x] **P1 Nothing-selected = Document panel.** Replace the 180px "Select a frame, element, or connector" poster
      with real document properties (board, page, counts, canvas background) — the panel earns its space when
      nothing is selected, as Paper's does.
- [x] **P1 Right-panel budget.** Compress the agent-activity empty state; collapse Backup by default.
- [x] **P1 Left-panel order.** Layers first and `flex: 1` so the tree is always visible; App Kit and Assets below.
- [x] **P1 Topbar 64 → 52px** (48 would have clipped the 38px toolbar controls), single-line breadcrumb brand
      (⌂ Boards › Board name), so the canvas gets the height back.
- [x] **P1 Quiet the chrome.** Drop `text-transform: uppercase` from `.panel-heading` and `.field span`; sentence
      case at 600 weight. One change, applies app-wide.
- [x] **P2 Canvas overlap.** Element name badge is now a neutral ink chip, not an accent fill, so chrome stops
      out-shouting the artwork. **Zoom pill: no change needed** — it was already pinned to the canvas's
      bottom-right (`right: calc(var(--right-panel-width) + 18px)`), same as Paper; the first read was wrong.
- [x] **Verify**: typecheck, build, tests; re-measure inspector height and canvas share in the running app; both
      themes; keyboard focus intact.


**Result (measured, same 1280×720 dark board):** element inspector 1481px → **812px** (−45%); range sliders
9 → **0**; layer tree top 709px → **97px** (above the fold); right panel with nothing selected 874px-in-626px
→ **638/638, no scroll**; top bar 64 → **52px**; canvas height 626 → **638px**. Typecheck, build and 73 tests
pass; drag-scrub, post-scrub focus, both themes and console verified in the running app.

**Two bugs found and fixed along the way, neither in scope:** `.color-field` declared three grid columns for a
full-width label + two inputs, so the hex input sat in a 42px slot and every colour rendered as a truncated
`#FF` — pre-existing, invisible until the panel got short enough to scroll to it. And wrapping a scrub handle
in a `<label>` handed focus to its own number input on pointer-up, so the next ⌘Z / Delete / arrow-nudge went
to the field instead of the board; the numeric fields are `<div>` + `aria-label` now.

**Feature gap deliberately NOT built** (summarised in the doc): CSS-native flex/auto-layout — the largest and
the one the rest depend on — plus draw-to-create tools, gradients/multi-fill/shadows/filters, a real typography
panel, drag-reparent in the layer tree, canvas settings (pixel grid, snap, nudge), multi-select mixed values,
and import/AI generation.

- [x] Shipped: commit `caeef83`, pushed to main, `fastlane mac beta` → build **202607291510** (v0.1.0),
      **VALID** in ASC ~4 min after upload. Verified the shipped `app.asar` carried this session's code before
      trusting it — `drag to adjust, shift`, `inspector-group`, `document-stats`, `field-row-control` and
      `brand-crumb` all present in `dist/web/assets`, **zero `type:"range"`** in the bundle (the 9 sliders are
      genuinely gone from the shipped binary, not just from source); CFBundleVersion 202607291510.

### Follow-up found while answering "is CSS-native layout superior?" (2026-07-29)

Not built — recorded so it isn't lost. **`layout.mode` is inert across the whole stack, and the React export
silently lies about it.**

- `packages/schema/src/index.ts:75` already ships `layoutModes = ["absolute","stack","grid","constraints"]`
  with `direction`/`columns`/`gap`/`padding`/`align`/`justify` on `ElementLayoutSchema`.
- The canvas ignores it entirely: `elementToStyle` (`apps/web/src/App.tsx:5069`) always emits
  `left/top/width/height` and never `display:flex`; it reads `layout.align`/`layout.justify` only as a
  fallback for the style fields.
- The React/Tailwind renderer emits `flex flex-col gap-[12px]` on a `stack` parent **and `absolute` on every
  child** — absolutely-positioned children are out of flex flow, so the gap/align/justify classes are no-ops.
  Verified by rendering a stack parent with two children. It also emits `flex flex-col` twice on card elements.
- The seed board's three `mode:"stack"` elements have **zero children** — nothing to stack, so nothing ever
  looked wrong.

Either make `stack` real or drop the field; today the export claims a layout it does not have. **Recommendation
if built:** auto-layout frames (`stack` only — direction, gap, padding, align, justify, hug/fill sizing), keep
`absolute` for diagrams (D5 already allows both per element), leave `grid`/`constraints` alone. The argument is
agent economics, not CSS parity: under absolute positioning "insert a row" forces an agent to recompute every
sibling's x/y — which is why `polish_layout` exists — whereas flow makes structural edits local. Architectural,
not a patch: children's x/y become derived, in-stack drag must mean reorder, `apply_layout`/`polish_layout`
semantics change, and existing boards need migration.

## Active — Diagram quality: why agents ship non-presentation-ready charts (2026-07-28)

Evidence: live board `board_hf75v_veggid` ("AI Embedded Organization"), built entirely over MCP.
Read via `read_board` / `export_page_svg` / `export_artboard_png`. Five real defects, one chain:

1. **`export_artboard_png` drops every connector.** `renderArtboardSvg` renders elements only —
   `renderPageSvg` is the sole path that draws connectors. The board has 9 connectors; the exported
   PNG shows **zero lines**. The most natural "give me the poster" action produces a diagram with
   no edges at all. This alone explains "non-presentation-ready".
2. **No dashed/dotted stroke exists anywhere in the schema.** `BoardStyleSchema` has
   `stroke`/`strokeWidth` and nothing else. The agent wanted a dotted-line interface, couldn't
   express it, faked it with a lighter grey (`#94A3B8` vs `#475569`) — and shipped a legend that
   says "Dotted line = embedded / dotted-line interface" over nine solid lines. **The artifact lies
   because the model couldn't say what it meant.**
3. **Orthogonal routing puts the cross-bar against the target instead of mid-span.** `orthogonalRoute`
   elbows at `entry.y` (24px above the target), so sibling edges pile into one lane at the child's
   head. Classic org-chart look needs a mid-span trunk.
4. **No obstacle avoidance.** Two edges on this board run straight through other nodes:
   `c_cos_biz` (`M 790 470 … L 790 886`) passes through **AI Enablement**; `c_enable_cto`
   (`… L 1536 675 …` at y=675) passes through **Technical Substrate** and drops its label chip
   inside that filled box.
5. **No fan-out on shared anchors.** `c_cos_biz` and `c_fde_biz` both terminate at exactly
   `(1300, 910)` — two arrowheads stacked on one pixel.

And the reason the agent never noticed: **`validate_board` is purely structural.** It checks ids,
parent cycles, semantic roles, shape kinds. It has no geometric diagnostics, so a poster with lines
through boxes and colliding labels validates `valid: true`. The MCP etiquette tells agents to
validate before exporting; validation then tells them everything is fine.

Secondary: the agent hand-composed each of 14 nodes as `frame` + 2 root-level `text` elements
(44 elements for 14 nodes). `shape` — the canonical diagram node (D5) — only renders a single
`props.text`, so a title+subtitle node is impossible as one element. That forces hand-placement and
makes `apply_layout: "tree"` unusable (it would move the frames and leave the labels behind).

### Fix — in dependency order

- [x] **P0 Schema.** `BoardStyleSchema.strokeStyle: solid|dashed|dotted` (serves connectors *and*
      shape/frame/rect outlines — one property, not a connector-only fork). Connector
      `cornerRadius?` for rounded elbows. Shared `strokeDashArray(style, width)` helper so canvas
      and SVG dash identically. `shape` gains `props.subtitle`.
- [x] **P0 Routing** (`packages/schema/src/connector.ts`): mid-span trunk for orthogonal routes,
      rounded corners, obstacle-aware trunk-lane selection, target-side anchor fan-out.
      Fan-out on the **target** side only — a shared outgoing trunk is the correct org-chart look.
      Centralize `elementWorldRect` / `connectorEndpointRect` / `connectorObstacles` here and delete
      the duplicates in `apps/web` and `packages/renderers`.
- [x] **P0 Export parity**: `renderArtboardSvg` draws the connectors whose endpoints both resolve
      inside that artboard, in artboard-local coordinates. Fixes `export_artboard_png` and the
      PNG in `export_selection_handoff`.
- [x] **P0 Canvas + SVG renderer** honour `strokeStyle`, `cornerRadius`, obstacles and fan-out —
      identical geometry in both, per the connector-v2 contract.
- [x] **P1 Layout diagnostics in `validate_board`**: `connector-crosses-element`,
      `connector-endpoints-collide`, `connector-label-collides`, `elements-overlap`,
      `element-outside-artboard`. All warnings — geometry is judgement, and a deliberate crossing
      must not make a board invalid. Diagnostics run the *same* obstacles and fan-out slots the
      renderers use, or validation flags collisions the canvas already resolved (caught by a test).
      This is what makes "picture-perfect" repeatable — the agent gets told.
- [ ] **NOT done — `text-overflows-box`.** Deferred: the canvas wraps text in a div while
      `renderElementSvg` emits a single unwrapped `<text>`, so long strings overflow only in the
      SVG/PNG export. The diagnostic is worth little until that parity bug is fixed; they should
      ship together as their own piece of work.
- [x] **P1 Inspector**: line style control (Solid/Dashed/Dotted) on the connector panel and the
      shape/frame outline; subtitle field on shapes.
- [x] **P1 MCP descriptions** teach the new fields and the diagnostics loop.
- [x] **Verify**: typecheck, tests, re-route the live board and re-export the PNG — lines present,
      dotted where the legend claims, nothing crossing a node.

Deferred (flagged, not in this pass): the `chart` element renders bare bars — no axis, baseline,
gridlines, value or category labels. Fine as a mockup placeholder, not presentation-grade. Separate
piece of work.

### Phase 2 — make it self-correcting, not advisory (2026-07-28)

User's challenge after phase 1: *"the goal is to make the product fixes so that when the agent uses
it, it's always perfect — embed some best practice, or an auto-feature where the components always
correct themselves to look picture-perfect and print-ready."*

Correct read of the gap. Phase 1 made **connector geometry** self-correcting (routing, avoidance,
fan-out, label placement all happen at render time with no agent involvement). It left **node
geometry** entirely to the agent, and made `validate_board` a report nobody is obliged to read.
An agent that never calls `validate_board` still ships a ragged board.

Three levers, weakest to strongest:

- [x] **Opinionated defaults** — `add_connector` picks `orthogonal` when both endpoints are diagram
      nodes, instead of the schema-wide `curved` default that suits app flows. Best practice applied
      at the moment of creation, without the agent knowing to ask.
- [x] **`polish_layout` — a deterministic auto-corrector.** One operation that normalizes an existing
      layout rather than recomputing it (that is `apply_layout`'s job — the two stay MECE). Passes:
      align rows/columns on their centres, unify sizes that were *meant* to match, equalize gaps that
      were *meant* to be even, separate overlaps, snap to an 8px grid, repair connector ports that now
      face the wrong way, drop waypoints stranded inside nodes, pull strays back inside the artboard.
      **Conservative by design:** it only tightens what is already nearly-aligned, so a deliberately
      irregular layout survives. One undo entry.
- [x] **Exports carry their own diagnostics** — every export tool returns the board's layout warnings
      beside the file path. The agent cannot ship a poster without being told what is wrong with it,
      even if it never calls `validate_board`. This is the loop-closer: the failure surfaces at the
      exact moment the agent thinks it is done.
- [x] **Print-ready raster** — `export_artboard_png` gains a `scale` (default 2× for print density,
      capped at 4×) and reports the pixel dimensions it produced.
      **`margin` was NOT built.** The artboard background already extends past the content on this
      board, so a render-time margin would have been guesswork about where the poster edge belongs;
      it needs a real decision about whether margin is an artboard property or an export option.
- [x] **Verify**: tests for each polish pass; deliberately wreck a copy of the real board, polish it,
      and confirm the export comes back clean.
- [x] Human parity: **Arrange → Tidy up** in the toolbar runs the same operation, so the auto-corrector
      is not agent-only.
- [x] Shipped: commit `50e2a74`, pushed to main, `fastlane mac beta` → build **202607281830** (v0.1.0),
      **VALID** in ASC ~8 min after upload. Verified the shipped `app.asar` carried this session's code
      before trusting it — `polish_layout`, `strokeStyle`, `connector-crosses-element`, the
      "Tidy up (align, even out, snap)" menu item and `agent-reticle` all present; the old
      `label.length * 7.2` chip heuristic gone; CFBundleVersion 202607281830.
      The commit also carries the in-flight agent-presence work (reticle, veil, phased live badge) —
      interleaved in `App.tsx`/`styles.css` so it could not be split out; verified working in the
      running app (presence veil fires on MCP heartbeats) before shipping.

Three bugs the tests and the live run caught, each a design flaw rather than a typo:

1. **Not idempotent** — snapping a centre to the grid while heights were odd multiples of 4 drifted
   every node 8px per run. Fixed by snapping *sizes* to a 2xgrid rhythm first, which makes every
   half-size a whole grid step, so `centre - size/2` is grid-aligned with no follow-up rounding.
   Idempotence is the property that makes polish safe to run before every export.
2. **Resizing ate the spacing** — unifying widths grows nodes around their centres, so gaps measured
   *after* that read an even row as ragged and left two cards flush against each other. Spacing is
   now measured before sizes change and applied after. The regularity test also changed from a
   max/min ratio to gap variation relative to node size: gaps of 16 and 53 between 432-wide cards
   are one intended gap typed carelessly, but a ratio test calls that 3.3x and wrongly protects it.
3. **The column pass undid the row pass** — a card in a tidy row of five was dragged out of line by
   one unrelated node sharing its centre-x. Rows and columns are now resolved into a single
   non-overlapping assignment (largest group claims its members first), plus cluster membership
   requires comparable cross-axis size and excludes container/content pairs — without that, a
   2300-wide band and a 432-wide card counted as a "column" and threw the card 400px down.

## Active — Connect dialog: one client, one thing to copy (2026-07-28)

User review of the shipped build, opening the dialog from **Home**:

1. **Wrong context.** The dialog showed a "This board — Untitled PowerBoard Board" row on the
   Boards home. `project` is the last-loaded/default board and is non-null even when no board is
   in view; the previous session made the dialog app-level but kept passing `project`
   unconditionally. Fixed by passing `homeOpen ? null : project`.
2. **Too many copy targets.** Three copy buttons (endpoint, board id, CLI command) with no signal
   which one the agent actually needs — the top question a first-time user has.
3. **Claude-specific by default.** Steps assumed Claude Desktop and the code block was titled
   "Claude Code & other CLI clients", reading as if PowerBoard only speaks to Claude.

Fix — the dialog now asks *which client do you have* and answers with exactly one string:

- [x] Client picker (Claude Desktop · Claude Code · Cursor · Any other client) switches the single
      copyable value: URL for connector-style clients, `claude mcp add …` for Claude Code, an
      `mcp.json` snippet for Cursor. Exactly **one** primary Copy button visible at any time.
- [x] Board id demoted to an optional one-line footnote with a text "Copy id" link, shown only when
      a board is actually open
- [x] Copy stripped of Claude-first framing ("Any MCP client can browse, create and edit your
      boards"); home strip now reads "Point any MCP client at"
- [x] Dead `.connect-config*` CSS removed; `.connect-clients` / `.connect-paste` / `.link-button` added
- [x] Verify: typecheck, 48 tests, run app — home (no board row) + Cursor tab + dark mode on a board,
      console clean
- [x] Commit + push (`a545bd9`), `fastlane mac beta` → build **202607281500** (v0.1.0), upload clean
      in 94s, **VALID** in ASC ~4min later. Verified the shipped `app.asar` carried this session's
      code before trusting it: new header copy / Cursor `mcpServers` snippet / "Any other client" /
      "Point any MCP client at" all present; `Claude Code &`, `Point Claude at` and the stray
      `This board` row all absent; CFBundleVersion 202607281500.

Decision: no stdio option in the picker — same reasoning as the previous session (dev-checkout path
doesn't exist in an installed app; a second stdio process would open its own writer against the same
board files, violating the persistence P0 rule). Every client in the list speaks the same
streamable-HTTP endpoint; only the paste location differs.

## Active — In-app agent onboarding, brand mark, tagline (2026-07-22)

Gaps found by the user reviewing the shipped TestFlight build:

1. **The app never tells you how to connect an agent.** `AgentConnectDialog` existed but was
   rendered only when a board was open (`{project ? <AgentConnectDialog…`), and the command
   palette that reaches it is board-scoped too. From the Boards home — the first screen every
   new TestFlight user sees — connection instructions were **unreachable**.
2. **The dialog's config was wrong for a shipped app.** It printed
   `npm run mcp --prefix /Users/km/Developer/PowerBoard`, a dev-machine path that does not
   exist for anyone who installed from TestFlight.
3. **No logo.** Header + loading shell rendered the literal string `PB`. The Direction-D mark
   was built for the app icon (`docs/brand/`, `apps/desktop/build/icon.svg`) but never wired
   into the web UI; the favicon was a stale, unrelated mark.
4. **Tagline too narrow.** "the agent-native design board" undersells mockups **and** diagrams.

Intended home-screen journey — answer three questions, quietly: *what is this* (brand mark +
tagline), *get working* (New board / open one), *plug in your agent* (the differentiator,
visible without hunting).

- [x] `BrandMark` inline-SVG component (Direction D, blur filter dropped so it stays crisp at 42px);
      replaces `PB` in `.brand-mark` (topbar) and `.loading-mark` (loading shell)
- [x] `apps/web/public/favicon.svg` refreshed to the same mark
- [x] Tagline → "the agent-native visual workspace" (App.tsx + desktop package.json description)
- [x] `AgentConnectDialog` takes `project?: BoardProject | null` — app-level copy with no board
      open, keeps the "This board" row when one is; rendered unconditionally
- [x] Dev-only stdio JSON replaced with instructions correct for an installed app: Claude Desktop
      custom-connector steps + a `claude mcp add --transport http` line for CLI clients
- [x] Home: `Connect agent` header button, quiet connect strip (endpoint + copy + live health),
      first-run empty state promoted from a passive `<small>` to a real action
- [x] Verify: typecheck, tests, build, run app, screenshot home + dialog
- [x] Commit + push (`12285fc`), `fastlane mac beta` → build **202607221350** (v0.1.0, 117MB).
      Upload returned clean in ~22min (exit 0) — the `skip_waiting_for_build_processing` fix from
      `b4fc59e` worked; no repeat of the 85-min poll hang. Verified the shipped `app.asar` carries
      this session's code before trusting the build: new tagline present / old absent, "Add custom
      connector" copy present, stale `--prefix` dev path gone, and `delete_board` / `rename_board` /
      `list_board_files` all baked in. Confirmed **VALID** in ASC at 14:22 (~4min after upload —
      it took 2 polls before Apple even registered the build, so don't read early absence as failure).

### Follow-ups noticed but deliberately not taken (out of scope)

- Agents can `rename_board` over MCP, but the UI still has no rename affordance — only agents can
  rename a board. Asymmetric; worth closing.
- No search/filter on the board grid. Fine at 8 boards, painful at 30.

Decisions: the connect strip is **not** dismissible — one slim muted row that doubles as the live
server-health readout (no persistence flag, differentiator stays visible). Lead with the HTTP
endpoint everywhere: it is the only path correct for both a packaged app and a dev checkout, and
it shares the running app's store rather than opening a second writer against the same board
files (persistence P0 rule).

## Active — App-level MCP board management (2026-07-21) ✅ shipped

Gap: the MCP surface exposed `list_boards`/`create_board`/`read_board` (already app-wide) but **no way to delete, rename, or see the files backing a board** — so an agent in Claude Desktop couldn't manage the workspace, only edit inside one board. The store already had `deleteBoard()` and `DELETE /api/boards/:id`; the missing piece was MCP exposure + two small lifecycle siblings. Board lifecycle stays at the store/API layer (like `create_board`), NOT the operations union — consistent with the Delete Board decision below.

- [x] `boardService.ts`: `renameBoard(boardId, name)` (trim-guarded, bumps updatedAt, persists via `writeBoard` → local + cloud mirror; throws on missing/blank) + `listBoardFiles(boardId)` → `BoardFileListing` (board.json location or cloud:// URI, referenced assets, on-disk exports with sizes; cloud-primary defers export listing).
- [x] `mcpServer.ts` (v0.2.0 → **0.3.0**): new tools `rename_board`, `delete_board`, `list_board_files` — structured errors + idempotency (via `registerTool`); `delete_board` throws `not found` → structured `not_found`, and fires new `onBoardRemoved` option so live clients drop the board. Descriptions flag delete as irreversible / not board-undo.
- [x] `index.ts`: `/mcp` handler wires `onBoardRemoved` → `backup.cancel` + broadcast `board.removed` (so the running app's board list updates live when an agent deletes). New `PATCH /api/boards/:boardId` rename route (HTTP parity) → broadcast `board.changed`.
- [x] `mcpCheck.ts`: added the 3 tools to `REQUIRED_TOOLS` (conformance gate).
- [x] `apps/desktop/main.js`: Help → **"Connect an Agent (MCP)…"** dialog rewritten with the Claude Desktop custom-connector URL (`…/mcp`) + a Copy-URL button (`clipboard`).
- [x] Tests: rename (persist + trim + missing/blank reject) + listBoardFiles (empty → location/assets/exports, then asset+export populated). 46 → **48 pass**. typecheck + build + mcp:check green.
- [x] Pushed MAS build `202607212259` to TestFlight — **VALID** and live to internal testers.
      The fastlane run reported a failure, but the binary upload succeeded ("Successfully uploaded
      the new binary"); only the post-upload processing poll died on a flaky TLS read after ~85min.
      Confirmed VALID via the ASC API. Hardened so it can't recur: read-only `build_status` lane +
      upload no longer blocks on the fragile poll (`b4fc59e`).

## Active — Delete Board (2026-07-13) ✅ shipped

Gap: board manager had create/read/update but **no delete** anywhere (server route, boardService, cloudStore, web UI). Board deletion is a *lifecycle* action (like create), NOT an in-board operation — so it lives at the store/API layer, not the operations union. Destructive → confirm dialog + loud status; hard delete.

- [x] `cloudStore.ts`: `deleteBoard(boardId): Promise<boolean>` on `CloudStore` interface + Pg impl (`delete from board_projects` — `cloud_files` cascades). `MemoryCloudStore` test mock updated.
- [x] `boardService.ts` `deleteBoard(boardId)`: existence check → 404-able; local/mirror rm board dir (removes board.json/assets/exports/history); mirror+cloud delete from cloud; `forgetBoardState` drops in-memory undo/redo/selection; `history.drop`. Returns `found`.
- [x] `historyStore.ts` `drop(boardId)` (rm history dir + clear cached index). `backupService.ts` `cancel(boardId)` (clear pending debounce timer; snapshot files kept as recovery net).
- [x] `DELETE /api/boards/:boardId` route → 404 if absent else `{ ok, boardId }`; broadcast `board.removed`.
- [x] `api.ts` `deleteBoard` (withLocalFallback → DELETE + `localDeleteBoard` IndexedDB `.delete`).
- [x] HomeView per-card Delete (Trash2, muted→danger, aria-label, stopPropagation; card onKeyDown guarded so Enter on Delete no longer also opens) → `DeleteBoardDialog` confirm; on success prune state + loud status; if deleted board is open, return home.
- [x] styles: `.card-delete-button` + `.dialog-actions button.danger` (+ dark overrides).
- [x] Tests: local create→delete→gone + cloud-mode delete + missing→false (2 new; 46 total pass). typecheck + build green. Verified in-browser on an isolated server: seed 2 boards → delete one → confirm dialog → card removed, recount, "Deleted …" status, board dir removed on disk, console clean.

## Design overhaul (docs/design/powerboard-design-overhaul.html)

- [x] **Phase 0 — brand accent.** Shipped, then re-toned violet → slate indigo (2026-07-13) at user request. See appendix in the doc.
- [x] **Phase 1 — design-token foundation** (2026-07-13). Added `--space-1…8`, `--r-xs…pill`, `--shadow-1/2/3`, `--dur-fast/med`, `--ease-out/in-out`, `--focus-ring` to both the light `:root` and `[data-theme="dark"]` blocks + a `prefers-reduced-motion` token override. Vocabulary only — nothing consumes them yet → zero visual change. **Discrepancy noted vs brief:** left `--shadow-pop` explicit rather than aliasing to `--shadow-2` (aliasing would restyle 4 live popovers, breaking the "zero visual change" gate) — deferred that remap to Phase 3 consolidation. typecheck + build + test green.
- [x] **Phase 2 — typography** (2026-07-13). Bundled Inter variable self-hosted (`apps/web/public/fonts/InterVariable.woff2`, 344KB — full file, not a subset; larger than the doc's ~110KB estimate but fine for an offline desktop app) + `@font-face` (weight 100–900, `font-display:swap`) + `<link rel=preload>`. Collapsed 17 inflated weights → 500/600/700; normalized 18 sizes → 11/12/13/14/17/22/28; `font-variant-numeric: tabular-nums` on zoom %, inspector coord/size fields, and count pills. Verified: browser fetched the woff2 (200), squint test passes, console clean, build/typecheck/46 tests green.
- [x] **Phase 3 — radii/shadows/spacing consolidation** (2026-07-13). All 85 `border-radius` literals → `--r-*` (only `50%` circles + `inherit` + 1 tokenized compound remain). Elevation `box-shadow`s → `--shadow-1/2/3`; `--shadow-pop` now aliases `--shadow-2` (the deferred Phase-1 item); card-delete focus → `var(--focus-ring)` (dropped the redundant dark override). 51 in-scale single-value padding/gap/margin → `--space-*` (value-preserving, zero visual change). Left intentionally: agent-pulse teal keyframes, hairline shadows, accent glows, the canvas artboard shadow, and off-scale small gaps (6/7px). Verified radii+shadows in-browser (home + board, light + dark, console clean); build/typecheck/46 tests green. **Deferred within Phase 3:** control-family size/radius harmonization to the doc's exact 28/32px + `--r-md` — a deliberate visual change (controls already share hover `--accent-tint` / active `--accent-soft` states + tokenized radii, so this is polish, not a gap).
- [x] **Phase 4 — live agent canvas (the differentiator)** (2026-07-13). Retinted every agent pulse teal → the brand accent (18 rgba + 1 hex; north star = one accent, motion distinguishes it from selection). Added a live **"editing…"** badge while an agent burst is in flight, a **click-to-focus re-pulse** (`pulseElements`), a **"Connect an agent"** action, and an **empty-state motif** echoing the app icon's board-and-pulse. Guarded all pulses under `prefers-reduced-motion` (static agent-active outline stays, so touched elements remain identifiable). Read-only w.r.t. the WS/operation model — consumes existing `agentActivity`. Verified live by driving real `move_resize_element` agent edits through the server: empty motif renders, feed live-updates (humanized message + "Claude · just now"), inspector syncs in real time, canvas element accent-highlights; build/typecheck/46 tests green. Files: `components/AgentFeed.tsx`, `App.tsx`, `styles.css`.
- [x] **Phase 5 — designed states + neutral content palette (de-blue)** (2026-07-13). **States:** Home first-run is now a pitch (accent motif + sparkle, value prop, primary action, agent hint) instead of a bare "No boards yet"; board-list loading uses **skeleton cards** on the real grid geometry (zero layout jump, no spinner); a distinct **error/offline state** stops a load failure masquerading as an empty account (`boardsError` threaded through `refreshBoards`). **De-blue:** new shapes/connectors, sparkline chart-line, mockup icon, and `.mock-*` eyebrow/bar seed **neutral ink `#44403C` on paper `#F7F6F3`** — across the web renderer, schema element presets, and SVG/spec export fallbacks. Stored JSON never migrated (verified: old blue shapes render unchanged, only new elements go neutral). **Loud writes (persistence P0):** new `failLoud` helper turns the whole status bar red + `console.error`, wired into every write path (edit/insert/create-canvas/create-board/delete-board/backup); **fixed a real bug** — `insertElement` was swallowing save errors with `.catch(() => null)`, hanging forever on "Saving…". Verified live: killed server mid-edit → deep-red "⚠ Failed to fetch" bar + console error; de-blue confirmed via stored JSON; first-run + error styling checked light & dark (fixed a pre-existing dark-on-dark heading bug); typecheck/build/46 tests green. **Left intentionally:** themeable board `accent` token + demo starter-template sample content (not unstyled content defaults); RestoreDialog already carried its five states. Files: `App.tsx`, `styles.css`, `packages/schema`, `packages/renderers`.
- [x] **Phase 6 — canvas craft** (2026-07-13). **Root-cause fix:** the selection ring, resize handles, snap guides and marquee live inside the `scale(zoom)` plane, so fixed-px borders blurred/doubled at zoom. `applyCamera` now publishes a live `--zoom` on `.canvas-plane`; every affordance sizes with `calc(px / var(--zoom))` → constant *screen* size at any zoom. **Verified live at 0.8× and 3.05×:** ring = crisp ~1–1.5px accent hairline (glow dropped); four corner handles (nw/ne/sw/se, anchor-aware resize with opposite edge pinned) = steady 7.98px dots, each `aria-label`ed; snap guides + marquee → accent (rose `#f43f5e` gone); connector **midpoint handle** = 8px dot / 16px hit that bends the line via the existing `update_connector` waypoint op (double-click straightens — no new op/schema). Gesture audit passed as-is (⌘0=100%, ⌘1=fit, cursor-centered wheel/pinch zoom, native trackpad momentum). typecheck/build/46 tests green. **Connector occlusion — found & fixed:** `.connector-layer` was z-index 0 < `.artboard-frame` z-index 1, so connectors/handles over an opaque frame were hidden (only visible in frame gaps). Raised to z-index 2 (per user decision) — verified live: connector line now renders over the frame, hit-tests to the `<path>` on top, midpoint handle is topmost/grabbable (`elementFromPoint` → hit circle), and element selection still passes through (card body → element). Trade-off accepted: ~16px connector hit-path floats over frame content. **Remaining honest gap:** drag *gestures* (resize-from-corner, midpoint-bend) are code+math-verified only — the browser harness delivers events to a11y refs but not raw canvas coords, so it can't machine-drive a pointer drag; handlers are the standard pointer-capture pattern and the target is confirmed topmost. Files: `App.tsx`, `styles.css`.
- [x] **Phase 7 — a11y floor + taste pass (ship gate)** (2026-07-14). **Focus floor:** one global `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }` + removed 3 unconditional `outline:0` suppressors (artboard select, palette input, board card); skip-listed inputs that already carry their own inset ring. Verified live (`focus({focusVisible:true})`): plain button + board card both show the 2px accent ring. Chose an accent outline over the `--focus-ring` box-shadow token (follows radius, clip-immune, reads on every surface). **Names:** icon-button audit clean (all had aria-label/title); labeled the 5 unlabeled form controls. **Contrast:** inspector field labels were 3.67:1 in dark (hardcoded `#64748b`) → moved them + 4 sibling literals to the flipping `--text-2` token; verified field label 6.88 dark / 4.56 light, card date 6.88 dark. Left fixed-white-surface literals alone. **125% zoom:** no horizontal document overflow (flex canvas absorbs it). **Taste (design.md §10):** zero pure-black shadows, one accent, tight 7-step type scale (normalized a stray 15px), no default-blue, no banded gradients, de-bordered panels; squint test passes both themes, primary action pops. **Known minor nit:** selected connector's midpoint handle overlaps its centre label ("fl●w") — cosmetic, on-selection only, functional; left to avoid risking verified Phase-6 behavior. typecheck/build/46 tests green. Files: `App.tsx`, `styles.css`.
- **Design overhaul complete — Phases 0–7 all shipped.** Next candidates: the connector-label/handle overlap nit; a full (non-spot-check) contrast sweep of remaining literals; Electron shell (Phase 1 of the desktop roadmap).
- [x] **Quiet-chrome correction (2026-07-14, user feedback after 0–7).** "Too many colors / old-school bordered+filled buttons / too much label text — look at paper.design." **Accent diet:** all chrome hover/active states moved to a neutral ladder (`--control-bg/-hover/-active`, new token); accent reserved for selection, agent presence, one primary CTA per screen (glow shadows dropped), and focus rings. Killed stray hues (green segmented hover, teal layer-act, cyan dead rules, green storage pill → neutral + status dot, accent connector-label text → ink, lavender shape tiles → mono outline). Mode pill → inverted HUD. **De-border:** toolbar group boxes gone (buttons float), Insert/Arrange/Export ghost text buttons, panel/dialog buttons ghost rows, chips/pills flat `--control-bg`, cards hairline-shadow not border. **Icon-level + tooltips:** CSS `data-tip` system (inverted, 400ms intent delay, edge-aware, `:focus-visible` too) replaced `title` across topbar/zoom/selection-bar/pane/layer/align controls, each with `aria-label`; shape tiles icon-only 4-col. **Also fixed the Phase-7 nit:** selected connector label lifts clear of the midpoint handle (constant screen offset via `/zoom`). Verified live both themes (tooltips, HUD, ghost menus, label lift), console clean, typecheck/build/46 tests green. Rule recorded in `tasks/lessons.md`. Files: `styles.css`, `App.tsx`.

## Locked decisions (do not re-litigate without user)

- **D1 — Shell: Electron (Mac App Store build) → TestFlight.** The Node server (Express + WS + MCP + sharp) runs unmodified inside Electron's main process, so the app *is* the daemon: UI, storage, and MCP all served by one installed binary. Tauri/native Swift would force a port of ~2.2k lines of server logic or an unsandboxable Node sidecar. Fallback if MAS sandbox blocks us: Developer ID + notarized DMG (still installable, loses TestFlight).
- **D2 — Identity:** bundle id `com.lamonade.powerboard`, app name **PowerBoard**, Team `R5Z99F8UNV`, ASC API key `998DV58D4V` (issuer id in Habeat/CentsCheck `scripts/.env`). Pipeline modeled on `Habeat_app/fastlane/Fastfile` (`beta` + `upload_only` lanes) + `electron-builder` `mas` target. Needs one new cert: Mac Installer Distribution (fastlane can mint via API key).
- **D3 — Storage pivot: offline/local-first.** Boards = JSON files under the app's user-data dir (existing `local` storage mode, repointed). Supabase demoted from source-of-truth to *optional sync target* (existing `mirror` mode is the bridge for the later online phase). One-time import of current cloud boards on first run.
- **D4 — iCloud backup, not iCloud sync (for now):** versioned snapshots written to `iCloud Drive/PowerBoard/` (ubiquity container entitlement; security-scoped folder fallback). Snapshot on close + debounced autosnapshot. Restore picker in-app.
- **D5 — One object model for mockups AND diagrams.** No second canvas, no second document type. Diagramming lands as: connector system v2 (element anchoring, ports, routing), new node types (shape, sticky, ink), auto-layout for tree/flow. Mode = tool palette + defaults, never a fork of the model.
- **D6 — Op-log now, sharing later.** Persist the operation log per board (also fixes undo-lost-on-restart). This is the cheap door-opener for future multi-device/share sync; no CRDT until sharing is real.

## Phase 0 — Foundation & P0 fixes (before the shell)

- [x] **P0 data-loss fix:** browser-local store now IndexedDB (`powerboard.local` db, one record per board), loud failure (throw + console.error), auto-migration from legacy localStorage keys. Verified: create → reload → restore + 8MB asset write. (2026-07-04)
- [ ] Split `App.tsx` into modules — still open, and the file has grown past 5k lines since this was written.
- [x] Extract design tokens into CSS variables + dark-mode layer — delivered by Phase 9 P0/P1 (see below).

## Phase 1 — macOS app on TestFlight (user's #1)

- [x] `apps/desktop/`: Electron main runs the server in-process on `127.0.0.1:4318` (esbuild-bundled, sharp/pg external), serves web dist same-origin, native menus (New Board, Reveal Boards Folder, MCP endpoint info), single-instance lock, health-gated window. (2026-07-04)
- [x] Storage `local` at `~/Library/Application Support/PowerBoard/boards/` — verified create → quit → relaunch → intact. Supabase importer: still todo (Phase 2, boards currently in cloud are reachable via `mirror` mode).
- [x] App icon (SVG → icns, mockup-artboard + diagram-nodes motif).
- [x] `electron-builder` mas config + sandbox entitlements; app signed (Apple Distribution), pkg signed (3rd Party Mac Developer Installer — cert minted headless via ASC API).
- [x] `fastlane/`: `prepare_signing` (bundle id ✓, installer cert ✓, MAS profile ✓), `beta`, `upload_only`, `await_app_and_upload` (polls for the app record, uploads, sets up internal TestFlight group).
- [x] ASC app record created (user, 2026-07-04) → build **0.1.0 (202607041401)** uploaded, processed for MAC_OS, distributed to the Internal group; owner assigned as internal tester. Lanes hardened: hash params, raw `v1/betaGroups` + `v1/betaTesters` posts (Spaceship's helpers send attributes internal groups reject).
- [ ] Verify install from TestFlight app on this Mac with realistic board round-trip (user-side; first sandboxed run is the real test — watch for container/network issues).

## Phase 2 — Offline-first storage + iCloud backup (user's #5) ✅ 2026-07-04

- [x] Persist per-board op-log + undo/redo across restarts (D6). `apps/server/src/historyStore.ts`: gzipped pre-op snapshots + `index.json` + append-only `oplog.jsonl` under `<board>/history/`. Verified: undo depth 5 persisted to disk; op-log records source/type/targetIds; batch shares one seq.
- [x] Versioned snapshots on significant change (15s debounce) + on quit (SIGINT/SIGTERM flush + Electron `before-quit`) → `<backupDir>/<board>/<timestamp>.json.gz`, pruned to 20. `apps/server/src/backupService.ts`. Verified: 2 snapshots on disk, restore round-trip returns the full board.
- [x] Restore UI: `apps/web/src/components/RestoreDialog.tsx` (timestamped picker, restore is an undoable op path). Backup panel in right sidebar; "Back Up All Boards Now" + "Reveal Backups Folder" in the Electron File menu.
- [x] Loud failure states: backup failures set `status.healthy=false` + console.error; status-bar `BackupBadge` shows "⚠ Backup failed" / "Backed up <time>". Verified badge live-updates.
- [x] `cloud`/`mirror` still compile; local is default in desktop. MAS sandbox falls back to app-container backups (iCloud container entitlement is a follow-up).
- [x] Supabase→local one-time importer: `apps/server/src/importCloud.ts` (`npm run import:cloud`), round-trip verified per board.

## Phase 3 — UI/UX overhaul (user's #2) ✅ 2026-07-04

- [x] Design-system pass: semantic CSS tokens + full dark-mode layer (designed surfaces, one accent, not inversion). Verified toggling in-app.
- [x] Canvas feel: marquee multi-select (>50% overlap), alignment/snap guides on drag (edges + centers), double-click-to-edit text (text/button/badge/sticky/shape), arrow-key nudge (1px / ⇧10px).
- [x] **Agent presence as a feature**: `AgentFeed` panel (human-readable entries, click-to-focus edited elements) alongside the existing element pulse highlights + "AI edited" stamp.
- [x] Command palette (⌘K): `CommandPalette.tsx`, ~40 commands across Board/Edit/Insert/Tools/Layout/Export/View/Backup/Help with fuzzy filter + keyboard nav. Verified.
- [x] Empty/error states (inspector, agent feed, restore, backups); keyboard-shortcut overlay (?); designed home empty state already present.
- [x] Tool switcher (select/connector/ink), Mockup↔Diagram palette toggle (D5), theme toggle in toolbar.

## Phase 4 — Diagramming: Miro × Visio × Excalidraw, MECE (user's #4) ✅ 2026-07-04

- [x] **Connector v2** (`packages/schema/src/connector.ts`, shared by canvas + exporters): element-level anchoring, ports (auto/n/s/e/w), routing (straight/orthogonal/curved), arrowheads (none/arrow/triangle/dot/diamond) both ends, waypoints, editable midpoint label + position. New ops `update_connector`/`delete_connector`. Verified orthogonal element-to-element routing on canvas.
- [x] New node types on the SAME element schema: `shape` (12 kinds: rectangle/rounded/ellipse/diamond/parallelogram/cylinder/hexagon/triangle/star/cloud/document/arrow-right, text-in-shape) + `ink` (freehand, normalized points). `sticky` already existed. Verified diamond/rect render.
- [x] Frameless artboards (`frameless` flag → no device chrome; "Add Canvas" button). Verified.
- [x] Auto-layout op `apply_layout`: tree (org charts, connector-driven), flow (longest-path layering), align (6) + distribute (2). Verified tree centers parent over children.
- [x] Palettes by intent: Mockup / Diagram switch over one model (D5) — zero duplicated features. Verified.
- [x] Exports: page SVG (artboards + connectors), single-page PDF (`pdf.ts`, sharp JPEG → PDF), Mermaid (`renderMermaid`, shape-aware node syntax). Verified Mermaid output. React/Tailwind + spec untouched for mockups.
- [x] `delete_artboard` op (removes elements + connectors + page refs).

## Phase 5 — MCP hyper-reliability (user's #3) ✅ 2026-07-04

- [x] MCP served by the installed app (HTTP `/mcp` on 4318); stdio kept for headless. 36 tools exposed (`mcp:check` green).
- [x] `batch_operations` (atomic — all-or-nothing, one undo entry, `expectedUpdatedAt` conflict detection) + `idempotencyKey` on every mutating tool (10-min replay cache). Verified atomic rollback + no double-apply in soak.
- [x] Structured errors on every tool: `{ code, tool, message, hint, details }` — codes validation_failed/not_found/missing_input/conflict/internal_error. Verified in soak (40 structured errors).
- [x] `get_board_status` heartbeat (storage mode, backup health, counts, undo/redo depth, last agent edit); `board_undo`/`board_redo`/`read_oplog` tools.
- [x] Reliability harness: `apps/server/src/mcpSoak.ts` (`npm run soak`) — 500 mixed ops (valid/invalid/batch/idempotent/undo-redo) ends with `validate_board` clean. Passing.
- [x] Updated `docs/agents/powerboard-connector.md` for the desktop-app world + new tools.

## Phase 7 — UX overhaul v2 (first-run feedback, 2026-07-05)

User installed TestFlight build 202607042139 and reported 10 problems. Root causes confirmed by reading `apps/web/src/App.tsx` (3.8k lines) + `styles.css`. Design principle for this phase: **the canvas must feel trustworthy and native-Mac** — things appear where you look, never vanish, drag from anywhere sensible, zoom like every other Mac app. Chrome must never truncate. Getting an agent connected must be one obvious click.

- [x] **#4/#8/#10 Canvas trust (core):** new elements land at the viewport center inside the frame you're looking at (`insertionArtboard`+`placementInArtboard`, auto-creates a canvas if none) and are auto-selected; `clampMove` keeps root elements inside their frame so a drag can never lose them; frames drag from their body; selection ring moved to an un-clipped overlay (`.selection-ring`) so it's never cut at the frame edge. Verified in-browser: Card landed at viewport center (X85/Y146), frame dragged 24620→24966px, ring renders.
- [x] **#9 Native zoom:** `MAX_ZOOM` 2→8, `MIN_ZOOM` 0.25→0.05, dropped the `MAX_INPUT_ZOOM_FACTOR` 1.04 cap → 1.6, sensitivity 0.00125→0.0075, ⌘0=100% / ⌘1=fit, floating bottom-right `ZoomControl` (fit · focus · − % + · focus-mode). Verified plane scale steps 25%/tick.
- [x] **#1/#2 Chrome:** top bar rebuilt into left/center/right zones with Insert / Arrange / Export dropdown menus (`ToolbarMenu`) — no overflow; zoom moved to the floating control; **focus mode** (F / button) hides panes + slides the bar away with an edge-hover reveal strip. Verified both fit and focus.
- [x] **#7 Layers panel:** `LayerNode` + artboard rows now carry hover-revealed visibility / lock / delete (+ bring-forward / send-backward for elements). Verified visibility round-trip.
- [x] **#5 New board flow:** `NewBoardDialog` template picker (Blank / Mobile / Web / Diagram / Starter demo); **Blank is empty**. `createDefaultProject(name, template)` (+`createMinimalProject`, shared `DEFAULT_TOKENS`) threaded through server route + `boardService` + `api.createBoard`. 3 schema tests added.
- [x] **#3 Connect an agent:** `AgentConnectDialog` — MCP endpoint, board id/name, copy chips, paste-ready stdio config, live health, 3-step guide. Verified "Server live".
- [x] **#6 Look & feel:** glass tokened toolbar, dot-grid canvas, deeper frame shadows, floating zoom pill, refined dropdown menus, template cards, connect dialog; dark-mode parity via token remap. Verified light + dark.
- [x] Verified all 10 in-browser; typecheck + build clean; 43/43 tests; mcp:check 36 tools. Ship: commit+push, `fastlane mac beta`.

## Phase 8 — UX overhaul v3 (second-run feedback, 2026-07-09)

User installed 202607051047 and reported 7 problems. Theme of this round: **the chrome must get out of the way and every mode/action must be self-evident**. Root causes read from `App.tsx` + `styles.css`.

- [x] **#2 Panes own their controls:** collapse buttons live ON each pane (not topbar); collapsed panes leave a floating edge tab to reopen; panes resizable by dragging their inner edge (left 216–400px, right 248–440px, persisted UI pref); remove pane buttons from topbar-right.
- [x] **#3 Selection is actionable:** floating selection toolbar above the selection (world-anchored, inverse-scaled) with Duplicate / Group / Connect(=2) / Delete; `deleteSelection` extended to frames + connectors (today: elements only — pressing ⌫ on a frame does nothing); shift-click + marquee unchanged.
- [x] **#4 Layers worth looking at:** wider default pane; row actions hover-only so names get full width; per-type icons; real expand/collapse chevrons (children collapsed by default); double-click rename inline; frame header rows with child count; indent guides.
- [x] **#5 Insert menu actually usable:** (root cause found: topbar's backdrop-filter stacking context painted dropdown menus UNDER the canvas — fixed with explicit z-index; also killed the opacity keyframe that could leave menus invisible) replace the preset `<select>`-inside-dropdown with a designed picker — device preset rows (name + size) that insert on click at viewport center, plus diagram canvas / sticky / text quick-adds.
- [x] **#6 Modes are visible:** top-center mode pill whenever tool ≠ select ("Connector — drag between shapes · Esc"), crosshair cursors, hover outlines on connect targets, and **drag-to-connect** with a live preview line (click-click still works); new connector auto-selected.
- [x] **#7 Connector inspector humans can read:** (update_connector now accepts explicit null to detach element endpoints — swap works across mixed endpoint kinds; schema test added) endpoints header with swap button; segmented Path (Curved/Elbow/Straight) + visual arrowhead pickers; "Top/Right/Bottom/Left/Auto" anchors instead of n/s/e/w; sectioned layout.
- [x] **#1 Beauty pass:** (also removed the legacy layer-row rules that forced 18px names, and made hidden layer actions display:none so names get full width) systematic de-border — panels become soft surfaces (hairline-via-shadow), tonal buttons instead of 1px-bordered boxes, filled inputs with accent focus ring, quieter section headers, dark-mode parity.
- [x] Verified every flow in-browser (selection bar, multi-select, frame ⌫+undo, drag-to-connect + preview line + mode pill, insert menu end-to-end, rename, pane collapse/edge-tab/resize+persist, dark parity, board left pristine 3/13/3); typecheck + build + 44/44 tests + mcp:check ok.

## Phase 9 — Design system overhaul (2026-07-13)

Goal: from "clean web app" to best-in-class canvas tool (Linear/Figma/Excalidraw bar). Full plan + rationale: `docs/design/powerboard-design-overhaul.html`. Doctrine: `playbooks/design.md`.

- [x] **P0 — Brand-accent migration:** rebuilt `--accent`/`--accent-soft` into a mode-aware violet ramp derived from the app icon (`--accent`,`-hover`,`-strong`,`-fg`,`-rgb`,`-soft`,`-tint`,`-border`); replaced ~20 scattered hardcoded blues in chrome with tokens; glows retint per theme via `rgba(var(--accent-rgb),α)`; added `--accent-fg` so accent fills flip to ink in dark (fixes latent white-on-light-violet contrast). Verified light+dark AA, console clean, 98 accent refs from one source. `styles.css`.
**Status reconciled 2026-08-07 by reading the code, not the checkboxes** — P1–P7 sat unticked for three weeks
while most of the work shipped inside Phases 7/8/10 and the Paper-parity pass. Counts below are what the
files actually contain today.

- [x] **P1 — Token foundation.** Shipped. `styles.css` carries `--space-1..8` (18 refs), `--r-*` (103 refs),
      `--shadow-1/2/3` (20 refs), `--dur-fast/med`, `--ease-out`, `--focus-ring`.
- [x] **P2 — Typography.** Shipped. `InterVariable.woff2` self-hosted in `apps/web/public/fonts` behind one
      `@font-face`; odd weights down to 2 stragglers from the original 650/730/760/850 spread.
- [~] **P3 — Component consolidation.** Radii done (103 token refs vs **1** surviving px literal); shadows
      **half migrated — 20 tokenised vs 29 still ad-hoc**. The control family was unified in the Paper pass
      (`.field.compact` / `.field.row` / segmented on one spec). Finish the shadow sweep and this closes.
- [x] **P4 — Signature surface.** Shipped — see "Phase 9 · P4a — Agent presence field" below: pulse
      highlights, click-to-focus feed, phased live badges, agent reticle, empty-state motif.
- [~] **P5 — Every state + content palette.** Skeletons in place (22 refs); save failure surfaces loudly from
      `api.ts`. **Not closed:** the board-content default palette decision (a/b/c) was never taken, and no
      audit has confirmed empty/loading/error/offline per panel *and* dialog.
- [x] **P6 — Canvas craft.** Shipped across Phases 7/8 — ⌘Z, space-pan, cursor-centred zoom, ⌘0/⌘1, marquee,
      selection ring and connector handles all present and on the token scale.
- [x] **P7 — A11y floor + taste pass.** Shipped as commit `3a91a9c` ("Phase 7: a11y floor + taste pass — ship
      gate"); 55 `aria-label`s in `App.tsx`, focus ring tokenised, both modes checked.
- Remaining open decision: board-content default palette (a/b/c). Inter is bundled, so that one is settled.

## Phase 10 · Multi-agent boards (2026-07-29)

Question that started it: *can more than one agent be connected to a board at once?* Audit answer:
structurally yes over HTTP `/mcp` (stateless streamable transport, fresh `McpServer` per POST, one
shared process-wide `BoardStore`, no cap, no session gate) — but concurrent editing is **unsafe and
unattributed**, and stdio is worse:

1. **Lost updates.** `applyOperation` is read → apply → pushUndo → write with awaits throughout and
   **no per-board lock** in `BoardStore` (`HistoryStore` has one; the board store does not). Two agents
   interleave and the second silently discards the first's edit. `expectedUpdatedAt` conflict detection
   exists only on the batch path and is opt-in.
2. **Agents are anonymous.** `applyAgentOperation` passes `{ source: "agent" }` with no `actor`, so every
   agent lands in the op-log as `undefined` and renders as "PowerBoard MCP". `AgentPresence` carries no
   identity, and the web app holds exactly one `agentPresence` — the second agent overwrites the first.
3. **stdio forks the store.** `mcp.ts` builds its own `BoardStore` per spawned process with no
   `onBoardChanged`/`onAgentPresence`, so stdio edits never reach the canvas over WS, and two processes
   race the same `board.json` + `history/index.json` with independent in-memory caches.

- [x] **P1 — Serialize writes.** Per-board promise-chain mutex in `BoardStore` (same shape as
      `HistoryStore.withLock`), wrapping every read-modify-write mutator: `applyOperation`,
      `applyOperations`, `replaceBoard`, `renameBoard`, `undo`, `redo`, `setSelection`, `saveAsset`,
      `deleteBoard`. Non-reentrant by design — no locked method may call another. Test: N concurrent
      `add_element` calls all survive.
- [x] **P2 — Agent identity end-to-end.** `AgentIdentity { id, name }` resolved per MCP connection:
      `?agent=` query param or `x-powerboard-agent` header (HTTP), `POWERBOARD_AGENT_NAME` (stdio),
      per-call `agentName` override registered centrally in `registerTool` (same trick as
      `idempotencyKey`). Threads into `actor` → op-log + `lastAgentEditedBy`, and into `AgentPresence` +
      `AgentBoardActivity` so the UI can attribute every ping and every edit.
- [x] **P3 — stdio parity.** `npm run mcp` probes `/api/health`; if the app/dev server is live it becomes
      a transport-level JSON-RPC proxy (stdio ⇄ streamable-HTTP) into that one process — one store, WS
      broadcasts, presence. No server running → embedded store as today (offline-first preserved).
      `POWERBOARD_MCP_EMBEDDED=1` forces embedded (used by `mcp:check` for determinism).
- [x] **P4 — Multi-agent presence lanes (canvas).** `agentPresence` → keyed map with per-agent TTL; one
      reticle per agent, each carrying its own hue + name·tool label; `AgentFeed` shows a live badge per
      agent and colour-codes rows by author. Deterministic hue from `agentId` over a 6-hue harmonious
      set; veil stays single (board-level signal).
- [x] **P5 — Verify + document.** Concurrency test in `boardService.test.ts`; two real agents editing one
      board simultaneously in the running app; typecheck/build/test/`mcp:check`; connector doc gains the
      identity + multi-agent section.
- [x] **Verified live** (2026-07-29, dev stack on :4319 — :4318 held by the installed app): 16
      concurrent `add_element` calls from two named agents all landed (26 elements, 16 undo entries,
      op-log split 8 Scout / 8 Mason); the concurrency test fails without the mutex and passes with it.
      Canvas showed two simultaneous reticles — "Scout · inspect_selection" indigo/reading and
      "Mason · move_resize_element" amber/editing — plus two live badges and per-author feed dots.
      stdio proxy attached (`attached to the running server … as "Relay"`) and its edit reached the
      live feed; embedded fallback still starts with nothing listening. 73/73 tests, typecheck, build,
      `mcp:check` (39/39 exposed) clean, console clean, light + dark.
- [ ] Follow-up worth considering: `get_board_status` could list the agents currently holding the
      board, so an arriving agent can see it is not alone before it starts restructuring.

## Phase 9 · P4a — Agent presence field (2026-07-28)

Goal: an "an agent is working right now" signal, not just an after-the-fact echo. Root cause found: the
only live agent signal today is `agentActivity` on `board.changed`, which fires *after* a write — so
between/before ops the canvas looks idle even while an agent is mid-burst. Fix at the source: emit
presence when a tool *starts* (reads included).

- [x] **Presence protocol:** `onAgentPresence` on `BoardMcpOptions`, fired from the central `registerTool`
      wrapper before every handler; `presenceTargetIds()` lifts id-ish inputs so reads carry a target.
      Broadcast as `agent.presence` from `/mcp` (`index.ts`).
- [x] **Presence state (web):** `agentPresence` = `{ tool, ids, phase: reading|editing, at }`, extended by
      each ping/edit, expires after 5s of silence; holds the last target when a call carries no ids.
- [x] **Focus reticle:** world-space corner-bracket lock that *travels* between targets (400ms eased),
      breathes while held, tightens + glows on `editing`, labelled with the live tool name (1/zoom).
- [x] **Presence veil:** viewport-edge hairline with a light sweeping the perimeter (SVG dashoffset),
      cross-fades in/out; paused when idle.
- [x] **Badge:** AgentFeed live badge is phase-aware ("reading board…" / "editing…").
- [x] Reduce-motion variants (static lock + static ring, no travel); dark mode via accent tokens.
- [x] Verified in the running app with real MCP bursts over HTTP `/mcp`: presence broadcasts on reads,
      reticle travels across artboards mid-flight, `editing…`/`reading the board…` badge flips, veil
      fades out and parks ~5s after silence. Light + dark. 48/48 tests, typecheck + build + mcp:check
      clean, console clean.
- [x] **Dev-ergonomics fix found while verifying:** a dev stack started while PowerBoard.app is open
      silently proxies to the *installed* build (both want :4318), so edits appear to do nothing. Vite
      proxy target is now `POWERBOARD_SERVER_URL`-configurable + a `powerboard-dev-alt-port` launch
      config (server 4319 / web 5174).
- [ ] Optional follow-up: off-screen agent work shows only the veil — consider a directional edge marker
      pointing at the current target.

## Phase 6 — Later (parked until user says go)

- [ ] Online/shared boards: Supabase sync via persisted op-log; share links; presence for >1 human.
- [ ] Real-time co-editing conflict strategy (decide CRDT vs single-writer-lease at design time, not now).

## Review notes

- (fill as phases complete)

## Active — Public website + Lamonade showcase (2026-08-06)

Modelled on the Vellum website (`Notes/vellum_website/`), which is the house pattern: a hand-written
static `index.html` + `site.css` + `assets/`, no build step, deployed to Vercel on a
`<product>.lamonade.xyz` subdomain, palette lifted from the product's own surfaces, and registered as a
card in the Lamonade portfolio's `workProjects` array (`Lamonade/Lamonade/src/App.tsx`).

Decisions taken with the user this session:
- **Primary CTA = "Coming to the Mac App Store."** PowerBoard is TestFlight-only (build 202607291510,
  v0.1.0). No download link exists, so the site is a showcase with an honest status line — inventing a
  download button would be the one unforgivable broken link.
- **Contribute = real Stripe Payment Link**, created this session in the Lamonade Stripe account and
  configured to mirror Vellum's exactly (product "Support PowerBoard", $4.99 USD one-off, no tax, no
  address/phone/name collection, CTA button "Donate", custom confirmation message):
  `plink_1U1LcA2QFURwSkSZvk6SxhfA` → `https://donate.stripe.com/8x28wI3oh5Le0aIaI6dUY01`.

### Build

- [x] `powerboard_website/`: `index.html`, `site.css`, `assets/`, `vercel.json`, `robots.txt`, `sitemap.xml`.
- [x] Real product screenshots — captured from the running app against a copy of the real boards
      (`AI Embedded Organization`, 506 elements / 25 connectors), never mocked art. The agent-activity
      shot shows genuine events: four `move_resize_element` ops posted with `source:"agent"` under two
      actor names, so the feed reads as real named lanes rather than a staged empty state.
- [x] `/contribute` as a Vercel redirect, so the Stripe URL is a one-line swap and every surface
      (site, future app, future App Store listing) points at a URL we own.
- [x] `/privacy`, `/terms`, `/support` — the Mac App Store submission needs them and the footer must
      not 404.
- [x] Register PowerBoard in `workProjects` in the Lamonade portfolio, iframe preview like Vellum's.
- [x] Deploy to Vercel, attach `powerboard.lamonade.xyz`.
- [x] Verify: every internal + external link resolves, mobile/tablet/desktop, console clean.

**Shipped:** commit `ad7df2a` here, `f893b99` in Lamonade. Live at
<https://powerboard.lamonade.xyz>, card live on <https://www.lamonade.xyz/#work>.

### Three things worth keeping

- **A full-app screenshot at 636px is illegible**, and on a page whose only job is showing the product
  that is a design failure, not a stylistic choice. Every feature-row shot is cropped to the one region
  that carries its point (the diagram palette, the activity feed, the export dialog); only the hero and
  the board list stay full-app. Crops are `sips --cropOffset Y X -c H W` — the offset flag must come
  *before* `-c` or sips silently ignores it and returns the original.
- **Flipped feature rows were handing the screenshot the narrow grid track.** `order: 2` on the copy
  moves it to column two but does not move the track sizes with it, so every other row squeezed the app
  UI. `.feature.flip` now swaps `grid-template-columns` too.
- **`padding: X 0` on a section that is also `.wrap` zeroes the wrap's `padding-inline`**, so on mobile
  every standalone section (`.hero`, `.band`, `.output`, `.foot`, `#files`) ran edge to edge. Invisible
  at desktop width because the max-width was doing the work. All five now use `padding-block`.

### Open

- **`AGENTS.md` says "24 MCP tools"; `npm run mcp:check` reports 41 exposed / 40 checked.** Stale, not
  wrong-by-design — the website says 41 because that is what the server actually answers with.
- **Deployment protection bit us and will again.** New Vercel projects inherit `ssoProtection:
  all_except_custom_domains`, and `vercel alias set` assigns a domain to a *deployment* without adding
  it to the *project* — so the custom-domain exemption never applies and the whole site sits behind a
  Vercel login while every URL still returns 200 to a `curl -L`. `vercel domains add <domain>` against
  the linked project is the step that actually makes it public. Check without `-L` next time.

## Shipped — v1.0.0 submitted to the Mac App Store (2026-08-11)

**Status: superseded — see "1.0.0 was rejected" below.** This section recorded
`WAITING_FOR_REVIEW` for version 1.0.0, build `202608111024`, review submission
`ef991948-6beb-490c-90fc-d4dd41893e63`, submitted 03:53 UTC, release `AFTER_APPROVAL`. That
submission completed and a second one (build `202608111608`) came back rejected. **The app is not
live.** Do not read this section as current status.

Also shipped this session: the dark-mode brand-mark fix, the right-panel reopen fix, the
pre-paint theme bootstrap, and the marketing-site screenshot/claim corrections (commits
`c098383`, `b637b15`, `a2beffa`).

### What is on the listing

- Free, 175 territories + new ones automatically. Graphics & Design / Developer Tools. 4+.
- App Privacy: **Data Not Collected**, published. Content Rights: no third-party content.
- Four macOS screenshots at 2880×1800, captured from the 1.0.0 Electron build. Kept in
  `scripts/store/screenshots/`; listing copy in `scripts/store/listing.json` so it diffs.
- Review notes explain the loopback server + that the agent feature is optional, since a
  reviewer with no MCP client must still be able to exercise every advertised feature.

### Tooling added

`scripts/asc.js` — macOS ASC operations, no new dependencies (ES256 signed with `node:crypto`).
`state · rename · create · attach · set-version · metadata · agerating · review · screenshots ·
price-free · availability · submit · get`. For the next release only `attach` → `metadata`
(What's New) → `submit` are needed; the one-time records persist.

### Open

- **App Privacy and Content Rights are web-UI only** — no ASC API endpoint exists. Fine now that
  they are set, but a fresh app record will need the browser again. See `tasks/lessons.md`.
- **The Supabase cloud project (`Creo`, `jwllfgqwqrnqdgsqpkdt`) is INACTIVE**, so
  `POWERBOARD_STORAGE_MODE=cloud` fails at boot with `(ENOTFOUND) tenant/user … not found`. Not a
  blocker — the app is offline-first by decision D2 — but the mode is broken until someone resumes
  or retires that project.
- **There are two separate board containers on this Mac, and they are easy to confuse.** The
  installed MAS/TestFlight app is sandboxed and stores boards under
  `~/Library/Containers/com.lamonade.powerboard/Data/Library/Application Support/PowerBoard/boards`
  — that is where the real set lives (`AI Embedded Organization` 506 elements, `Vellum AI Connect`,
  `AI Hauz`, `Logo`, `Presence Test`, `Auto-layout Test`, two starters). A `npm start` dev run is
  unsandboxed and uses `~/Library/Application Support/PowerBoard/boards` instead, which holds only
  `Smoke Test`. Same app name, same `getPath("userData")` call, two different stores. Pin
  `POWERBOARD_ROOT` explicitly before any scripted write, and note that `npm start` silently quits
  (exit 0, single-instance lock) if the installed app is already running — so `127.0.0.1:4318` may
  be answering from the *other* container than the one you think you launched.
- **Demo boards from the screenshot session are deleted** (`Habit tracker — app screens`,
  `Month-end close — process map`), but their compressed snapshots remain in iCloud at
  `~/Library/Mobile Documents/com~apple~CloudDocs/PowerBoard/Backups/board_3u8my_sldegb` and
  `…/board_3u8nt_lr4sn9` — the unsandboxed dev run backs up to iCloud. Safe to delete by hand.

---

## PNG export killed the app (build 202608111024) — diagnosis + fix

**Reported:** an agent session exported from PowerBoard on 2026-08-11; PNG export crashed the app
three times, so the agent used SVG instead and restarted PowerBoard twice.

**Evidence** (`~/Library/Logs/DiagnosticReports/Retired/PowerBoard-2026-08-11-15{2159,2319}.ips`):
both crashes identical — `EXC_BREAKPOINT (SIGTRAP)` on a `libvips worker` thread,
`rsvg_handle_render_document` → pango itemize → `g_log_writer_default` → `abort()`.

**Reproduced deterministically** by launching the installed app from Terminal and POSTing
`/api/boards/:id/render`:

```
Pango-WARNING: couldn't load font "emoji weight=750 Not-Rotated With-Color 11.5", …
Pango-ERROR:   Could not load fallback font, bailing out.
```

**Root cause, two layers:**

1. **Trigger.** Under the MAS App Sandbox, pango's CoreText backend can resolve no emoji font at
   all. Any emoji in board text makes `pango_core_text_font_map_load_fontset` return empty, and
   pango's response is `g_error()` — which is *always* fatal. Boards without emoji export fine
   (verified); dev never reproduces it, because an unsandboxed process finds a fallback. That is why
   this shipped.
2. **Blast radius.** The server — and therefore sharp/libvips — runs inside the Electron **main
   process**, so a native `abort()` takes the whole app down. No JS `try/catch` can catch it, and the
   user gets no error, just a vanished window.

**Fix (both layers):**

- [x] Rasterize in a **child process**. Any native abort, OOM or hang becomes a rejected promise and
      a visible "Export failed" in the dialog. Protects every future libvips fatality, not just this one.
- [x] On child death, **retry once** with `PANGOCAIRO_BACKEND=fc` + a generated `fonts.conf`
      (system font dirs, `Inter`/`ui-sans-serif`/`system-ui`/`sans-serif` → Helvetica Neue,
      `emoji` → Apple Color Emoji). Verified: emoji boards render, typography matches the CoreText
      output closely. CoreText stays the primary path because it matches the on-screen canvas.
- [x] Keep an in-process fallback for the Vercel/serverless path, where spawning is neither
      available nor needed.

---

## 1.0.0 was rejected — the `network.server` entitlement (2026-08-25)

**Live ASC state, not inferred:** version 1.0.0 is `REJECTED`, attached build `202608111608`,
release `AFTER_APPROVAL`. Two review submissions exist — `ef991948…` (03:53 UTC 2026-08-11)
`COMPLETE`, and `eb4182e1…` (09:18 UTC 2026-08-11) `UNRESOLVED_ISSUES`. The app info record is
`REJECTED` too. Check with `node scripts/asc.js state` — never trust a status written in this file.

**The rejection is automated, not a human reviewer.** Apple's static analysis says the app declares
`com.apple.security.network.server` but "does not appear to have matching functionality", and offers
two exits: drop the entitlement, or describe the usage in App Review Information and reply in
Resolution Center.

**The entitlement is genuinely required — do not remove it.** `apps/server/src/index.ts:14` pins
`const host = "127.0.0.1"` and line 373 calls `httpServer.listen(port, host)`;
`apps/desktop/main.js:150` then does `win.loadURL("http://127.0.0.1:4318")`. The UI *is* an incoming
connection to our own listener, and `/mcp` on the same port accepts inbound connections from local
agent clients. Under App Sandbox, `listen()` requires the server entitlement even on loopback.
Removing it yields a blank window and a dead app. The scanner is pattern-matching, and it is wrong.

**Fix applied (no rebuild needed — this is a metadata + Resolution Center action):**

- [x] Rewrote App Review Information to lead with the entitlement justification in Apple's own
      vocabulary ("listens for and responds to incoming network connections"), naming both inbound
      clients, the hardcoded loopback bind, and an `lsof -nP -i :4318` verification step. Stored as
      `scripts/store/review-details.json` so it diffs; applied with
      `node scripts/asc.js review 1.0.0 scripts/store/review-details.json` and read back to confirm.
      The old notes did mention loopback but framed the server as self-serving, which is precisely
      what the scanner failed to match.
- [ ] **User action — Resolution Center reply.** No public ASC API endpoint exists for Resolution
      Center messages, so this cannot be scripted. Reply text is drafted; paste it in ASC.
- [ ] After the reply, if the version stays `REJECTED`, resubmit: `node scripts/asc.js submit 1.0.0`.

**Deferred, deliberately: `com.apple.security.application-groups` is unused.** Nothing in our code
or config references the group, and `app-builder-lib` does not inject it — it came from our own
`entitlements.mas.plist`. Apple's "minimum set of entitlements" line invites removing it, but doing
so needs a rebuild, re-upload and fresh review, while the actual rejection needs none of that. It
was not the thing flagged. Drop it in the next build that rebuilds anyway, and check the Electron
Login Helper still signs — Electron's MAS guide carries app-groups in its parent entitlements.

**Lesson.** `files.user-selected.read-write` *is* used, via `will-download` →
`dialog.showSaveDialog` (powerbox) in `apps/desktop/main.js:112`. Verify each entitlement against a
real call site before believing either Apple's scanner or your own memory.

### Build `202608111608` already carries the crash fix — verified, do not rebuild

Checked before cutting a replacement build, and the replacement turned out to be unnecessary. The
build number encodes 16:08 and `497e071` landed at 16:08:07 — it was cut *minutes after* the fix,
not before it. Verified against the signed bundle rather than timestamps:

- `Contents/Resources/app.asar.unpacked/dist/rasterizeWorker.mjs` is present in the shipped `.app`.
- `node_modules` is unpacked alongside it (the `asarUnpack` change from `497e071`).
- The bundled `server.js` contains both `PANGOCAIRO_BACKEND` and `Apple Color Emoji` — the
  fontconfig fallback retry from `ef17385`.
- `git diff 497e071..HEAD -- apps/ packages/` is **empty**: zero code drift since that build.

**Decision: resubmit as-is.** A fresh build would be functionally identical, so it would buy nothing
except a processing wait and a new binary to re-verify. `application-groups` stays in for this
submission — it was not what Apple flagged, and the review notes now justify the entitlement that
was. Drop it in the next build that rebuilds for a real reason.

**Do not tell the reviewer the entitlements are minimal** while `application-groups` is still in the
plist and unused. The Resolution Center reply was written without that claim on purpose.

---

## 1.0.0 is live on the Mac App Store (2026-08-25)

`node scripts/asc.js state` → **`READY_FOR_SALE`**, build `202608111608`, no code change from the
rejected submission. Listing: https://apps.apple.com/app/powerboard/id6787366599

The whole rejection was a wording mismatch, not a defect: the automated check wanted the phrase
"listens for and responds to incoming connections", the old notes described the loopback server as
something the app does for itself, and nothing about the binary ever needed to change. Submission
`eb4182e1…` went `UNRESOLVED_ISSUES` → `WAITING_FOR_REVIEW` on the Resolution Center reply alone.

### Website updated to match (`powerboard_website/`, deployed)

Live at https://powerboard.lamonade.xyz — verified over HTTPS *without* `curl -L`, per the
deployment-protection lesson above.

- Hero status readout → real "Download on the Mac App Store" button; "See how it works" dropped to
  `.btn-ghost` so the hierarchy reads. 29 lines of dead `.status-chip` CSS removed with it,
  including the comment explaining why it deliberately was not a button.
- Beta framing retired in `terms.html` and the `support.html` "can I get into the beta" answer.

**Two facts the page must keep carrying.** The shipped binary is **arm64 only** (`lipo -archs` on
the signed app) and `LSMinimumSystemVersion` is **12.0**. The CTA note says "Apple silicon Mac on
macOS 12 or later" for that reason — a vaguer "for macOS" strands every Intel user *after* the
click. If a universal build ever ships, that line is the thing to update.

### Still open

- `com.apple.security.application-groups` is still in `entitlements.mas.plist`, unused and unbacked
  by the provisioning profile. Drop it in the next build that rebuilds for a real reason, and
  re-check the Electron Login Helper signs. Nothing calls `setLoginItemSettings`.
- Next release only needs `attach` → `metadata` (What's New) → `submit`; the one-time records persist.

---

## 1.0.1 submitted (2026-08-25) — and the entitlement that cannot be removed

**Submitted:** version 1.0.1, build `202608251532`, review submission
`4e39d8de-ab40-492d-9df9-22f13c3165cb`, `WAITING_FOR_REVIEW`, release `AFTER_APPROVAL`.
1.0.0 stays `READY_FOR_SALE` until it is approved. Review notes were re-applied to 1.0.1 —
**always do this**, since they are what cleared the automated `network.server` check.

### `application-groups` is NOT removable from our side — stop trying

Removed it from `entitlements.mas.plist`, rebuilt, and it was **still in the signed app**.
`@electron/osx-sign` (`dist/esm/util-entitlements.js`) creates the key if absent, pushes the app
identifier into it, writes its own temp plist and signs from *that* — so editing our file changes
the file and not the binary. There is no config opt-out on that path. The plist now carries a
comment saying so. Correcting the earlier note in this file: `app-builder-lib` does not inject it,
but the **signer** does, and that is where to look. Removing it for real means patching a
dependency — not worth it; every Electron MAS app ships it and App Review approved 1.0.0 with it.

**Also learned:** a new build cannot reuse an approved `CFBundleShortVersionString`. altool rejects
it (`90062`). Once a version is live, bump the marketing version before `fastlane mac beta`.

### What 1.0.1 actually ships

- **Live sync died on any non-default port.** `mcpEndpointUrl()` derived its origin from
  `window.location` while `liveSocketUrl()` beside it hardcoded `ws://127.0.0.1:4318`. `main.js`
  honours `POWERBOARD_PORT`, so HTTP worked while the socket silently failed behind an
  "unavailable" banner. Both now share `localServerBase()`. Verified on the production bundle
  served from 4320 — the exact case that used to fail.
- **A status message promised cloud saves in local mode**, where there are none.

### Audit — `docs/powerboard-app-audit-2026-08-25.html`

Measured on the **production** bundle (dev numbers are 3–5× worse and pure StrictMode artifact),
against the largest real board (817 elements, 8 artboards, depth 3).

**The one real problem: every state change re-renders the whole board.** A theme toggle — no
network, no mutation — blocks **89 ms**. A drag costs **416 ms** across four long tasks. 6,243
lines, 61 `useState`, **zero `React.memo`/`useCallback`**, 7,757 DOM nodes with no culling and no
layer-tree virtualisation. This is the `canvas/`/`panels/`/`inspector/`/`state/` split the brief
already calls for. Do not attempt it inside a release cut.

**Two findings measured and discarded** — do not re-open:
- `ArtboardView` scans all `project.elements` twice per artboard with `Array.includes` inside the
  filter, and `elementPositionInArtboard` does a linear `.find()` per ancestor. Looks like a
  textbook O(A×N×S) bug. Benchmarked: **0.141 ms/render** vs 0.031 ms indexed. 0.85% of a frame.
  Real, and irrelevant.
- "Typing in the inspector is slow" — 16 chars took 10.5 s, but a control run typing the same
  string into a plain detached `<input>` on the same page took **9.6 s**. It was the automation
  tool. App overhead is ~53 ms/char. **Not a finding.**

### Still open

- **Raw Node errors reach the user.** ~10 sites do `setStatus(error.message)`; opening a missing
  board prints `ENOENT … '/Users/km/Developer/PowerBoard/boards/…/board.json'` into the status bar.
  Failing loud is right; leaking `errno` and absolute paths into UI copy is not. Wants an
  error→sentence mapper, keeping raw text for `console.error`.
- **There is a third board container.** `npm run dev` resolves `POWERBOARD_ROOT` to the repo's own
  `boards/`, not the two this file documents. That is what produced the ENOENT above.
- The `localStorage` P0 named in `CLAUDE.md` is **already fixed** — `api.ts` uses IndexedDB and only
  theme/pane/export prefs remain in `localStorage`. The brief is stale; correct it.
