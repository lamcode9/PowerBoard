# Inspection Handoff Batch Status

Date: 2026-05-08

Scope: fourth safe roadmap batch after safety foundation, primitive tools, and canary/hierarchy validation. This is not the full Paper.Design gap plan.

## Completed In This Batch

- Added one-artboard React/Tailwind rendering for focused handoff without writing a full export package.
- Added selection inspection with hierarchy path, absolute frame, local frame, children, props, layout, and computed CSS-like style.
- Added selection handoff that returns selected artboard JSX and can optionally export PNGs for those selected artboards.
- Exposed `inspect_selection` and `export_selection_handoff` through MCP.
- Added local REST endpoints for selection inspection and selection handoff.
- Expanded MCP exposure checks to cover the new inspection and handoff tools.
- Updated agent guidance so agents inspect selection details before implementation handoff.

## Agent Notes

- Use `inspect_selection` when you need exact bounds, computed visual style, props, and hierarchy paths for selected nodes.
- Use `export_selection_handoff` when a selected artboard should become implementation-ready React/Tailwind JSX.
- Pass `includePng: true` to `export_selection_handoff` only when a visual export is needed; JSX handoff itself does not write export files.
- If nothing is selected, pass explicit selection ids instead of exporting the whole board by accident.

## Deferred

- Browser-side preview diff UI.
- Computed browser DOM styles from a live rendered export.
- MCP screenshot capture for arbitrary viewport regions.
- Per-selected-element JSX snippets smaller than an artboard component.
- Production deploy.
