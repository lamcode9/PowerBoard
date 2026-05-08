# Safe Foundation Batch Status

Date: 2026-05-08

Scope: first safe foundation batch for the Paper.Design gap roadmap. This is not the full roadmap implementation.

## Completed In This Batch

- Added `npm run cloud:safety` for dry-run-first cloud safety planning.
- Added canary-board creation with `--mode=canary --write` for a clearly named, isolated cloud board.
- Added backup-board duplication with `--mode=backup --board <boardId> --write` for a new cloud duplicate of an existing board, including copied asset files when present.
- Added `npm run mcp:check` so agents can verify stdio MCP tool exposure before relying on PowerBoard.
- Added documentation that MCP is the preferred agent path and raw REST object mutation is an emergency fallback, not normal design work.
- Added a PNG regression test that rasterizes an editable text element and checks for visible glyph pixels.
- Hid internal IDs from default canvas/layer labels while keeping ID detail and copy access in the inspector.

## Agent Rules

- Treat Supabase/PowerBoard Cloud as the board source of truth.
- Use MCP tools for board reads, edits, validation, selection, and exports whenever available.
- Use production REST only for health/status reads, or as a short-lived diagnostic fallback.
- Do not mutate active production boards for safety checks. Create a canary board or a backup duplicate instead.
- Do not edit `boards/*/board.json`, `boards/*/assets/`, or `boards/*/exports/` for normal app work.

## Commands

```bash
curl -fsS https://lamper-server.vercel.app/api/health
npm run cloud:safety -- --mode=canary
npm run cloud:safety -- --mode=backup --board <boardId>
npm run mcp:check
npm run typecheck
npm run build
npm test
```

## Deferred

- CSS-first auto-layout and constraints.
- Material icon primitive.
- Line and sparkline primitives.
- Rich MCP inspection tools for computed styles, children, screenshots, and JSX.
- Production deploy.
