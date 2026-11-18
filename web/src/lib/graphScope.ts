import type { FileLevel, GitRepo, Graph } from "@core/types";
import { under } from "./rollup";

export interface ScopedNode {
  /** Absolute; a repo or folder node's id becomes the next scope. */
  id: string;
  /** Relative to the scope. */
  label: string;
  kind: "repo" | "dir" | "file";
  /** Code files inside (1 for a file). */
  files: number;
  /** Imports into this node from other nodes in view. */
  fanIn: number;
  fanOut: number;
  counts: Record<FileLevel, number>;
}

export interface ScopedEdge {
  from: string;
  to: string;
  /** How many file-to-file imports this arrow stands for. */
  weight: number;
}

export interface ScopedGraph {
  /** The scope actually shown: a scope with a single folder in it opens that folder instead. */
  scope: string;
  nodes: ScopedNode[];
  edges: ScopedEdge[];
  /** Imports that cross the scope boundary (left out of the picture). */
  outside: number;
}

/** A folder this small is shown as its files: drilling in for two files is a wasted click. */
export const LEAF_MAX = 8;

const empty = (): Record<FileLevel, number> => ({ new: 0, seen: 0, understood: 0, fading: 0, stale: 0 });

/**
 * The import graph at one scope: a git repo below the scope is one node, then each first-level
 * folder, then files directly in the scope. A folder with LEAF_MAX code files or fewer shows its
 * files instead. Edges between nodes are summed, so "these two packages talk a lot" is one thick
 * arrow, and a package's __init__ stops being a fake hub.
 */
export function graphAt(scope: string, g: Graph, repos: GitRepo[], levels: Map<string, FileLevel>): ScopedGraph {
  const inScope = g.nodes.map((n) => n.path).filter((p) => under(scope, p));
  const below = repos.filter((r) => under(scope, r.path));
  const group = (p: string) => {
    const repo = below.find((r) => under(r.path, p));
    if (repo) return { key: repo.path, kind: "repo" as const };
    const rest = p.slice(scope.length + 1);
    const cut = rest.indexOf("/");
    return cut < 0 ? { key: p, kind: "file" as const } : { key: `${scope}/${rest.slice(0, cut)}`, kind: "dir" as const };
  };
  const size = new Map<string, number>();
  for (const p of inScope) {
    const { key } = group(p);
    size.set(key, (size.get(key) ?? 0) + 1);
  }
  // One folder (or repo) holding everything: open it rather than show a single dot.
  if (size.size === 1) {
    const [only] = size.keys();
    if (!inScope.includes(only) && only !== scope) return graphAt(only, g, repos, levels);
  }
  const keyOf = new Map<string, { key: string; kind: ScopedNode["kind"] }>();
  for (const p of inScope) {
    const k = group(p);
    keyOf.set(p, k.kind === "dir" && (size.get(k.key) ?? 0) <= LEAF_MAX ? { key: p, kind: "file" } : k);
  }
  const nodes = new Map<string, ScopedNode>();
  for (const [p, { key, kind }] of keyOf) {
    let n = nodes.get(key);
    if (!n) nodes.set(key, (n = { id: key, label: key.slice(scope.length + 1), kind, files: 0, fanIn: 0, fanOut: 0, counts: empty() }));
    n.files++;
    n.counts[levels.get(p) ?? "new"]++;
  }
  const edges = new Map<string, ScopedEdge>();
  let outside = 0;
  for (const e of g.edges) {
    const a = keyOf.get(e.from)?.key;
    const b = keyOf.get(e.to)?.key;
    if (!a && !b) continue;
    if (!a || !b) {
      outside++;
      continue;
    }
    if (a === b) continue;
    const id = `${a}\0${b}`;
    const edge = edges.get(id) ?? { from: a, to: b, weight: 0 };
    edge.weight++;
    edges.set(id, edge);
  }
  for (const e of edges.values()) {
    nodes.get(e.to)!.fanIn += e.weight;
    nodes.get(e.from)!.fanOut += e.weight;
  }
  return { scope, nodes: [...nodes.values()], edges: [...edges.values()], outside };
}
