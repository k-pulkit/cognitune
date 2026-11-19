import { cpSync } from "node:fs";
import { defineConfig } from "tsup";

// Run from the repo root after `npm run build` (dist/web must exist): `npm run build:ext`.
export default defineConfig([
  {
    // The extension itself. VS Code loads it with require(), so CommonJS; `vscode` is provided.
    entry: { extension: "extension/src/extension.ts" },
    format: ["cjs"],
    outExtension: () => ({ js: ".cjs" }),
    platform: "node",
    target: "node20",
    outDir: "extension/out",
    external: ["vscode"],
    clean: true,
  },
  {
    // The same server as the CLI, with every dependency bundled in: the .vsix has no node_modules.
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    outExtension: () => ({ js: ".mjs" }),
    platform: "node",
    target: "node20",
    outDir: "extension/server",
    noExternal: [/.*/],
    // Bundled CommonJS packages call require(); ESM has none, so make one.
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
    clean: true,
    // cli.ts serves the UI from ./web next to itself.
    onSuccess: async () => cpSync("dist/web", "extension/server/web", { recursive: true }),
  },
]);
