# PowerBoard

Cloud-first, agent-first design tool for high-fidelity app mockups (not a generic Figma clone). Global rules in `~/.claude/CLAUDE.md` apply.

## Project-specific lenses

- **Design-tool product lead**: fast iteration, inspectable structure, reliable exports, practical app-mockup workflows over broad whiteboard features
- **Cloud/security**: Supabase storage, access boundaries, env vars, MCP/API writes are production concerns
- **Agent-workflow**: browser edits, MCP edits, validation, hierarchy inspection, exports stay aligned through the same operation model

## Project rules

- Visible controls either work, explain their disabled state, or show useful status feedback
- Fix root causes (canvas math, sync, exports, schema drift) — not symptoms
- Don't import rules from other projects unless they serve PowerBoard's design-tool goal
- For UX-sensitive or architectural changes: propose intended behavior first when ambiguous
- Verify in browser for interaction work; check console; run `npm run typecheck`, `npm run build`, `npm test` when warranted
- Preserve unrelated worktree edits and live board edits unless the user asks to reset
- Before broad edits, call `inspect_board_hierarchy`; before detailed implementation handoff, call `inspect_selection` or `export_selection_handoff`; before risky writes, call `preview_operation`; after edits, call `validate_board` and fix hierarchy or primitive diagnostics before exporting
- Keep live canaries compatible with the currently deployed runtime unless `--include-primitives` or another branch-only fixture flag is explicitly intended

## Product priorities

- Excellent canvas: cursor-centered zoom, trackpad pan, selection, drag, resize, group, hierarchy, undo/redo
- Every UI control works clearly with empty/disabled/status states
- Every object & artboard has name, id, semantic role, inspectable hierarchy path
- React + Tailwind export: readable, implementation-ready, aligned with semantic board model
- Screenshot-assisted tracing: imported screenshots = locked overlays, recreatable as editable semantic objects
- Supabase cloud = working source of truth for boards/assets/exports
- MCP and agent control first-class — browser edits and agent edits go through the same operation model

## Definition of Done

- Browser-tested interactions, no console errors
- `npm run typecheck`, `npm run build`, `npm test` pass when code warrants
- PNG, spec, React/Tailwind exports tested when export behavior changes
- Meaningful changes committed and pushed

## Cloud source of truth

- App: `https://lamper-server.vercel.app`
- API: `https://lamper-server.vercel.app/api` (health: `/api/health`, boards: `/api/boards`)
- DB: Supabase Postgres, schema `powerboard`
- Local cloud-direct server (when needed): `http://127.0.0.1:4318` (MCP at `/mcp`)
- Stdio MCP: `npm run mcp --prefix /Users/km/Developer/Board`
- MCP exposure check: `npm --prefix /Users/km/Developer/Board run mcp:check`
- Cloud safety check: `npm --prefix /Users/km/Developer/Board run cloud:safety -- --mode=canary --verify-exports`
- Required env: `POWERBOARD_STORAGE_MODE=cloud` + `SUPABASE_DB_URL` — writes go directly to Supabase
- Local `boards/` is migration/cache only. Don't edit `boards/<id>/board.json`, `assets/`, or `exports/` directly without an explicit migration/recovery task.

## Connector snippet for other projects

Other projects that want to use PowerBoard for mockups should reference `docs/agents/powerboard-connector.md` (or paste it into their own `AGENTS.md`/`CLAUDE.md`).
