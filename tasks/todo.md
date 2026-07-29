# PowerBoard v2 — Desktop-first master plan

Source of truth for the v2 pivot. Full rationale + feature matrix: `docs/powerboard-desktop-roadmap.html`.
Written 2026-07-04. Status legend: [ ] todo · [~] in progress · [x] done.

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
- [ ] Split `App.tsx` (2.6k lines) into modules — deferred to Phase 3 start (not needed to ship the shell; keeps this diff surgical).
- [ ] Extract design tokens into CSS variables + dark-mode layer — deferred to Phase 3 start.

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
- [ ] **P1 — Token foundation:** add missing scales — spacing (`--space-1..8`), radius (`--r-*`, kills the 15-value chaos), elevation (`--shadow-1/2/3`, kills 48 ad-hoc shadows), motion (`--dur-*`,`--ease-*`), semantic `--focus-ring`. Non-breaking vocabulary for P2–P3.
- [ ] **P2 — Typography:** bundle Inter variable (self-hosted woff2, offline-first); collapse odd weights (650/730/760/850) → 400/500/600/700; ~5-step size scale; tabular figures on all compared numbers.
- [ ] **P3 — Component consolidation:** map every radius/shadow/spacing literal → tokens; unify the control family (button/field/segmented) onto one spec; remove-until-it-breaks border cleanup.
- [ ] **P4 — Signature surface (the differentiator):** live agent canvas — element pulse highlights, readable Agent Activity timeline (click-to-focus, live badge), alive connect-agent flow, icon motif in empty state. `AgentFeed.tsx` + canvas layer.
- [ ] **P5 — Every state + content palette:** empty/loading/error/offline/success per panel+dialog; skeletons not spinners; loud save/backup failure; **decide board-content default palette** (rec: neutral ink defaults, accent on demand) — App.tsx seeds ~1279/3332/3757.
- [ ] **P6 — Canvas craft:** verify/refine ⌘Z, space-pan, cursor-centered zoom, ⌘0/⌘1, marquee, inertial pan; polish selection ring/snap/connector handles on the token scale.
- [ ] **P7 — A11y floor + taste pass:** focus rings everywhere, icon-button labels, AA both modes, large-text survival; §10 squint / remove-until-breaks / cheap-tell hunt / best-in-class compare.
- Open decisions (see plan doc): board-content palette (a/b/c); bundle Inter (~110KB, rec yes); sequence P1→P3 before P4 (or P4 in parallel after P1).

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
