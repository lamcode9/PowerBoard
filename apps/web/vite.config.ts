import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4318",
      "/boards": "http://127.0.0.1:4318"
    }
  },
  resolve: {
    alias: {
      "@powerboard/schema": path.resolve(here, "../../packages/schema/src/index.ts")
    }
  }
});
