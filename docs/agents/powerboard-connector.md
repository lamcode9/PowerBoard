# PowerBoard Connector Snippet

Paste this into another project's `AGENTS.md` / `CLAUDE.md` when that project should use PowerBoard for app mockups.

---

## PowerBoard Design Board

Use PowerBoard as the shared design workspace for high-fidelity app mockups, screenshot tracing, hierarchy inspection, and React/Tailwind export.

- Cloud app: `https://lamper-server.vercel.app`
- Cloud API: `https://lamper-server.vercel.app/api`
- Cloud health check: `https://lamper-server.vercel.app/api/health`
- Local MCP transport (live agent editing): `http://127.0.0.1:4318/mcp`
- Local checkout: `/Users/km/Developer/PowerBoard`
- Prefer MCP tools over direct JSON edits: `list_boards`, `read_board`, `summarize_board`, `inspect_board_hierarchy`, `inspect_selection`, `create_artboard`, `add_element`, `preview_operation`, `update_element`, `move_resize_element`, `set_selection`, `export_selection_handoff`, `export_react_tailwind`, `validate_board`.
- Before broad edits, call `inspect_board_hierarchy`; before detailed implementation handoff, call `inspect_selection` or `export_selection_handoff`; before risky writes, call `preview_operation`; after edits, call `validate_board` and fix hierarchy or primitive diagnostics before exporting.
- Treat Supabase / PowerBoard Cloud as the source of truth. Do not edit `boards/*/board.json` or other local board files directly.
- For cloud-direct MCP work, the running PowerBoard server must report `cloudStore: "supabase-postgres"` and `storageMode: "cloud"` at `http://127.0.0.1:4318/api/health`.
- For live browser updates through local MCP/WebSocket, run PowerBoard with `npm run dev` in `/Users/km/Developer/PowerBoard`.

For stdio MCP clients:

```toml
[mcp_servers.powerboard]
command = "npm"
args = ["run", "mcp", "--prefix", "/Users/km/Developer/PowerBoard"]

[mcp_servers.powerboard.env]
POWERBOARD_CLOUD_DRIVER = "supabase"
POWERBOARD_STORAGE_MODE = "cloud"
```
