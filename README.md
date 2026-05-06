# PowerBoard

PowerBoard is the agent-native design board: a local-first canvas for detailed app mockups that designers and Codex can shape together.

V0 runs as a browser app plus a Node server. Board projects can stay local under `boards/`, mirror to Supabase, or run with Supabase as the primary store. Codex or other agents edit boards through MCP tools so browser edits, agent edits, validation, live sync, and exports all use the same operation path.

See `AGENTS.md` for the active product goal, priorities, and verification checklist.

## Cloud Save

The server supports three storage modes:

- `mirror`: local JSON files remain the source of truth and every save also mirrors to Supabase.
- `cloud`: Supabase is the source of truth. Boards, assets, and exports are written directly to Supabase without creating local board files.
- `local`: local JSON files only.

Set up Supabase Postgres:

1. Copy `.env.example` to `.env.local`.
2. Set `POWERBOARD_CLOUD_DRIVER=supabase`.
3. Set `SUPABASE_DB_URL` to the private Postgres connection string from Supabase.
4. Set `POWERBOARD_STORAGE_MODE=cloud` for direct cloud mode, or leave it as `mirror` for local-first cloud backup.
5. Restart `npm run dev`.

When enabled, the server creates a private `powerboard` schema, stores board JSON in `board_projects`, and stores uploaded assets/exports in `board_files`. Row-level security is enabled and no public browser policies are added, so the publishable key is not enough to mutate boards directly from the browser.

Agents should still use the PowerBoard MCP/API operation service instead of raw database writes. Direct SQL edits bypass schema validation, undo/redo, hierarchy updates, WebSocket sync, and export bookkeeping.

Check the active storage mode at `http://127.0.0.1:4318/api/health`. Cloud-direct mode reports `cloudStore: "supabase-postgres"` and `storageMode: "cloud"`.

## Commands

- `npm install`
- `npm run dev`
- `npm run build`
- `npm test`
- `npm run mcp`

The web app runs on `http://127.0.0.1:5173` and the local server runs on `http://127.0.0.1:4318`.

## MCP Connector

For live agent control while the browser board is open, start PowerBoard with `npm run dev`, then connect MCP-capable agents to `http://127.0.0.1:4318/mcp` using streamable HTTP. If `POWERBOARD_STORAGE_MODE=cloud` is enabled on that server, MCP changes go directly to Supabase.

For stdio-based MCP clients, use:

```toml
[mcp_servers.powerboard]
command = "npm"
args = ["run", "mcp", "--prefix", "/Users/km/Developer/Board"]
```

Project agent files can include the connector note in `AGENTS.md` or `agent.md` so future agents know to use PowerBoard for mockups and UI iteration.

## Vercel

Deploy from the repository root, not from `apps/server`. The root `vercel.json` builds the Vite web app with:

- Build command: `npm run build`
- Output directory: `apps/web/dist`

On Vercel, `api/*` functions provide the same board REST API used by the browser and force cloud-direct Supabase storage. Configure `SUPABASE_DB_URL` in the Vercel project environment. The local Node server remains the V0 path for MCP and WebSocket live agent control.
