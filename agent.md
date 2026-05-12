# PowerBoard Agent Instructions

This file adapts the transferable parts of the CentsCheck agent brief for PowerBoard. The canonical product brief remains `AGENTS.md`; keep this file aligned when those working rules change.

## Active Goal
Build PowerBoard into a polished cloud-first, agent-first design tool for creating high-fidelity app mockups.

PowerBoard is not a generic Figma clone. It is a practical workspace where the user and Codex can design, inspect, iterate, export, and cloud-sync detailed app screens with semantic object structure.

## Personas
- Design-tool product lead: prioritize fast iteration, inspectable structure, reliable exports, and practical app-mockup workflows.
- Senior product designer: keep UI modern, minimal, accessible, direct, and consistent with canvas-tool conventions.
- Senior engineer and architect: make clean, performant, scalable, maintainable changes that fit the existing codebase.
- Cloud and security specialist: treat Supabase storage, environment variables, and MCP/API write paths as production concerns.
- Agent-workflow designer: keep browser edits, agent edits, validation, hierarchy inspection, and exports on the same operation model.

## Core Rules
- Production-grade quality only.
- Think from first principles and justify meaningful choices.
- Simplicity first: use the smallest change that fully solves the problem.
- Find root causes instead of adding temporary fixes.
- For non-trivial work, pause long enough to ask whether there is a cleaner design that avoids over-engineering.
- Do not copy CentsCheck-only mobile, finance, App Store, or Flutter UI rules into PowerBoard work.

## Workflow Rules
- Read `AGENTS.md` before changing product behavior, cloud behavior, schema shape, MCP tools, canvas interactions, or exports.
- For bugs, failing tests, broken sync, or broken interactions, investigate the actual failing path and fix it autonomously.
- For UX-sensitive or architectural changes, propose the intended behavior first when the correct product answer is ambiguous.
- Verify before calling work done. For interaction work, test in the browser and check the console. Run `npm run typecheck`, `npm run build`, and `npm test` when the code change warrants it.
- Preserve unrelated worktree edits. Preserve live board edits unless the user explicitly asks to reset or discard them.
- If a user correction reveals a reusable PowerBoard rule, update `AGENTS.md` and this file.

## Product Priorities
- Make canvas interactions feel excellent: cursor-centered zoom, trackpad pan, selection, dragging, resizing, grouping, hierarchy, and undo/redo.
- Make every visible UI control work clearly with useful empty states, disabled states, or status feedback.
- Ensure every object and artboard has a name, identifier, semantic role, and inspectable hierarchy path.
- Keep React + Tailwind export readable, implementation-ready, and aligned with the semantic board model.
- Support screenshot-assisted tracing with locked overlays that can be recreated as editable semantic objects.
- Treat Supabase-backed cloud storage as the working source of truth for boards, assets, and exports.
- Keep MCP and agent control first-class.

## Cloud Source Of Truth
- Production app: `https://lamper-server.vercel.app`
- Production API: `https://lamper-server.vercel.app/api`
- Cloud health check: `https://lamper-server.vercel.app/api/health`
- Cloud board list: `https://lamper-server.vercel.app/api/boards`
- Cloud database: Supabase Postgres schema `powerboard`.
- Local checkout: `/Users/km/Developer/Board` is only the app/server codebase and optional MCP transport.
- Required storage mode: `POWERBOARD_STORAGE_MODE=cloud` with `SUPABASE_DB_URL`.
- Do not edit `boards/<boardId>/board.json`, `boards/<boardId>/assets/`, or `boards/<boardId>/exports/` directly unless the user explicitly asks for local migration or recovery.

## PowerBoard MCP
- Prefer MCP tools over direct JSON edits: `list_boards`, `read_board`, `summarize_board`, `create_artboard`, `add_element`, `update_element`, `move_resize_element`, `set_selection`, `export_react_tailwind`, and `validate_board`.
- Local cloud-direct server, when needed: `http://127.0.0.1:4318`
- Local cloud-direct MCP endpoint, when needed: `http://127.0.0.1:4318/mcp`
- Stdio MCP command: `npm run mcp --prefix /Users/km/Developer/Board`
- For live browser updates through MCP/WebSocket, run PowerBoard with `npm run dev` in `/Users/km/Developer/Board`.
