# PowerBoard Agent Brief

## Active Goal
Build PowerBoard into a polished local-first, agent-first design tool for creating high-fidelity app mockups.

This app is not trying to be a generic Figma clone. It should become a practical workspace where the user and Codex can design, inspect, iterate, export, and eventually cloud-sync detailed app screens with semantic object structure.

## Product Priorities
- Make canvas interactions feel excellent: smooth cursor-centered zoom, trackpad pan, selection, dragging, resizing, grouping, hierarchy, and undo/redo.
- Make every visible UI control work clearly with useful empty states, disabled states, or status feedback.
- Ensure every object and artboard has a name, identifier, semantic role, and inspectable hierarchy path.
- Keep React + Tailwind export readable, implementation-ready, and aligned with the semantic board model.
- Support screenshot-assisted tracing: imported screenshots should act as locked overlays that can be recreated with editable semantic objects.
- Prepare cloud save architecture without breaking local file mode.
- Keep MCP and agent control first-class. Browser edits and agent edits should go through the same operation model.

## Definition Of Done
- Browser-tested interactions.
- No browser console errors.
- `npm run typecheck`, `npm run build`, and `npm test` pass when code changes warrant them.
- PNG, spec, and React/Tailwind exports are tested when export behavior changes.
- Meaningful changes are committed and pushed.

## Local Workspace
- Web app: `http://127.0.0.1:5173`
- Local server: `http://127.0.0.1:4318`
- Live MCP endpoint: `http://127.0.0.1:4318/mcp`
- Stdio MCP command: `npm run mcp --prefix /Users/km/Developer/Board`
- Boards live in `boards/<boardId>/board.json`.
- Uploaded board assets live in `boards/<boardId>/assets/`.
- Generated exports live in `boards/<boardId>/exports/`.

## PowerBoard MCP Connector Note For Other Projects
Paste this into another project's `AGENTS.md` or `agent.md` when that project should use PowerBoard for app mockups:

````md
## PowerBoard Design Board
Use PowerBoard as the shared design workspace for high-fidelity app mockups, screenshot tracing, hierarchy inspection, and React/Tailwind export.

- Local app: `http://127.0.0.1:5173`
- Live MCP endpoint: `http://127.0.0.1:4318/mcp`
- Local workspace: `/Users/km/Developer/Board`
- Prefer MCP tools over direct JSON edits: `list_boards`, `read_board`, `summarize_board`, `create_artboard`, `add_element`, `update_element`, `move_resize_element`, `set_selection`, `export_react_tailwind`, and `validate_board`.
- If the browser board should update live, make sure PowerBoard is running with `npm run dev` in `/Users/km/Developer/Board`.
- For stdio MCP clients, configure:

```toml
[mcp_servers.powerboard]
command = "npm"
args = ["run", "mcp", "--prefix", "/Users/km/Developer/Board"]
```
````

## Collaboration Notes
- Preserve live board edits unless the user explicitly asks to reset or discard them.
- Prefer small, verified improvements over speculative rewrites.
- When touching canvas interactions, verify the actual browser behavior, not only the math.
- When adding features, keep the UI direct and tool-like: no landing page, no marketing copy, no decorative noise.
