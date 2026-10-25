import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Builds the browser UI into ui-dist, served by the Worker's static assets. */
export default defineConfig({
  root: fileURLToPath(new URL("src/ui", import.meta.url)),
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL("ui-dist", import.meta.url)), emptyOutDir: true },
});
