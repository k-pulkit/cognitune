import type { TreeNode } from "@core/types";

/**
 * Build a file tree from absolute paths under `root`. Folders with a single sub-folder and no
 * files are merged into one row ("packages/castellum_next/src"), like VS Code's compact folders,
 * so deep paths stay short.
 */
export function treeFromPaths(root: string, paths: string[]): TreeNode[] {
  const top: TreeNode = { name: "", path: root, kind: "dir", children: [] };
  for (const abs of paths) {
    if (!abs.startsWith(root + "/")) continue;
    const parts = abs.slice(root.length + 1).split("/");
    let node = top;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      node.children ??= [];
      let child = node.children.find((c) => c.name === part && c.kind === (isFile ? "file" : "dir"));
      if (!child) {
        child = { name: part, path: `${node.path}/${part}`, kind: isFile ? "file" : "dir", ...(isFile ? {} : { children: [] }) };
        node.children.push(child);
      }
      node = child;
    });
  }
  const tidy = (n: TreeNode): TreeNode => {
    if (n.kind === "file") return n;
    let cur = n;
    while (cur.children?.length === 1 && cur.children[0].kind === "dir") {
      const only = cur.children[0];
      cur = { ...only, name: `${cur.name}/${only.name}` };
    }
    const kids = (cur.children ?? []).map(tidy);
    kids.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
    return { ...cur, children: kids };
  };
  return (tidy(top).children ?? []).map((c) => (c.name.startsWith("/") ? { ...c, name: c.name.slice(1) } : c));
}
