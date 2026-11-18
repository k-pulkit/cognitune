import { expect, it } from "vitest";
import type { Graph } from "../src/core/types";
import { graphAt, LEAF_MAX } from "../web/src/lib/graphScope";

const R = "/w";
const big = Array.from({ length: LEAF_MAX + 2 }, (_, i) => `${R}/app/core/contracts/m${i}.py`);
const g: Graph = {
  nodes: [
    ...big,
    `${R}/app/core/contracts/__init__.py`,
    `${R}/app/cli/main.py`,
    `${R}/app/cli/opts.py`,
    `${R}/lib/util.ts`,
  ].map((path) => ({ path, fanIn: 0, fanOut: 0 })),
  edges: [
    // Every module imports the package; the cli imports it twice.
    ...big.map((m) => ({ from: m, to: `${R}/app/core/contracts/__init__.py` })),
    { from: `${R}/app/cli/main.py`, to: `${R}/app/core/contracts/__init__.py` },
    { from: `${R}/app/cli/opts.py`, to: `${R}/app/core/contracts/m0.py` },
    { from: `${R}/app/cli/main.py`, to: `${R}/app/cli/opts.py` },
    { from: `${R}/lib/util.ts`, to: `${R}/app/cli/main.py` },
  ],
};
const repos = [
  { path: `${R}/app`, name: "app", branch: "main" },
  { path: `${R}/lib`, name: "lib", branch: "main" },
];

it("at the root, each repo is a node and imports between them are one weighted arrow", () => {
  const s = graphAt(R, g, repos, new Map());
  expect(s.nodes.map((n) => [n.kind, n.label, n.files]).sort()).toEqual([["repo", "app", LEAF_MAX + 5], ["repo", "lib", 1]]);
  expect(s.edges).toEqual([{ from: `${R}/lib`, to: `${R}/app`, weight: 1 }]);
});

it("inside a repo, a big folder is one node (its __init__ hub folds in) and a small folder shows its files", () => {
  const s = graphAt(`${R}/app`, g, repos, new Map());
  const byLabel = Object.fromEntries(s.nodes.map((n) => [n.label, n]));
  expect(Object.keys(byLabel).sort()).toEqual(["cli/main.py", "cli/opts.py", "core"]);
  expect(byLabel.core.kind).toBe("dir");
  expect(byLabel.core.files).toBe(LEAF_MAX + 3);
  // Both cli files import core; the modules importing __init__ inside core vanish as self-edges.
  expect(byLabel.core.fanIn).toBe(2);
  expect(s.outside).toBe(1); // lib/util.ts -> cli/main.py crosses the scope
});

it("a scope holding a single folder opens that folder instead of showing one dot", () => {
  const s = graphAt(`${R}/app/core`, g, repos, new Map());
  expect(s.scope).toBe(`${R}/app/core/contracts`);
  expect(s.nodes.every((n) => n.kind === "file")).toBe(true);
});
