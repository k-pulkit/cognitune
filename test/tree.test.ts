import { expect, it } from "vitest";
import { treeFromPaths } from "../web/src/lib/tree";

it("treeFromPaths nests files, folds single-folder chains, sorts folders first", () => {
  const r = "/repo";
  const tree = treeFromPaths(r, [
    "/repo/packages/castellum_next/src/a.py",
    "/repo/packages/castellum_next/src/b.py",
    "/repo/README.md",
    "/repo/web/x.ts",
    "/repo/web/lib/y.ts",
  ]);
  const names = (n: { name: string; children?: unknown[] }[]): unknown =>
    n.map((x) => (x.children ? { [x.name]: names(x.children as never) } : x.name));
  expect(names(tree)).toEqual([
    { "packages/castellum_next/src": ["a.py", "b.py"] },
    { web: [{ lib: ["y.ts"] }, "x.ts"] },
    "README.md",
  ]);
  expect(tree[0].path).toBe("/repo/packages/castellum_next/src");
});
