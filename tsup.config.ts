import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: false, // vite writes dist/web first; keep it
  banner: { js: "#!/usr/bin/env node" },
});
