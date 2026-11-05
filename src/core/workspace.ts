import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep, basename } from "node:path";
import { importGraph } from "./graph.js";
import type { DiffFile, DiffSpec, FileContent, GitRepo, Graph, Project, TreeNode } from "./types.js";

/** Read-only view of a project's folders: tree, files, git. */

const SKIP_DIRS = new Set([
  ".git", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
  "dist", "build", "out", "target", ".next", ".turbo", ".cache", "cdk.out", ".idea", ".tox", "coverage",
]);
const MAX_FILE_BYTES = 400_000;
/** git's well-known id of the empty tree. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
/** How deep to look for nested git repos under a folder that is not one. */
const REPO_SCAN_DEPTH = 4;
const MAX_TREE_FILES = 20_000;

const LANGS: Record<string, string> = {
  ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "jsx", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".go": "go", ".rs": "rust", ".java": "java", ".kt": "kotlin", ".rb": "ruby", ".php": "php",
  ".cs": "csharp", ".c": "c", ".h": "c", ".cpp": "cpp", ".hpp": "cpp", ".swift": "swift", ".scala": "scala",
  ".sh": "bash", ".zsh": "bash", ".bash": "bash", ".sql": "sql", ".json": "json", ".yaml": "yaml", ".yml": "yaml",
  ".toml": "toml", ".md": "markdown", ".html": "html", ".css": "css", ".scss": "scss", ".vue": "vue",
  ".svelte": "svelte", ".tf": "hcl", ".hcl": "hcl", ".xml": "xml", ".ini": "ini", ".dockerfile": "docker",
  ".lua": "lua", ".r": "r", ".dart": "dart", ".ex": "elixir", ".exs": "elixir", ".jinja": "jinja", ".j2": "jinja",
};

export function langOf(path: string): string {
  const name = basename(path).toLowerCase();
  if (name === "dockerfile") return "docker";
  if (name === "makefile") return "make";
  return LANGS[extname(name)] ?? "text";
}

export function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
}

export function isGitRepo(dir: string): boolean {
  try {
    return git(dir, ["rev-parse", "--is-inside-work-tree"]).trim() === "true";
  } catch {
    return false;
  }
}

export class Workspace {
  constructor(readonly project: Project) {}

  get roots(): string[] {
    return [this.project.root, ...this.project.contexts];
  }

  /** Throw unless `path` is inside one of the project's folders. Returns the absolute path. */
  guard(path: string): string {
    const abs = resolve(path);
    const ok = this.roots.some((r) => abs === r || abs.startsWith(r.endsWith(sep) ? r : r + sep));
    if (!ok) throw new Error(`outside the project: ${path}`);
    return abs;
  }

  rel(path: string): string {
    const abs = resolve(path);
    for (const r of this.roots) {
      if (abs.startsWith(r + sep)) {
        const inner = relative(r, abs);
        return r === this.project.root ? inner : `${basename(r)}/${inner}`;
      }
    }
    return abs;
  }

  /** Inverse of rel(): a path the model wrote back to an absolute one, or undefined if unknown. */
  absFromRel(rel: string | undefined): string | undefined {
    if (!rel) return undefined;
    const clean = rel.replace(/^\.\//, "");
    const candidates = [join(this.project.root, clean)];
    for (const c of this.project.contexts) {
      const name = basename(c);
      if (clean.startsWith(name + "/")) candidates.push(join(c, clean.slice(name.length + 1)));
    }
    if (clean.startsWith("/")) candidates.unshift(clean);
    for (const c of candidates) {
      try {
        if (statSync(this.guard(c)).isFile()) return c;
      } catch {
        /* next */
      }
    }
    return undefined;
  }

  // ---- tree ------------------------------------------------------------

  tree(): TreeNode[] {
    return this.roots.filter((r) => existsSync(r)).map((r) => ({
      name: r === this.project.root ? this.project.name : basename(r),
      path: r,
      kind: "dir" as const,
      children: buildTree(r, listFiles(r)),
    }));
  }

  /** Every file in the main folder, absolute paths. */
  files(): string[] {
    const r = this.project.root;
    return existsSync(r) ? listFiles(r).map((f) => join(r, f)) : [];
  }

  graph(): Graph {
    return importGraph(this.project.root, this.files());
  }

  /**
   * The file's recent git history with patches, newest first, cut to `maxBytes`.
   * Throws when the file is not in a git repo.
   */
  history(path: string, maxBytes: number): string {
    const abs = this.guard(path);
    const dir = dirname(abs);
    if (!isGitRepo(dir)) throw new Error("the history lens needs a file inside a git repo");
    const out = git(dir, ["log", "--follow", "-n", "15", "-p", "--format=--- commit %h, %an, %cr%n%s%n%n%b", "--", abs]);
    if (!out.trim()) throw new Error("this file has no commits yet");
    return out.length > maxBytes ? `${out.slice(0, maxBytes)}\n(older history cut)` : out;
  }

  // ---- files -----------------------------------------------------------

  read(path: string): FileContent {
    const abs = this.guard(path);
    const st = statSync(abs);
    if (!st.isFile()) throw new Error("not a file");
    const buf = readFileSync(abs);
    const truncated = buf.length > MAX_FILE_BYTES;
    const slice = truncated ? buf.subarray(0, MAX_FILE_BYTES) : buf;
    const text = slice.includes(0) ? "(binary file)" : slice.toString("utf8");
    return { path: abs, rel: this.rel(abs), lang: langOf(abs), text, hash: hashText(text), truncated };
  }

  hash(path: string): string | null {
    try {
      return this.read(path).hash;
    } catch {
      return null;
    }
  }

  /**
   * Files with line numbers, for a prompt. Stops at `maxBytes` and says which files were cut,
   * so the model knows it did not see everything.
   */
  bundle(paths: string[], maxBytes: number): string {
    const parts: string[] = [];
    let used = 0;
    const cut: string[] = [];
    for (const p of paths) {
      let f: FileContent;
      try {
        f = this.read(p);
      } catch {
        continue;
      }
      const numbered = f.text.split("\n").map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join("\n");
      const block = `=== FILE ${f.rel} (${f.lang}) ===\n${numbered}\n`;
      if (used + block.length > maxBytes) {
        cut.push(f.rel);
        continue;
      }
      used += block.length;
      parts.push(block);
    }
    if (cut.length) parts.push(`(Not included, too large for one prompt: ${cut.join(", ")})`);
    return parts.join("\n");
  }

  // ---- git -------------------------------------------------------------

  /**
   * Git repos in the project: a folder that is itself in a repo counts as one; otherwise
   * sub-folders are scanned (up to REPO_SCAN_DEPTH levels, not inside a found repo), so a
   * workspace folder that holds many repos lists each of them.
   */
  repos(): GitRepo[] {
    const found: string[] = [];
    const scan = (dir: string, depth: number) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        const p = join(dir, e.name);
        if (existsSync(join(p, ".git"))) found.push(p);
        else if (depth < REPO_SCAN_DEPTH) scan(p, depth + 1);
      }
    };
    for (const r of this.roots) {
      if (!existsSync(r)) continue;
      if (isGitRepo(r)) found.push(r);
      else scan(r, 1);
    }
    return found.map((path) => {
      let branch = "";
      try {
        branch = git(path, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
      } catch {
        /* no commits yet */
      }
      const name = path === this.project.root ? this.project.name : this.project.contexts.includes(path) ? basename(path) : this.rel(path);
      return { path, name, branch };
    });
  }

  /** The repo folder for a request: the given one (checked), or the project root. */
  private repo(path?: string): string | null {
    const dir = path ? this.guard(path) : this.project.root;
    return isGitRepo(dir) ? dir : null;
  }

  refs(repoPath?: string): { branches: string[]; commits: { sha: string; subject: string; when: string }[]; current: string } {
    const root = this.repo(repoPath);
    if (!root) return { branches: [], commits: [], current: "" };
    let current = "";
    try {
      current = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    } catch {
      /* repo with no commits */
    }
    let branches: string[] = [];
    let commits: { sha: string; subject: string; when: string }[] = [];
    try {
      branches = git(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"])
        .split("\n").filter(Boolean).filter((b) => !b.endsWith("/HEAD"));
      commits = git(root, ["log", "-30", "--format=%h%x09%s%x09%cr"]).split("\n").filter(Boolean).map((l) => {
        const [sha, subject, when] = l.split("\t");
        return { sha, subject, when };
      });
    } catch {
      /* repo with no commits */
    }
    return { branches, commits, current };
  }

  /**
   * A ref git can diff. HEAD in a repo with no commits becomes the empty tree, so a new repo
   * shows all its files as added.
   */
  private resolveRef(root: string, ref: string): string {
    if (!/^[\w./~^@{}-]+$/.test(ref) || ref.startsWith("-")) throw new Error(`bad ref: ${ref}`);
    try {
      git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
      return ref;
    } catch {
      if (ref === "HEAD") return EMPTY_TREE;
      throw new Error(`bad ref: ${ref} is not a commit`);
    }
  }

  /**
   * Changed files between `base` and `head` (empty head = working tree, untracked files included).
   * `--relative` keeps paths relative to the folder, also when it sits inside a bigger repo.
   */
  diff(spec: DiffSpec): DiffFile[] {
    const root = this.repo(spec.repo);
    if (!root) return [];
    const range = (spec.head ? [spec.base, spec.head] : [spec.base]).map((r) => this.resolveRef(root, r));
    const files: DiffFile[] = [];
    const numstat = git(root, ["diff", "--relative", "--numstat", "-M", ...range, "--"]).split("\n").filter(Boolean);
    const status = new Map<string, string>();
    for (const l of git(root, ["diff", "--relative", "--name-status", "-M", ...range, "--"]).split("\n").filter(Boolean)) {
      const parts = l.split("\t");
      status.set(parts[parts.length - 1], parts[0][0]);
    }
    for (const l of numstat) {
      const [add, del, ...rest] = l.split("\t");
      let path = rest.join("\t");
      // numstat writes renames as "dir/{old => new}" or "old => new"
      if (path.includes(" => ")) path = path.replace(/\{[^}]* => ([^}]*)\}/, "$1").replace(/^.* => /, "");
      const s = status.get(path) ?? "M";
      const patch = git(root, ["diff", "--relative", "-M", ...range, "--", path]);
      files.push({
        path: join(root, path),
        status: s === "A" ? "added" : s === "D" ? "deleted" : s === "R" ? "renamed" : "modified",
        additions: Number(add) || 0,
        deletions: Number(del) || 0,
        patch,
      });
    }
    if (!spec.head) {
      const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
      for (const rel of untracked.slice(0, 200)) {
        const abs = join(root, rel);
        let text = "";
        try {
          text = this.read(abs).text;
        } catch {
          continue;
        }
        const lines = text.split("\n");
        const patch = `--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => "+" + l).join("\n")}`;
        files.push({ path: abs, status: "added", additions: lines.length, deletions: 0, patch });
      }
    }
    return files;
  }
}

/** Files under `root`, relative paths. Uses git when it can (respects .gitignore), else walks. */
export function listFiles(root: string): string[] {
  if (isGitRepo(root)) {
    try {
      const out = git(root, ["ls-files", "--cached", "--others", "--exclude-standard"]);
      return out.split("\n").filter(Boolean).filter((p) => existsSync(join(root, p))).slice(0, MAX_TREE_FILES);
    } catch {
      /* fall through */
    }
  }
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= MAX_TREE_FILES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".github") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
      } else if (e.isFile()) out.push(relative(root, p));
    }
  };
  walk(root);
  return out;
}

export function buildTree(root: string, files: string[]): TreeNode[] {
  const top: TreeNode = { name: "", path: root, kind: "dir", children: [] };
  for (const rel of files) {
    const parts = rel.split("/");
    let node = top;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      node.children ??= [];
      let child = node.children.find((c) => c.name === part && c.kind === (isFile ? "file" : "dir"));
      if (!child) {
        child = { name: part, path: join(node.path, part), kind: isFile ? "file" : "dir" };
        if (!isFile) child.children = [];
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (n: TreeNode) => {
    n.children?.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
    n.children?.forEach(sort);
  };
  sort(top);
  return top.children ?? [];
}

/** Sub-folders of `dir`, for the folder picker. */
export function browse(dir: string): { path: string; parent: string | null; dirs: string[]; isGit: boolean } {
  const abs = resolve(dir);
  const dirs = readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  const parent = resolve(abs, "..");
  return { path: abs, parent: parent === abs ? null : parent, dirs, isGit: existsSync(join(abs, ".git")) };
}
