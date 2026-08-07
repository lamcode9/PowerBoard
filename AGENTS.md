# PowerBoard — Agent Brief

Single canonical, platform-agnostic brief for PowerBoard. Authoritative for every agent (Claude, Codex, Cursor, any future tool). `CLAUDE.md` here symlinks to this file. Layers under `~/.claude/CLAUDE.md` (global) and `/Users/km/Developer/AGENTS.md` (workspace); project rules here win on conflict. Read this whole file before changing product behavior, storage, schema, MCP tools, canvas interactions, or exports.

## Mission

PowerBoard is a **desktop-first, offline-first, agent-first visual workspace** for two jobs sharing one canvas and one object model:

1. **Hi-fi app mockups** — device artboards, semantic elements, screenshot tracing, React/Tailwind + spec exports.
2. **Diagrams** — flowcharts, org charts, process flows, schematics, stickies, freehand ink; the useful core of Miro + Visio + Excalidraw, merged MECE (one canvas, one connector system, palettes differ — features never duplicate).

It ships as a signed macOS app (Electron, MAS/TestFlight), works fully offline with local file storage and iCloud snapshot backup, and treats agents as first-class co-editors: every browser edit and every MCP edit flows through the same validated operation model, and the human should *enjoy watching* agents work (live activity, readable feeds, animated highlights).

**Not** a generic Figma clone, and no longer cloud-first: Supabase is a demoted, optional sync target for the future online/sharing phase. **Genesis:** PowerBoard began as a copy of **paper.design** — when benchmarking or comparing (Miro, Visio, Excalidraw, Figma), paper.design is the primary reference point and its gap plan lives in `docs/` (see `paper-design` gap doc).

## Current state vs destination

The v2 pivot is phased — check `tasks/todo.md` (locked decisions D1–D6 + phase checklists) and `docs/powerboard-desktop-roadmap.html` before assuming which world you're in:

- **Today:** React 19 + Vite web app, Node/Express server (`127.0.0.1:4318`) with WS live-sync + MCP, storage modes `local` (JSON files) / `cloud` (Supabase, schema `powerboard`) / `mirror`. Cloud app at `https://lamper-server.vercel.app`.
- **Destination:** Electron app (`com.lamonade.powerboard`, Team `R5Z99F8UNV`) embedding that same server; boards live in app user-data as JSON; iCloud Drive snapshot backups; MCP served by the installed app; TestFlight via fastlane `beta` lane (modeled on Habeat/Vellum; ASC API key `998DV58D4V`).
- Don't re-litigate locked decisions D1–D6 without the user; do flag evidence that one is wrong.

## Architecture map

npm-workspaces monorepo, ~8k lines TS:

- `packages/schema/` — Zod schemas: `BoardProject` → `pages` / `artboards` / `elements` (typed, nestable via `parentId`, `semanticRole`, `style`, `layout`, `props`) / `connectors` / `assets` / `tokens`; the operations discriminated union; `validateBoardStructure`, hierarchy inspection. **The data model is the product — change it first, carefully, with migration.**
- `packages/renderers/` — React/Tailwind, spec-markdown, SVG export generators.
- `apps/server/` — `boardService.ts` (operation application, undo/redo stacks), `mcpServer.ts` (41 MCP tools, stdio + HTTP `/mcp` — `npm run mcp:check` is the source of truth, not this number), `cloudStore.ts`, Express API (`/api/boards`, operations, exports), WS broadcast (`board.changed` + `agentActivity`).
- `apps/web/` — `App.tsx` (being split into `canvas/`/`panels/`/`inspector/`/`state/`), DOM canvas (CSS `translate3d`+`scale` camera, SVG connector layer), `api.ts` (server + browser-local fallback).
- `apps/desktop/` — Electron shell (Phase 1): main process runs the server in-process, loads the built web bundle, owns native menus + storage paths.

## Core engineering rules (first-principles — inherits `~/.claude/CLAUDE.md`)

Restated here for visibility; the global rules stay authoritative and project-specific rules win on conflict.

- **First-principles thinking.** Justify non-obvious choices; fix root causes, never hacky or temporary patches.
- **Simplicity first, minimal impact.** Smallest change that solves the problem — no speculative code, abstractions, or configurability that wasn't asked for.
- **Surgical changes.** Touch only what the task requires; match existing conventions; don't refactor or "improve" code that isn't broken.
- **Read before write.** Scan exports, callers, and shared utilities before adding code.
- **Goal-driven & verified.** Define success criteria and prove it works before calling it done — skipped tests are not passing.
- **Fail loud.** Surface uncertainty and conflicting patterns; never hide skipped work behind "completed."

## Playbooks — read before non-trivial work

Cross-project operating doctrine at `/Users/km/Developer/playbooks/`, written by Claude
Fable 5 to raise the execution bar of any model working here — lean on it hardest when a
smaller model is running. Before planning, read the matching playbook(s) in full, pick
the three rules most likely to bite on this task, then apply silently (don't recite):

- `thinking.md` — complex/ambiguous/multi-step work; debugging that resists the first fix.
- `engineering.md` — architecture, non-trivial coding, refactors, performance, security.
- `design.md` — anything the user sees: screens, components, pages, assets, microcopy.
- `product.md` — pricing, monetization, growth, launch, positioning, business decisions.

Full routing + bootstrap rule: `/Users/km/Developer/AGENTS.md` §Playbooks.

## The operation model is sacred

- **Every mutation** — browser, MCP, script, migration — goes through the operations union in `packages/schema` and `applyAgentOperation`/`applyOperation`. Never hand-edit board JSON, never write the DB directly, never add a side door "just for this feature." New capability = new operation (or extended op) + Zod schema + validation + undo entry + WS broadcast + MCP exposure, together.
- **Schema changes ship with**: `schemaVersion` handling or migration, updated `validateBoardStructure`, updated renderers/exports if shape-visible, updated MCP tool descriptions, tests in `packages/schema`.
- **Mockups and diagrams share the model** (decision D5). A diagram shape is an element type; a connector is one connector system with anchoring/routing options. If you're about to add a parallel "diagram object," stop — extend the existing one.

## MCP etiquette (for agents editing boards)

- Before broad edits: `inspect_board_hierarchy`. Before implementation handoff: `inspect_selection` / `export_selection_handoff`. Before risky writes: `preview_operation`. After edits: `validate_board` — fix hierarchy/primitive diagnostics before exporting.
- Prefer small reversible operations over full-board `PUT`s; batch related ops when the batch tool exists.
- MCP endpoints: stdio `npm run mcp --prefix /Users/km/Developer/PowerBoard`; HTTP `http://127.0.0.1:4318/mcp`. Exposure check: `npm run mcp:check`. Treat tool errors as data — they name the offending input; don't retry blind.
- Keep live canaries compatible with the currently deployed runtime unless a branch-only fixture flag (e.g. `--include-primitives`) is explicitly intended.

## Persistence safety (workspace P0 rule — it has destroyed real user data twice elsewhere)

- Never store board data in `localStorage` (the browser fallback in `apps/web/src/api.ts` is a known P0 being replaced with IndexedDB — don't extend it).
- A failed save/backup must fail LOUD: visible status-bar state + console error. No `catch {}` on any write path.
- Verify save→quit→relaunch→restore with a realistic payload (imported screenshot, full board) before calling any persistence work done.
- Local `boards/` in the repo is migration/cache only — don't hand-edit `board.json`, `assets/`, `exports/` outside an explicit migration/recovery task.

## Design bar (the user sees everything)

- Follow `playbooks/design.md`; run its §10 taste pass before showing work. Canvas-tool conventions (Figma/Sketch/Excalidraw muscle memory) are load-bearing: ⌘Z/⌘⇧Z, space-pan, cursor-centered zoom, ⌘0/⌘1, marquee select.
- Every visible control works, explains its disabled state, or shows status. Every panel has designed empty/loading/error states.
- Agent activity is a designed surface, not a log dump: human-readable feed entries, element pulse highlights, live badges.
- One accent color; 4/8 grid; dark mode is designed surfaces, not inversion.

## Verification & Definition of Done

- Interactions verified in the running app (browser or Electron), console clean.
- `npm run typecheck`, `npm run build`, `npm test` pass when code warrants; exports (PNG/spec/React-Tailwind, later SVG/PDF/Mermaid) re-tested when export behavior changes.
- Persistence changes: round-trip verified per §Persistence safety. Release changes: build installs and launches from TestFlight.
- Meaningful changes committed and pushed. Cloud-touching work: `npm run cloud:safety -- --mode=canary --verify-exports`.
- Would a staff engineer + a senior designer both approve? If either wouldn't, it isn't done.

## Project rules

- **Work journal:** fires on observable intra-session triggers — (a) a meaningful work block completes (feature shipped, fix landed, plan/audit written, commit/push), or (b) the user signals wrap-up ("alright", "ship it", "thanks", "done", "what's next"). Run `/lamonade-auto-work-journal --project "PowerBoard" --content "..."` **before closing the response**. One entry per day (appends on repeat). Full rule: `/Users/km/Developer/CLAUDE.md` §"Work journal rule".
- **File format:** new deliverable docs are `.html` in `docs/`, registered via `lamonade-doc-register` immediately. Canonical `.md` files (this file, README, tasks/todo.md, tasks/lessons.md) stay `.md`.
- For UX-sensitive or architectural changes: propose intended behavior first when ambiguous. If a user correction reveals a reusable PowerBoard rule, record it here (and in `tasks/lessons.md`).
- Preserve unrelated worktree edits and live board edits unless the user asks to reset.
- Don't import other projects' rules (mobile/finance/Flutter/store) unless they serve PowerBoard's goal.

## Release & credentials (macOS)

- Team `R5Z99F8UNV` (Kah Mun Lam); Apple Distribution cert in login keychain; ASC API key `998DV58D4V` — `.p8` at `Habeat/.secrets/appstoreconnect/`, issuer id in that project's `scripts/.env` (never print/commit key contents; pipe via stdin/env).
- Pipeline shape: `fastlane beta` per `Habeat_app/fastlane/Fastfile` + `electron-builder` `mas` target. Mac Installer Distribution cert mintable via fastlane + API key.
- TestFlight = MAS build = App Sandbox: keep entitlements minimal (network client+server for localhost, user-selected files, iCloud container). If sandbox hard-blocks a feature, escalate with the Developer ID + notarized DMG fallback rather than weakening the feature silently.

## Connector snippet for other projects

Other projects that want to use PowerBoard for mockups/diagrams should reference `docs/agents/powerboard-connector.md` (or paste it into their own `AGENTS.md`).
