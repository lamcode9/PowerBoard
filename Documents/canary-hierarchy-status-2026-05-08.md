# Canary And Hierarchy Batch Status

Date: 2026-05-08

Scope: third safe roadmap batch after the cloud/MCP safety foundation and primitive-tool batch. This is not the full Paper.Design gap plan.

## Completed In This Batch

- Added shared board hierarchy inspection that returns stable artboard and element paths for agents.
- Added shared validation diagnostics for hierarchy integrity and app-mockup primitives.
- Exposed hierarchy inspection through MCP as `inspect_board_hierarchy`.
- Expanded `validate_board` so it reports diagnostics and hierarchy, not only schema parse success.
- Added local REST read endpoints for validation and hierarchy inspection.
- Added operation preview through MCP and REST so agents can dry-run a mutation, see target IDs, and inspect validation before saving.
- Upgraded `npm run cloud:safety` canaries with an optional editable primitive fixture behind `--include-primitives`.
- Added optional `--verify-exports` so written canary or backup boards can be read back, validated, and export-checked without touching active boards.
- Updated README and agent guidance so agents inspect hierarchy, validate after edits, and keep MCP ahead of raw object mutation.

## Live Canary

- Live canaries should stay compatible with the currently deployed runtime unless a branch-only fixture flag is explicitly intended.
- Created production-compatible canary `PowerBoard Canary - Codex hierarchy preview 2026-05-08`.
- Canary board id: `canary_board_ko8hi_aytqti`.
- Read-back validation passed with 0 errors and 0 warnings.
- Export verification wrote PNG, spec, and React/Tailwind exports to the canary board only.
- Production API read-back and backup dry-run against this canary both passed.

## Agent Notes

- Use `inspect_board_hierarchy` before broad MCP edits so parent/child paths are explicit.
- Use `preview_operation` before risky writes; it must not be treated as a saved edit.
- Use `validate_board` after edits and before export; warnings are useful quality signals, errors should be fixed before handoff.
- Use `npm run cloud:safety -- --mode=canary --verify-exports` for a dry-run plan.
- Use `npm run cloud:safety -- --mode=canary --write --verify-exports` only when cloud credentials are present and creating a clearly named safety board is intended.
- Use `--include-primitives` only when the target runtime already supports icon, line, and sparkline element types.

## Deferred

- Computed CSS inspection.
- Screenshot capture through MCP.
- JSX-per-selection inspection.
- Direct child reorder and layer-management MCP operations.
- Preview diff visualization in the browser UI.
- Production deploy.
