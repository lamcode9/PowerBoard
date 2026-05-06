# PowerBoard

PowerBoard is the agent-native design board: a local-first canvas for detailed app mockups that designers and Codex can shape together.

V0 runs as a browser app plus a local Node server. Board projects are stored as local JSON files under `boards/`, and Codex or other agents can edit those projects through MCP tools.

See `AGENTS.md` for the active product goal, priorities, and verification checklist.

## Local Cloud Save

The local server can mirror board files to Supabase Postgres while keeping local JSON files as the fast source of truth.

1. Copy `.env.example` to `.env.local`.
2. Set `POWERBOARD_CLOUD_DRIVER=supabase`.
3. Set `SUPABASE_DB_URL` to the private Postgres connection string from Supabase.
4. Restart `npm run dev`.

When enabled, the server creates a private `powerboard` schema, stores board JSON in `board_projects`, and stores uploaded assets/exports in `board_files`. Row-level security is enabled and no public browser policies are added, so the publishable key is not enough to mutate boards directly from the browser.

## Commands

- `npm install`
- `npm run dev`
- `npm run build`
- `npm test`
- `npm run mcp`

The web app runs on `http://127.0.0.1:5173` and the local server runs on `http://127.0.0.1:4318`.

## MCP Connector

For live agent control while the browser board is open, start PowerBoard locally with `npm run dev`, then connect MCP-capable agents to `http://127.0.0.1:4318/mcp` using streamable HTTP.

For stdio-based MCP clients, use:

```toml
[mcp_servers.powerboard]
command = "npm"
args = ["run", "mcp", "--prefix", "/Users/km/Developer/Board"]
```

Project agent files can include the connector note in `AGENTS.md` or `agent.md` so future agents know to use PowerBoard for mockups and UI iteration.

## Vercel

Deploy from the repository root, not from `apps/server`. The root `vercel.json` builds the Vite web app with:

- Build command: `npm run build --workspace @powerboard/schema && npm run build --workspace @powerboard/web`
- Output directory: `apps/web/dist`

On Vercel, the static app still falls back to browser-local board storage unless a server-side API is deployed with `SUPABASE_DB_URL`. The local Node/MCP server remains the main V0 path for agent control.
