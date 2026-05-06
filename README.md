# Paper.Design.Danny

Paper.Design.Danny is a local, agent-first design canvas for detailed app mockups.

V0 runs as a browser app plus a local Node server. Board projects are stored as local JSON files under `boards/`, and Codex or other agents can edit those projects through MCP tools.

See `AGENTS.md` for the active product goal, priorities, and verification checklist.

## Commands

- `npm install`
- `npm run dev`
- `npm run build`
- `npm test`
- `npm run mcp`

The web app runs on `http://127.0.0.1:5173` and the local server runs on `http://127.0.0.1:4318`.

## Vercel

Deploy from the repository root, not from `apps/server`. The root `vercel.json` builds the Vite web app with:

- Build command: `npm run build --workspace @board/schema && npm run build --workspace @board/web`
- Output directory: `apps/web/dist`

On Vercel, the app falls back to browser-local board storage until cloud persistence is added. The local Node/MCP server remains for local development and agent control.
