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

## Phase 6 — Later (parked until user says go)

- [ ] Online/shared boards: Supabase sync via persisted op-log; share links; presence for >1 human.
- [ ] Real-time co-editing conflict strategy (decide CRDT vs single-writer-lease at design time, not now).

## Review notes

- (fill as phases complete)
