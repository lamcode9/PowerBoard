# PowerBoard

PowerBoard is the agent-native design board: a cloud-first canvas for detailed app mockups that designers and Codex can shape together.

V0 runs as a browser app plus a Node server. Supabase is the working source of truth for boards, assets, and exports. Codex or other agents edit boards through MCP tools or the PowerBoard API so browser edits, agent edits, validation, live sync, and exports all use the same operation path.

See `AGENTS.md` for the active product goal, priorities, and verification checklist.

## Cloud Save

The server supports three storage modes, but normal PowerBoard work should use cloud mode:

- `cloud`: Supabase is the source of truth. Boards, assets, and exports are written directly to Supabase without creating local board files.
- `mirror`: local JSON files remain the source of truth and every save also mirrors to Supabase. Use only for migration/recovery.
- `local`: local JSON files only.

Set up Supabase Postgres:

1. Copy `.env.example` to `.env.local`.
2. Set `POWERBOARD_CLOUD_DRIVER=supabase`.
3. Set `SUPABASE_DB_URL` to the private Postgres connection string from Supabase.
4. Set `POWERBOARD_STORAGE_MODE=cloud`.
5. Restart `npm run dev`.

When enabled, the server creates a private `powerboard` schema, stores board JSON in `board_projects`, and stores uploaded assets/exports in `board_files`. Row-level security is enabled and no public browser policies are added, so the publishable key is not enough to mutate boards directly from the browser.

Agents should still use the PowerBoard MCP/API operation service instead of raw database writes. Direct SQL edits bypass schema validation, undo/redo, hierarchy updates, WebSocket sync, and export bookkeeping.

Check the active storage mode at `http://127.0.0.1:4318/api/health`. Cloud-direct mode reports `cloudStore: "supabase-postgres"` and `storageMode: "cloud"`.

To migrate any local board folders into Supabase, run `npm run sync:cloud`. This uploads each `boards/<boardId>/board.json`, embedded data URL assets, local assets, and exports into the cloud store, then verifies the uploaded board and files.

## Commands

- `npm install`
- `npm run dev`
- `npm run build`
- `npm test`
- `npm run mcp`

The web app runs on `http://127.0.0.1:5173` and the local server runs on `http://127.0.0.1:4318`.

## MCP Connector

For live agent control while the browser board is open, start PowerBoard with `npm run dev`, then connect MCP-capable agents to `http://127.0.0.1:4318/mcp` using streamable HTTP. `POWERBOARD_STORAGE_MODE=cloud` must be enabled so MCP changes go directly to Supabase.

For stdio-based MCP clients, use:

```toml
[mcp_servers.powerboard]
command = "npm"
args = ["run", "mcp", "--prefix", "/Users/km/Developer/Board"]
[mcp_servers.powerboard.env]
POWERBOARD_CLOUD_DRIVER = "supabase"
POWERBOARD_STORAGE_MODE = "cloud"
```

Project agent files can include the connector note in `AGENTS.md` or `agent.md` so future agents know to use PowerBoard for mockups and UI iteration.

## Vercel

Deploy from the repository root, not from `apps/server`. The root `vercel.json` builds the Vite web app with:

- Build command: `npm run build`
- Output directory: `apps/web/dist`

On Vercel, `api/*` functions provide the same board REST API used by the browser and force cloud-direct Supabase storage. Configure `SUPABASE_DB_URL` in the Vercel project environment. The local Node server remains the V0 path for MCP and WebSocket live agent control.
