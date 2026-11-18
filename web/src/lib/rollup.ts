import type { FileLevel, FileProgress, GitRepo } from "@core/types";

export interface Rollup {
  /** Absolute; a repo or folder row's path becomes the next scope. */
  path: string;
  /** Relative to the scope it was rolled up in. */
  label: string;
  kind: "repo" | "dir" | "file";
  /** Every file below, touched or not. */
  total: number;
  /** Per level; `new` = not touched yet. */
  counts: Record<FileLevel, number>;
  lastRetrieval: string | null;
  /** File rows only (undefined when the file is untouched). */
  file?: FileProgress;
}

const empty = (): Record<FileLevel, number> => ({ new: 0, seen: 0, understood: 0, fading: 0, stale: 0 });

export const touched = (r: Pick<Rollup, "total" | "counts">) => r.total - r.counts.new;

export const under = (scope: string, f: string) => f.startsWith(scope.endsWith("/") ? scope : `${scope}/`);

/**
 * The direct children of `scope`, each with the levels of every file below it. A git repo below
 * the scope is one row (so a multi-repo workspace reads repo by repo); otherwise rows are the first
 * folder level, then the files directly in the scope. A folder chain with one child is shown as one
 * row ("packages/my_app").
 */
export function rollup(scope: string, files: string[], progress: Map<string, FileProgress>, repos: GitRepo[]): Rollup[] {
  const inScope = files.filter((f) => under(scope, f));
  const below = repos.filter((r) => under(scope, r.path));
  const groups = new Map<string, Rollup>();
  for (const f of inScope) {
    const repo = below.find((r) => under(r.path, f));
    const rest = f.slice(scope.length + 1);
    const cut = rest.indexOf("/");
    const key = repo ? repo.path : cut < 0 ? f : `${scope}/${rest.slice(0, cut)}`;
    let g = groups.get(key);
    if (!g) {
      g = { path: key, label: key.slice(scope.length + 1), kind: repo ? "repo" : key === f ? "file" : "dir", total: 0, counts: empty(), lastRetrieval: null };
      groups.set(key, g);
    }
    const fp = progress.get(f);
    g.total++;
    g.counts[fp?.level ?? "new"]++;
    if (fp?.lastRetrieval && (!g.lastRetrieval || fp.lastRetrieval > g.lastRetrieval)) g.lastRetrieval = fp.lastRetrieval;
    if (g.kind === "file") g.file = fp;
  }
  const rows = [...groups.values()];
  for (const r of rows) {
    if (r.kind !== "dir") continue;
    // Merge a folder whose only content is one subfolder into a single row.
    for (;;) {
      const sub = rollup(r.path, inScope, progress, []);
      if (sub.length !== 1 || sub[0].kind !== "dir") break;
      r.path = sub[0].path;
      r.label = r.path.slice(scope.length + 1);
    }
  }
  return rows.sort(
    (a, b) => (a.kind === "file" ? 1 : 0) - (b.kind === "file" ? 1 : 0) || touched(b) - touched(a) || a.label.localeCompare(b.label),
  );
}
