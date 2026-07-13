# PowerBoard v2 — Desktop-first master plan

Source of truth for the v2 pivot. Full rationale + feature matrix: `docs/powerboard-desktop-roadmap.html`.
Written 2026-07-04. Status legend: [ ] todo · [~] in progress · [x] done.

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
- [ ] Phases 5–7 per the doc (every-state + content palette → canvas craft → a11y/taste). Phase 5 next.

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

## Phase 6 — Later (parked until user says go)

- [ ] Online/shared boards: Supabase sync via persisted op-log; share links; presence for >1 human.
- [ ] Real-time co-editing conflict strategy (decide CRDT vs single-writer-lease at design time, not now).

## Review notes

- (fill as phases complete)
