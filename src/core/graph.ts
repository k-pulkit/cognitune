import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import type { Graph } from "./types.js";

/**
 * A static import graph for TS/JS and Python, from regexes and a small path resolver. No parser,
 * so it misses dynamic imports and path aliases; good enough to see which files everything
 * depends on. Imports of packages (not files in the folder) are left out.
 */

const JS_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const JS_RE = /(?:^|\n)\s*(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|[^\w.])(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const PY_FROM = /^\s*from\s+(\.*)([\w.]*)\s+import\s+([\w*, ()]+)/gm;
const PY_IMPORT = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm;
const MAX_FILE = 300_000;
const MAX_FILES = 6000;

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** A tsconfig "paths" entry: "@/*" -> ["<abs>/web/src/*"]. */
interface Alias {
  prefix: string;
  targets: string[];
  /** Folder of the tsconfig; its aliases apply to files under it first. */
  dir: string;
}

/** Read "paths" aliases from tsconfig.json files at the root and one folder down. */
function readAliases(root: string, files: string[]): Alias[] {
  const configs = files.filter((f) => {
    const rel = f.slice(root.length + 1);
    return /(^|\/)tsconfig[\w.-]*\.json$/.test(rel) && rel.split("/").length <= 2;
  });
  const out: Alias[] = [];
  for (const cfg of configs) {
    try {
      // tsconfig allows comments and trailing commas.
      const text = readFileSync(cfg, "utf8").replace(/\/\*[\s\S]*?\*\/|(^|[^:"])\/\/.*$/gm, "$1").replace(/,(\s*[}\]])/g, "$1");
      const co = (JSON.parse(text).compilerOptions ?? {}) as { baseUrl?: string; paths?: Record<string, string[]> };
      const base = resolve(dirname(cfg), co.baseUrl ?? ".");
      for (const [k, v] of Object.entries(co.paths ?? {})) {
        out.push({ prefix: k.replace(/\*$/, ""), targets: v.map((t) => resolve(base, t.replace(/\*$/, ""))), dir: dirname(cfg) });
      }
    } catch {
      /* not JSON we can read */
    }
  }
  // Longest prefix first, so "@core/" wins over "@/".
  return out.sort((a, b) => b.prefix.length - a.prefix.length);
}

function resolveJs(from: string, spec: string, known: Set<string>, aliases: Alias[] = []): string | null {
  if (!spec.startsWith(".")) {
    // The nearest tsconfig's aliases first (deepest folder that holds the file), then the others.
    const matching = aliases
      .filter((x) => x.prefix && spec.startsWith(x.prefix))
      .sort((a, b) => Number(from.startsWith(b.dir + "/")) * b.dir.length - Number(from.startsWith(a.dir + "/")) * a.dir.length);
    for (const a of matching) {
      for (const t of a.targets) {
        const hit = resolveJs(from, `./${relativeTo(from, join(t, spec.slice(a.prefix.length)))}`, known);
        if (hit) return hit;
      }
    }
    return null;
  }
  const base = resolve(dirname(from), spec);
  const tries = [base];
  // ESM TS writes "./x.js" for "./x.ts".
  const ext = extname(base);
  if (ext === ".js" || ext === ".mjs" || ext === ".jsx") for (const e of [".ts", ".tsx", ".mts"]) tries.push(base.slice(0, -ext.length) + e);
  for (const e of JS_EXT) tries.push(base + e);
  for (const e of JS_EXT) tries.push(join(base, `index${e}`));
  return tries.find((t) => known.has(t)) ?? null;
}

function relativeTo(from: string, to: string): string {
  return relative(dirname(from), to) || ".";
}

/** Python roots: the folder itself, plus any `src/` folder that holds packages. */
function pyRoots(root: string, files: string[]): string[] {
  const roots = new Set([root]);
  for (const f of files) {
    const m = /^(.*?\/src)\//.exec(f);
    if (m && f.endsWith(".py")) roots.add(m[1]);
  }
  return [...roots];
}

function resolvePyModule(mod: string, roots: string[], known: Set<string>): string | null {
  const rel = mod.split(".").join("/");
  for (const r of roots) {
    for (const t of [join(r, `${rel}.py`), join(r, rel, "__init__.py")]) if (known.has(t)) return t;
  }
  return null;
}

function pyImports(from: string, src: string, roots: string[], known: Set<string>): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(PY_FROM)) {
    const [, dots, mod, names] = m;
    if (dots) {
      let dir = dirname(from);
      for (let i = 1; i < dots.length; i++) dir = dirname(dir);
      const base = mod ? join(dir, ...mod.split(".")) : dir;
      const hit = [`${base}.py`, join(base, "__init__.py")].find((t) => known.has(t));
      if (hit) out.push(hit);
      // "from . import x" may import a sibling module x.
      for (const n of names.replace(/[()]/g, "").split(",").map((x) => x.trim().split(/\s+/)[0]).filter(Boolean)) {
        const sib = join(base, `${n}.py`);
        if (known.has(sib)) out.push(sib);
      }
    } else {
      const hit = resolvePyModule(mod, roots, known);
      if (hit) out.push(hit);
      for (const n of names.replace(/[()]/g, "").split(",").map((x) => x.trim().split(/\s+/)[0]).filter(Boolean)) {
        const sub = resolvePyModule(`${mod}.${n}`, roots, known);
        if (sub) out.push(sub);
      }
    }
  }
  for (const m of src.matchAll(PY_IMPORT)) {
    for (const mod of m[1].split(",").map((x) => x.trim().split(/\s+/)[0])) {
      const hit = resolvePyModule(mod, roots, known);
      if (hit) out.push(hit);
    }
  }
  return out;
}

/** `files` are absolute paths under `root`. */
export function importGraph(root: string, files: string[]): Graph {
  const list = files.filter((f) => /\.(m?[jt]sx?|cjs|mts|py)$/.test(f)).slice(0, MAX_FILES);
  const aliases = readAliases(root, files);
  const known = new Set(list);
  const roots = pyRoots(root, list);
  const edges = new Map<string, Set<string>>();
  for (const f of list) {
    if (!existsSync(f) || !isFile(f)) continue;
    let src: string;
    try {
      const buf = readFileSync(f);
      if (buf.length > MAX_FILE) continue;
      src = buf.toString("utf8");
    } catch {
      continue;
    }
    const to = new Set<string>();
    if (f.endsWith(".py")) {
      for (const t of pyImports(f, src, roots, known)) if (t !== f) to.add(t);
    } else {
      for (const m of src.matchAll(JS_RE)) {
        const t = resolveJs(f, m[1] ?? m[2] ?? m[3], known, aliases);
        if (t && t !== f) to.add(t);
      }
    }
    if (to.size) edges.set(f, to);
  }
  const fanIn = new Map<string, number>();
  for (const to of edges.values()) for (const t of to) fanIn.set(t, (fanIn.get(t) ?? 0) + 1);
  const used = new Set<string>();
  for (const [f, to] of edges) {
    used.add(f);
    for (const t of to) used.add(t);
  }
  return {
    nodes: [...used].map((path) => ({ path, fanIn: fanIn.get(path) ?? 0, fanOut: edges.get(path)?.size ?? 0 })),
    edges: [...edges].flatMap(([from, to]) => [...to].map((t) => ({ from, to: t }))),
  };
}
