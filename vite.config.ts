import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: "web",
  plugins: [react()],
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@": fileURLToPath(new URL("./web/src", import.meta.url)),
    },
  },
  build: { outDir: "../dist/web", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:4711" } },
});
