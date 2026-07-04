# PowerBoard v2 — Desktop-first master plan

Source of truth for the v2 pivot. Full rationale + feature matrix: `docs/powerboard-desktop-roadmap.html`.
Written 2026-07-04. Status legend: [ ] todo · [~] in progress · [x] done.

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
- [ ] **BLOCKED on the one manual step:** ASC app record (Apple's public API can't create app records — Apple-ID session only). ASC → Apps → + → New App: macOS · PowerBoard · com.lamonade.powerboard · SKU powerboard-mac. Watcher lane uploads automatically once it exists.
- [ ] Verify install from TestFlight on this Mac with realistic board round-trip.

## Phase 2 — Offline-first storage + iCloud backup (user's #5)

- [ ] Persist per-board op-log + undo/redo across restarts (D6).
- [ ] Versioned snapshots: on significant change + on quit → `iCloud Drive/PowerBoard/<board>/<timestamp>.json.gz`; prune to sensible retention.
- [ ] Restore UI: board card menu → "Restore from backup…" with timestamped list.
- [ ] Loud failure states: backup failed / iCloud unavailable badges in status bar.
- [ ] Keep `cloud`/`mirror` modes compiling + canary-tested but OFF by default in desktop.

## Phase 3 — UI/UX overhaul (user's #2)

- [ ] Design-system pass over every surface (playbook design.md §10 taste pass): type ramp, 4/8 grid, one accent, dark mode as designed surfaces.
- [ ] Canvas feel: inertial trackpad pan, cursor-centered zoom polish, marquee multi-select, snapping + alignment guides + smart distribute, double-click-to-edit text everywhere.
- [ ] **Agent presence as a feature** (user watches agents work): live agent cursor/badge, per-operation activity feed with human-readable entries, animated element highlights on agent edits, board-level "agent session" timeline scrubber.
- [ ] Command palette (⌘K): every operation + board search.
- [ ] Empty/loading/error states for every panel; keyboard-shortcut overlay (?); onboarding starter board.
- [ ] Panels: collapsible + resizable, layers search/filter.

## Phase 4 — Diagramming: Miro × Visio × Excalidraw, MECE (user's #4)

- [ ] **Connector v2 (the core):** element-level anchoring with ports (N/S/E/W/auto), routing modes (straight/curved/orthogonal with obstacle avoidance), arrowhead styles, midpoint labels (editable on canvas), waypoints, reconnect by dragging endpoints.
- [ ] New node types on the SAME element schema: `shape` (flowchart/UML-lite/basic geo set with text-in-shape), `sticky` (color set, author badge), `ink` (freehand, pressure-smoothed — Excalidraw feel).
- [ ] Frameless canvas work: elements may live on the page without an artboard (diagrams don't want device frames); sections/frames as light containers.
- [ ] Auto-layout commands: tree layout (org charts), left-to-right flow tidy, distribute/align.
- [ ] Tool palettes by intent — "Mockup" and "Diagram" are palette presets over one model (D5), toggled per board or per moment; zero duplicated features.
- [ ] Exports: SVG + PDF of selection/page; Mermaid export for flow/org diagrams (agents love this); spec + React/Tailwind untouched for mockups.

## Phase 5 — MCP hyper-reliability (user's #3)

- [ ] MCP served by the installed app itself (HTTP `/mcp` on 4318) so agents can always reach the live board the user is looking at; stdio mode kept for headless.
- [ ] `batch_operations` tool (atomic multi-op with preview + rollback), idempotency keys on all mutating tools.
- [ ] Error messages per playbook §4: operation, offending input, expected vs actual, suggested fix — machine-parseable `code` field.
- [ ] Session resilience: HTTP transport reconnect/resume, op-log-based conflict detection (browser vs agent simultaneous edits), `get_board_status` health/heartbeat tool.
- [ ] Reliability harness: scripted agent soak test (500 mixed ops incl. invalid ones) must end with `validate_board` clean.
- [ ] Update `docs/agents/powerboard-connector.md` for the desktop-app world.

## Phase 6 — Later (parked until user says go)

- [ ] Online/shared boards: Supabase sync via persisted op-log; share links; presence for >1 human.
- [ ] Real-time co-editing conflict strategy (decide CRDT vs single-writer-lease at design time, not now).

## Review notes

- (fill as phases complete)
