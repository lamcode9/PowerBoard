# PowerBoard Agent Brief

## Active Goal
Build PowerBoard into a polished cloud-first, agent-first design tool for creating high-fidelity app mockups.

This app is not trying to be a generic Figma clone. It should become a practical workspace where the user and Codex can design, inspect, iterate, export, and cloud-sync detailed app screens with semantic object structure.

## Product Priorities
- Make canvas interactions feel excellent: smooth cursor-centered zoom, trackpad pan, selection, dragging, resizing, grouping, hierarchy, and undo/redo.
- Make every visible UI control work clearly with useful empty states, disabled states, or status feedback.
- Ensure every object and artboard has a name, identifier, semantic role, and inspectable hierarchy path.
- Keep React + Tailwind export readable, implementation-ready, and aligned with the semantic board model.
- Support screenshot-assisted tracing: imported screenshots should act as locked overlays that can be recreated with editable semantic objects.
- Treat Supabase-backed cloud storage as the working source of truth for boards, assets, and exports.
- Keep MCP and agent control first-class. Browser edits and agent edits should go through the same operation model.

## Definition Of Done
- Browser-tested interactions.
- No browser console errors.
- `npm run typecheck`, `npm run build`, and `npm test` pass when code changes warrant them.
- PNG, spec, and React/Tailwind exports are tested when export behavior changes.
- Meaningful changes are committed and pushed.

## Cloud Source Of Truth
- Production app: `https://lamper-server.vercel.app`
- Production API: `https://lamper-server.vercel.app/api`
- Cloud health check: `https://lamper-server.vercel.app/api/health`
- Cloud board list: `https://lamper-server.vercel.app/api/boards`
- Cloud database: Supabase Postgres schema `powerboard`.
- Local checkout: `/Users/km/Developer/Board` is only the app/server codebase and optional MCP transport. Do not treat `boards/` as the source of truth.
- Local cloud-direct server, when needed: `http://127.0.0.1:4318`
- Local cloud-direct MCP endpoint, when needed: `http://127.0.0.1:4318/mcp`
- Stdio MCP command: `npm run mcp --prefix /Users/km/Developer/Board`
- Required storage mode: `POWERBOARD_STORAGE_MODE=cloud` with `SUPABASE_DB_URL`. In this mode MCP/API writes go directly to Supabase instead of local board files.
- Local board folders are migration/cache artifacts only. Do not edit `boards/<boardId>/board.json`, `boards/<boardId>/assets/`, or `boards/<boardId>/exports/` directly unless the user explicitly asks for a local migration or recovery task.

## PowerBoard MCP Connector Note For Other Projects
Paste this into another project's `AGENTS.md` or `agent.md` when that project should use PowerBoard for app mockups:

````md
## PowerBoard Design Board
Use PowerBoard as the shared design workspace for high-fidelity app mockups, screenshot tracing, hierarchy inspection, and React/Tailwind export.

- Cloud app: `https://lamper-server.vercel.app`
- Cloud API: `https://lamper-server.vercel.app/api`
- Cloud health check: `https://lamper-server.vercel.app/api/health`
- Local MCP transport, if live agent editing is needed: `http://127.0.0.1:4318/mcp`
- Local checkout: `/Users/km/Developer/Board`
- Prefer MCP tools over direct JSON edits: `list_boards`, `read_board`, `summarize_board`, `create_artboard`, `add_element`, `update_element`, `move_resize_element`, `set_selection`, `export_react_tailwind`, and `validate_board`.
- Treat Supabase/PowerBoard Cloud as the source of truth. Do not edit `boards/*/board.json` or other local board files directly.
- For cloud-direct MCP work, the running PowerBoard server must report `cloudStore: "supabase-postgres"` and `storageMode: "cloud"` at `http://127.0.0.1:4318/api/health`; still use MCP/API operations, not raw database writes.
- If the browser board should update live through local MCP/WebSocket, make sure PowerBoard is running with `npm run dev` in `/Users/km/Developer/Board`.
- For stdio MCP clients, configure:

```toml
[mcp_servers.powerboard]
command = "npm"
args = ["run", "mcp", "--prefix", "/Users/km/Developer/Board"]
[mcp_servers.powerboard.env]
POWERBOARD_CLOUD_DRIVER = "supabase"
POWERBOARD_STORAGE_MODE = "cloud"
```
````

## Collaboration Notes
- Preserve live board edits unless the user explicitly asks to reset or discard them.
- Prefer small, verified improvements over speculative rewrites.
- When touching canvas interactions, verify the actual browser behavior, not only the math.
- When adding features, keep the UI direct and tool-like: no landing page, no marketing copy, no decorative noise.
