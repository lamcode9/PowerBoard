# PowerBoard Connector Snippet

Paste this into another project's `AGENTS.md` / `CLAUDE.md` when that project should use PowerBoard for app mockups **or diagrams** (flowcharts, org charts, process flows, schematics).

---

## PowerBoard Design Board

Use PowerBoard as the shared visual workspace for high-fidelity app mockups, screenshot tracing, hierarchy inspection, React/Tailwind export, **and diagramming** (Miro × Visio × Excalidraw, one canvas and one object model — genesis is a copy of paper.design).

PowerBoard is **desktop-first and offline-first**: the installed macOS app embeds the server and serves MCP itself, so the endpoint below reaches the exact board the human is looking at, live. There is no cloud dependency for editing.

- Local MCP transport (live agent editing): `http://127.0.0.1:4318/mcp` — served by the installed PowerBoard app (or `npm run dev`). Append `?agent=YourName` so your work is attributable (see below).
- Health/heartbeat: `http://127.0.0.1:4318/api/health` (also the `get_board_status` MCP tool).
- Local checkout: `/Users/km/Developer/PowerBoard`.
- Storage is local JSON files (source of truth) with versioned backup snapshots. Do **not** edit `boards/*/board.json`, history, or backups directly — every change goes through an operation.

### Several agents on one board

A board takes as many agents as you point at it, at the same time as the human editing it. Writes are
serialized per board, so concurrent edits can't silently overwrite each other — but two agents
restructuring the same artboard still produce a mess, so split the work by artboard or by page.

**Say who you are.** Identity drives the op-log, the activity feed, and your own coloured presence
lane on the canvas; unnamed clients all collapse into one lane called "Agent".

- HTTP: `http://127.0.0.1:4318/mcp?agent=Codex`, or send an `x-powerboard-agent: Codex` header.
- stdio: set `POWERBOARD_AGENT_NAME` in the server config's `env`.
- Per call: pass `agentName` on any tool, which overrides the connection's name.

Two connections that give the same name share one lane — use distinct names for distinct lanes.
This is a display label, not authentication; the local endpoint is unauthenticated by design.

Use `batch_operations` with `expectedUpdatedAt` when a multi-step edit assumes the board hasn't
moved under you — serialization stops lost writes, but it doesn't make your read stay true.

### Etiquette (do this in order)

1. `inspect_board_hierarchy` before broad edits; `get_board_status` to confirm the server + board are live before a long session.
2. `preview_operation` before risky writes; `inspect_selection` / `export_selection_handoff` before an implementation handoff.
3. Prefer `batch_operations` for multi-step edits — it is **atomic** (all-or-nothing, one undo entry) and takes `expectedUpdatedAt` (the board `metadata.updatedAt` you last read) for conflict detection against the human editing simultaneously.
4. Pass an `idempotencyKey` on mutating tools when you might retry — the same key replays the first result for 10 minutes instead of double-applying.
5. After edits, `validate_board` and fix hierarchy/primitive diagnostics before exporting.
6. Treat tool errors as data: every error is `{ code, tool, message, hint, details }` (codes: `validation_failed`, `not_found`, `missing_input`, `conflict`, `internal_error`). Read `hint`; don't retry blind.

### MCP tools (39)

The MCP surface is **application-wide**, not scoped to one board — an agent (e.g. Claude Desktop via a custom connector on `…/mcp`) can manage the whole workspace: list every board, create, rename, delete, and see the files backing each one, then edit inside any of them.

- **Read/inspect:** `list_boards`, `read_board`, `summarize_board`, `list_board_files`, `inspect_board_hierarchy`, `inspect_selection`, `describe_selection`, `get_selection`, `get_board_status`, `read_oplog`, `preview_operation`, `validate_board`.
- **Board lifecycle (application-level):** `create_board`, `rename_board`, `delete_board` (irreversible — deletes JSON/assets/exports/history; not covered by board undo, but versioned backup snapshots are kept). These are store-level lifecycle actions, not operations-union edits.
- **Mockup edits:** `create_artboard`, `update_artboard`, `delete_artboard`, `create_variant`, `add_element`, `update_element`, `move_resize_element`, `delete_element`, `group_elements`, `set_selection`, `import_screenshot_overlay`.
- **Diagram edits (same object model):** `add_element` with `presetType: "shape"` (12 kinds: rectangle, rounded, ellipse, diamond, parallelogram, cylinder, hexagon, triangle, star, cloud, document, arrow-right — `props.shape` + `props.text`) or `"ink"`; `add_connector` / `update_connector` / `delete_connector` (element anchoring, `fromPort`/`toPort` = auto|n|s|e|w, `routing` = straight|orthogonal|curved, `arrowStart`/`arrowEnd` = none|arrow|triangle|dot|diamond, `waypoints`, `label`, `labelPosition`); `apply_layout` (`tree` for org charts, `flow` for left→right process, `align-*`, `distribute-*`).
- **Batch + history:** `batch_operations`, `board_undo`, `board_redo`.
- **Export:** `export_react_tailwind`, `export_board_spec`, `export_artboard_png`, `export_selection_handoff` (mockups); `export_page_svg`, `export_page_pdf`, `export_mermaid` (diagrams — Mermaid is shape-aware: diamonds → `{}`, cylinders → `[()]`, etc.).

### Mockup vs diagram

One model, two palettes (decision D5). A diagram shape is an element type; a connector is the same connector system with element anchoring + routing. Frameless artboards (`frameless: true`) render diagram canvases without device chrome. Don't add a parallel "diagram object" — extend the existing element/connector.

### stdio MCP client (headless)

```toml
[mcp_servers.powerboard]
command = "npm"
args = ["run", "mcp", "--prefix", "/Users/km/Developer/PowerBoard"]
env = { POWERBOARD_AGENT_NAME = "Codex" }
# Defaults to local-file storage (offline-first). Omit env for the desktop/local world.
```

When PowerBoard (or `npm run dev`) is already running, the stdio entrypoint attaches to it and
proxies through — one store, so your edits appear on the human's canvas as they land. With nothing
listening it falls back to an embedded store, which still works offline but is invisible to any open
window. `POWERBOARD_MCP_EMBEDDED=1` forces the embedded path.

> Legacy cloud sync (Supabase at `https://lamper-server.vercel.app`) still exists as an optional target but is demoted — the desktop app is local-first. Only set `POWERBOARD_STORAGE_MODE=cloud` + `POWERBOARD_CLOUD_DRIVER=supabase` for explicit cloud-direct work.
