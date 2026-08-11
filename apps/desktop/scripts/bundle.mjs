// Bundles the PowerBoard server into a single ESM file and stages the built web app,
// so the packaged Electron app ships dist/server.js + dist/web with only sharp/pg as
// real node_modules. Run `npm run build` at the repo root first (schema/renderers/web).
import { build } from "esbuild";
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const webDist = path.join(repoRoot, "apps/web/dist");

if (!existsSync(webDist)) {
  console.error("apps/web/dist not found — run `npm run build` at the repo root first.");
  process.exit(1);
}

await build({
  entryPoints: [path.join(repoRoot, "apps/server/src/index.ts")],
  outfile: path.join(desktopRoot, "dist/server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // sharp/pg stay real node_modules (native + dynamic requires); bufferutil and
  // utf-8-validate are ws optionals resolved inside try/catch at runtime.
  external: ["sharp", "pg", "pg-native", "bufferutil", "utf-8-validate"],
  banner: {
    js: "import { createRequire as __pbCreateRequire } from 'node:module'; const require = __pbCreateRequire(import.meta.url);"
  },
  logLevel: "info"
});

// The rasterizer worker ships as a sibling of dist/server.js, because that is where the bundled
// server looks for it (`new URL("./rasterizeWorker.mjs", import.meta.url)`). It is plain ESM and
// must stay unbundled — esbuild would inline it into server.js and there would be nothing to spawn.
cpSync(path.join(repoRoot, "apps/server/src/rasterizeWorker.mjs"), path.join(desktopRoot, "dist/rasterizeWorker.mjs"));

rmSync(path.join(desktopRoot, "dist/web"), { recursive: true, force: true });
cpSync(webDist, path.join(desktopRoot, "dist/web"), { recursive: true });
console.log("Bundled server + staged web dist.");
