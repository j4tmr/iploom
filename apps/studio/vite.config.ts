import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(import.meta.dirname),
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5188,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 5188,
    strictPort: true,
  },
  build: {
    outDir: resolve(import.meta.dirname, "../../dist-studio/renderer"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
