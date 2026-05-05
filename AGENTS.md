# Paper.Design.Danny Agent Brief

## Active Goal
Build Paper.Design.Danny into a polished local-first, agent-first design tool for creating high-fidelity app mockups.

This app is not trying to be a generic Figma clone. It should become a practical workspace where Danny and Codex can design, inspect, iterate, export, and eventually cloud-sync detailed app screens with semantic object structure.

## Product Priorities
- Make canvas interactions feel excellent: smooth cursor-centered zoom, trackpad pan, selection, dragging, resizing, grouping, hierarchy, and undo/redo.
- Make every visible UI control work clearly with useful empty states, disabled states, or status feedback.
- Ensure every object and artboard has a name, identifier, semantic role, and inspectable hierarchy path.
- Keep React + Tailwind export readable, implementation-ready, and aligned with the semantic board model.
- Support screenshot-assisted tracing: imported screenshots should act as locked overlays that can be recreated with editable semantic objects.
- Prepare cloud save architecture without breaking local file mode.
- Keep MCP and agent control first-class. Browser edits and agent edits should go through the same operation model.

## Definition Of Done
- Browser-tested interactions.
- No browser console errors.
- `npm run typecheck`, `npm run build`, and `npm test` pass when code changes warrant them.
- PNG, spec, and React/Tailwind exports are tested when export behavior changes.
- Meaningful changes are committed and pushed.

## Local Workspace
- Web app: `http://127.0.0.1:5173`
- Local server: `http://127.0.0.1:4318`
- Boards live in `boards/<boardId>/board.json`.
- Uploaded board assets live in `boards/<boardId>/assets/`.
- Generated exports live in `boards/<boardId>/exports/`.

## Collaboration Notes
- Preserve live board edits unless Danny explicitly asks to reset or discard them.
- Prefer small, verified improvements over speculative rewrites.
- When touching canvas interactions, verify the actual browser behavior, not only the math.
- When adding features, keep the UI direct and tool-like: no landing page, no marketing copy, no decorative noise.
