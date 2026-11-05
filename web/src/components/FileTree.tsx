import { useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronRight, File, FileCode2, FileText, Folder, FolderOpen, Search } from "lucide-react";
import type { FileLevel, TreeNode } from "@core/types";

const CODE = /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|kt|rb|php|cs|c|h|cpp|swift|scala|sh|sql|vue|svelte|lua|dart|ex)$/i;
const TEXT = /\.(md|txt|rst|json|ya?ml|toml|ini|cfg)$/i;

function filesUnder(n: TreeNode): string[] {
  return n.kind === "file" ? [n.path] : (n.children ?? []).flatMap(filesUnder);
}

function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  if (!q) return nodes;
  const ql = q.toLowerCase();
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.kind === "file") {
      if (n.path.toLowerCase().includes(ql)) out.push(n);
    } else {
      const kids = filterTree(n.children ?? [], q);
      if (kids.length) out.push({ ...n, children: kids });
    }
  }
  return out;
}

const LEVEL_DOT: Record<FileLevel, string> = {
  new: "",
  seen: "bg-muted/50",
  understood: "bg-good",
  stale: "bg-warn",
};

/**
 * File tree with tick boxes. Ticking a folder ticks every file under it. Roots start open;
 * the filter opens every folder that has a match.
 */
export function FileTree({
  roots, selected, onToggle, openFile, onOpen, levels, meta, openAll = false,
}: {
  roots: TreeNode[];
  selected: string[];
  onToggle: (paths: string[], on: boolean) => void;
  openFile: string | null;
  onOpen: (path: string) => void;
  levels?: Map<string, FileLevel>;
  /** Extra content at the end of a file row (e.g. diff status and line counts). */
  meta?: (path: string) => ReactNode;
  /** Start with every folder open (a diff), instead of only the roots (a whole repo). */
  openAll?: boolean;
}) {
  const [q, setQ] = useState("");
  // Track the folders the user toggled; their meaning flips with openAll.
  const [toggled, setToggled] = useState<Set<string>>(() => (openAll ? new Set() : new Set(roots.map((r) => r.path))));
  const sel = useMemo(() => new Set(selected), [selected]);
  const shown = useMemo(() => filterTree(roots, q.trim()), [roots, q]);

  const row = (n: TreeNode, depth: number) => {
    const isOpen = q ? true : openAll ? !toggled.has(n.path) : toggled.has(n.path);
    const files = n.kind === "dir" ? filesUnder(n) : [n.path];
    const ticked = files.filter((f) => sel.has(f)).length;
    const all = ticked > 0 && ticked === files.length;
    const some = ticked > 0 && !all;
    const level = levels?.get(n.path);
    const Icon = n.kind === "dir" ? (isOpen ? FolderOpen : Folder) : CODE.test(n.name) ? FileCode2 : TEXT.test(n.name) ? FileText : File;
    return (
      <div key={n.path}>
        <div
          className={clsx(
            "group flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-2 text-[13px] transition",
            openFile === n.path ? "bg-accent/12 text-ink" : "text-ink/85 hover:bg-raised",
          )}
          style={{ paddingLeft: depth * 14 + 4 }}
          onClick={() => {
            if (n.kind === "dir") setToggled((s) => {
              const next = new Set(s);
              if (next.has(n.path)) next.delete(n.path); else next.add(n.path);
              return next;
            });
            else onOpen(n.path);
          }}
        >
          <ChevronRight className={clsx("h-3.5 w-3.5 shrink-0 text-muted transition", n.kind === "file" && "invisible", isOpen && "rotate-90")} />
          <input
            type="checkbox"
            className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[rgb(var(--accent))]"
            checked={all}
            ref={(el) => {
              if (el) el.indeterminate = some;
            }}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggle(files, !all)}
            title={n.kind === "dir" ? `Tick all ${files.length} files` : "Use as context"}
          />
          <Icon className={clsx("h-4 w-4 shrink-0", n.kind === "dir" ? "text-accent/80" : "text-muted")} />
          <span className="truncate">{n.name}</span>
          {level && level !== "new" && <span title={level} className={clsx("ml-auto h-1.5 w-1.5 shrink-0 rounded-full", LEVEL_DOT[level])} />}
          {meta && n.kind === "file" && <span className="ml-auto flex shrink-0 items-center gap-1.5">{meta(n.path)}</span>}
        </div>
        {n.kind === "dir" && isOpen && n.children?.map((c) => row(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
          <input className="input h-8 pl-8 text-[13px]" placeholder="Filter files" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-4">{shown.map((r) => row(r, 0))}</div>
    </div>
  );
}
