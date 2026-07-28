import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

// The installed app runs its own server on 4318, so a dev stack started while PowerBoard.app is open
// silently proxies to the *shipped* build instead of the code you're editing. Point both this and
// VITE_POWERBOARD_WS_URL at another port to develop alongside it.
const serverTarget = process.env.POWERBOARD_SERVER_URL ?? "http://127.0.0.1:4318";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": serverTarget,
      "/boards": serverTarget
    }
  },
  resolve: {
    alias: {
      "@powerboard/schema": path.resolve(here, "../../packages/schema/src/index.ts")
    }
  }
});
