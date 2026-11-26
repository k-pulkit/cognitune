import { useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, File, FileCode2, FileText, Folder, FolderOpen, Search } from "lucide-react";
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
  fading: "bg-warn/50",
  stale: "bg-warn",
};

/**
 * File tree with tick boxes. Ticking a folder ticks every file under it. Roots start open;
 * the filter opens every folder that has a match. Buttons by the filter expand or collapse all folders,
 * or only the folders with ticked files when something is ticked.
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
  // A folder is open when `base` says so, flipped for the folders the user clicked. Expand all
  // and Collapse all just reset both, so folders that load later follow the same rule.
  const [base, setBase] = useState(openAll);
  const [toggled, setToggled] = useState<Set<string>>(() => (openAll ? new Set() : new Set(roots.map((r) => r.path))));
  const sel = useMemo(() => new Set(selected), [selected]);
  // Folders holding a ticked file. With a selection, the buttons act on these folders only.
  const selDirs = useMemo(() => {
    const out: string[] = [];
    const walk = (n: TreeNode): boolean => {
      if (n.kind === "file") return sel.has(n.path);
      let hit = false;
      for (const c of n.children ?? []) if (walk(c)) hit = true;
      if (hit) out.push(n.path);
      return hit;
    };
    roots.forEach(walk);
    return out;
  }, [roots, sel]);
  const setAll = (open: boolean) => {
    if (!selDirs.length) {
      setBase(open);
      setToggled(new Set());
      return;
    }
    // A folder is open when base differs from its toggled flag, so set the flag to match.
    setToggled((t) => {
      const next = new Set(t);
      for (const d of selDirs) if (open !== base) next.add(d); else next.delete(d);
      return next;
    });
  };
  const hasDirs = roots.some((r) => r.kind === "dir");
  const shown = useMemo(() => filterTree(roots, q.trim()), [roots, q]);

  const row = (n: TreeNode, depth: number) => {
    const isOpen = q ? true : base !== toggled.has(n.path);
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
            "group flex h-[22px] cursor-pointer items-center gap-1 pr-2 text-[13px]",
            openFile === n.path ? "bg-sel text-ink dark:text-white" : "hover:bg-raised",
          )}
          style={{ paddingLeft: depth * 12 + 8 }}
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
          <Icon className={clsx("h-4 w-4 shrink-0", "text-muted")} />
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
      <div className="flex items-center gap-1 px-2 py-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-[6px] h-3.5 w-3.5 text-muted" />
          <input className="input h-[26px] pl-7 text-[13px]" placeholder="Filter files" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {hasDirs && (
          <>
            <button className="rounded p-1 text-muted hover:bg-raised hover:text-ink" title={selDirs.length ? "Expand the folders with ticked files" : "Expand all folders"} onClick={() => setAll(true)}>
              <ChevronsUpDown className="h-3.5 w-3.5" />
            </button>
            <button className="rounded p-1 text-muted hover:bg-raised hover:text-ink" title={selDirs.length ? "Collapse the folders with ticked files" : "Collapse all folders"} onClick={() => setAll(false)}>
              <ChevronsDownUp className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-4">{shown.map((r) => row(r, 0))}</div>
    </div>
  );
}
