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
- `npm run mcp:check`
- `npm run cloud:safety -- --mode=canary`
- `npm run cloud:safety -- --mode=canary --verify-exports`

The web app runs on `http://127.0.0.1:5173` and the local server runs on `http://127.0.0.1:4318`.

## MCP Connector

For live agent control while the browser board is open, start PowerBoard with `npm run dev`, then connect MCP-capable agents to `http://127.0.0.1:4318/mcp` using streamable HTTP. `POWERBOARD_STORAGE_MODE=cloud` must be enabled so MCP changes go directly to Supabase.

Run `npm run mcp:check` before agent-heavy work to prove the stdio MCP server exposes the expected PowerBoard tools. The check uses a temporary local board root when cloud credentials are not available, so it verifies tool exposure without writing to production boards. Use `npm run mcp:check -- --require-cloud` only when `SUPABASE_DB_URL` is available and the local stdio server must be proven in cloud mode.

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

Agents should prefer MCP tools for reads, edits, hierarchy inspection, validation, previews, and exports. Use `inspect_board_hierarchy` before broad edits so element paths and parent/child relationships are clear, use `inspect_selection` for computed style and absolute frame details, use `preview_operation` before risky writes, then use `validate_board` after changes to catch hierarchy and primitive diagnostics. Use `export_selection_handoff` when an implementation handoff should include React/Tailwind JSX for the selected artboard. Raw REST calls are a fallback for health/status reads or emergency diagnostics; arbitrary object mutation through `PUT /api/boards/:boardId` should not be the normal workflow because it bypasses the agent operation metadata and makes live collaboration harder to audit.

## Cloud Safety

Before risky board or exporter work, create a dry-run safety plan:

```bash
npm run cloud:safety -- --mode=canary
npm run cloud:safety -- --mode=backup --board <boardId>
npm run cloud:safety -- --mode=canary --verify-exports
```

Dry-run is the default and does not create or change cloud boards. The default canary stays compatible with the currently deployed production runtime. Add `--include-primitives` only when the target runtime already supports the branch primitive types and you intentionally want the canary to exercise icon, line, and sparkline exports. To create a clearly named canary or backup duplicate, rerun with `--write` after production health is green and `SUPABASE_DB_URL` is available:

```bash
npm run cloud:safety -- --mode=canary --write
npm run cloud:safety -- --mode=canary --write --verify-exports
npm run cloud:safety -- --mode=canary --write --verify-exports --include-primitives
npm run cloud:safety -- --mode=backup --board <boardId> --write
```

These commands create new cloud boards only. They do not mutate active production boards. `--verify-exports` reads the new safety board back, runs hierarchy/primitive validation, and writes PNG/spec/React exports only to that safety board.

## Vercel

Deploy from the repository root, not from `apps/server`. The root `vercel.json` builds the Vite web app with:

- Build command: `npm run build`
- Output directory: `apps/web/dist`

On Vercel, `api/*` functions provide the same board REST API used by the browser and force cloud-direct Supabase storage. Configure `SUPABASE_DB_URL` in the Vercel project environment. The local Node server remains the V0 path for MCP and WebSocket live agent control.
