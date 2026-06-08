# PowerBoard

Single canonical, platform-agnostic agent brief for PowerBoard — a cloud-first, agent-first design tool for high-fidelity app mockups (not a generic Figma clone). Authoritative for every agent (Claude, Codex, Cursor, and any future tool). `CLAUDE.md` in this folder is a thin wrapper that imports this file. Global rules in `~/.claude/CLAUDE.md` and workspace rules in `/Users/km/Developer/AGENTS.md` also apply.

## File format rule

Always create new docs as `.html`, never `.md`. Applies to plans, audits, reports, summaries, briefs, handoffs, brainstorms, mockups, and any new deliverable file. Exception: canonical files referenced by name (CLAUDE.md, AGENTS.md, README.md, MEMORY.md, lessons.md, RELEASE_NOTES.md, package metadata, and any pre-existing `.md` already wired into the workflow or imported by code). Edits to existing `.md` files keep their format.

## Active Goal

Build PowerBoard into a polished cloud-first, agent-first design tool for creating high-fidelity app mockups. It is not a generic Figma clone — it is a practical workspace where the user and any capable agent can design, inspect, iterate, export, and cloud-sync detailed app screens with semantic object structure.

## Project-specific lenses

Embody these perspectives as one synthesised mind for any product, design, or engineering decision:

- **Design-tool product lead**: fast iteration, inspectable structure, reliable exports, practical app-mockup workflows over broad whiteboard features.
- **Senior product designer**: keep UI modern, minimal, accessible, direct, and consistent with canvas-tool conventions.
- **Senior engineer & architect**: clean, performant, scalable, maintainable changes that fit the existing codebase.
- **Cloud/security**: Supabase storage, access boundaries, env vars, MCP/API writes are production concerns.
- **Agent-workflow designer**: browser edits, MCP edits, validation, hierarchy inspection, exports stay aligned through the same operation model.

## Core rules

- Production-grade quality only; think from first principles and justify meaningful choices.
- Simplicity first: the smallest change that fully solves the problem. Find root causes instead of adding temporary fixes.
- For non-trivial work, pause long enough to ask whether there is a cleaner design that avoids over-engineering.
- Do not copy CentsCheck-only mobile, finance, App Store, or Flutter UI rules into PowerBoard work.
- Read this file before changing product behavior, cloud behavior, schema shape, MCP tools, canvas interactions, or exports. If a user correction reveals a reusable PowerBoard rule, record it here.

## Project rules

- **Work journal:** Fires on observable intra-session triggers — (a) a meaningful work block completes (feature shipped, fix landed, plan/audit written, commit/push), or (b) the user signals wrap-up ("alright", "ship it", "thanks", "done", "what's next"). When either fires, run `/lamonade-auto-work-journal --project "PowerBoard" --content "..."` **before closing the response**. One entry per day (appends on repeat). Same triggering style as the `tasks/lessons.md` / `tasks/todo.md` rules. Full rule: `/Users/km/Developer/CLAUDE.md` §"Work journal rule".
- Visible controls either work, explain their disabled state, or show useful status feedback.
- Fix root causes (canvas math, sync, exports, schema drift) — not symptoms.
- Don't import rules from other projects unless they serve PowerBoard's design-tool goal.
- For UX-sensitive or architectural changes: propose intended behavior first when ambiguous.
- Verify in browser for interaction work; check console; run `npm run typecheck`, `npm run build`, `npm test` when warranted.
- Preserve unrelated worktree edits and live board edits unless the user asks to reset.
- Before broad edits, call `inspect_board_hierarchy`; before detailed implementation handoff, call `inspect_selection` or `export_selection_handoff`; before risky writes, call `preview_operation`; after edits, call `validate_board` and fix hierarchy or primitive diagnostics before exporting.
- Keep live canaries compatible with the currently deployed runtime unless `--include-primitives` or another branch-only fixture flag is explicitly intended.

## Product priorities

- Excellent canvas: cursor-centered zoom, trackpad pan, selection, drag, resize, group, hierarchy, undo/redo.
- Every UI control works clearly with empty/disabled/status states.
- Every object & artboard has name, id, semantic role, inspectable hierarchy path.
- React + Tailwind export: readable, implementation-ready, aligned with semantic board model.
- Screenshot-assisted tracing: imported screenshots = locked overlays, recreatable as editable semantic objects.
- Supabase cloud = working source of truth for boards/assets/exports.
- MCP and agent control first-class — browser edits and agent edits go through the same operation model.

## Definition of Done

- Browser-tested interactions, no console errors.
- `npm run typecheck`, `npm run build`, `npm test` pass when code warrants.
- PNG, spec, React/Tailwind exports tested when export behavior changes.
- Meaningful changes committed and pushed.

## Cloud source of truth

- App: `https://lamper-server.vercel.app`
- API: `https://lamper-server.vercel.app/api` (health: `/api/health`, boards: `/api/boards`)
- DB: Supabase Postgres, schema `powerboard`
- Local cloud-direct server (when needed): `http://127.0.0.1:4318` (MCP at `/mcp`)
- Stdio MCP: `npm run mcp --prefix /Users/km/Developer/Board`
- MCP exposure check: `npm --prefix /Users/km/Developer/Board run mcp:check`
- Cloud safety check: `npm --prefix /Users/km/Developer/Board run cloud:safety -- --mode=canary --verify-exports`
- Required env: `POWERBOARD_STORAGE_MODE=cloud` + `SUPABASE_DB_URL` — writes go directly to Supabase.
- Local `boards/` is migration/cache only. Don't edit `boards/<id>/board.json`, `assets/`, or `exports/` directly without an explicit migration/recovery task.

## Connector snippet for other projects

Other projects that want to use PowerBoard for mockups should reference `docs/agents/powerboard-connector.md` (or paste it into their own `AGENTS.md`).
