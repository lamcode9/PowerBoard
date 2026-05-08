# Primitive Tools Batch Status

Date: 2026-05-08

Scope: second safe roadmap batch after the cloud/MCP safety foundation. This is not the full Paper.Design gap plan.

## Completed In This Batch

- Added first-class `icon`, `line`, and `sparkline` app-mockup primitives to the shared schema/preset model.
- Made the App Kit expose Icon, Line, and Sparkline so browser users and agents can create them through the normal operation path.
- Rendered the primitives on the canvas with editable semantic objects rather than image-only placeholders.
- Updated SVG/PNG export and React/Tailwind export for the primitives.
- Added schema, renderer, and PNG regression tests for primitive creation and export.

## Agent Notes

- Use `presetType: "icon"`, `presetType: "line"`, and `presetType: "sparkline"` through the MCP `add_element` tool for these primitives.
- For icons, prefer `props.materialIcon` with one of the supported names first: `add_circle`, `check_circle`, `close`, `search`, `home`, `settings`, `arrow_forward`, `trending_up`, `payments`, `credit_card`, `more_horiz`, `person`, or `account_circle`.
- For sparklines, set `props.values` to a numeric array and use `style.stroke` plus `style.strokeWidth` for visual weight.
- For lines, set `props.direction` to `horizontal`, `vertical`, `diagonal-up`, or `diagonal-down`.

## Deferred

- A full Material Symbols catalog or font-loader integration.
- Direct canvas drawing modes for line creation.
- Rich chart editing controls beyond the simple numeric values field.
- CSS-first auto-layout and constraints.
