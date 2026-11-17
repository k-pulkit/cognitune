/**
 * zsh-style short path: when a path is longer than `max`, every folder becomes its first
 * letter and the file name stays whole.
 *   services/billing-api/packages/my_app/pyproject.toml -> s/b/p/m/pyproject.toml
 * A leading dot is kept with the next letter (".github" -> ".g"), so hidden folders stay
 * recognisable. Show the full path in a tooltip next to it.
 */
export function shortPath(path: string, max = 36): string {
  if (path.length <= max) return path;
  const parts = path.split("/");
  const file = parts.pop() ?? "";
  const dirs = parts.map((d) => (d === "" ? "" : d.startsWith(".") ? d.slice(0, 2) : d[0]));
  return [...dirs, file].join("/");
}

/** Extension -> shiki bundled language id. Mirrors src/core/workspace.ts's langOf() (server-side, Node-only). */
const LANGS: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  py: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", rb: "ruby", php: "php",
  cs: "csharp", c: "c", h: "c", cpp: "cpp", hpp: "cpp", swift: "swift", scala: "scala",
  sh: "bash", zsh: "bash", bash: "bash", sql: "sql", json: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", md: "markdown", html: "html", css: "css", scss: "scss", vue: "vue",
  svelte: "svelte", tf: "hcl", hcl: "hcl", xml: "xml", ini: "ini",
  lua: "lua", r: "r", dart: "dart", ex: "elixir", exs: "elixir",
};

/** Best-effort language for a file path, for client-side syntax highlighting (e.g. the diff view). */
export function langOf(path: string): string {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  if (name === "dockerfile") return "docker";
  if (name === "makefile") return "make";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return LANGS[ext] ?? "text";
}
