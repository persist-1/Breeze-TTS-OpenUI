import { defineConfig } from "vite";
export default defineConfig({
  root: "apps/desktop",
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 4320,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:14321" },
  },
  build: { outDir: "../../build/renderer", emptyOutDir: true },
  esbuild: { jsx: "automatic" },
});
