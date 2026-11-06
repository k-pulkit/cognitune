import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { CornerDownLeft, File, FolderGit2, Search, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Project, TreeNode } from "@core/types";
import { get } from "@/lib/api";
import { Modal } from "./ui";

interface Item {
  id: string;
  label: string;
  hint?: string;
  group: "Go to" | "Do" | "Files" | "Projects";
  run: () => void;
}

const ICON = { "Go to": Zap, Do: Zap, Files: File, Projects: FolderGit2 };

function flat(nodes: TreeNode[], root: string): { path: string; rel: string }[] {
  return nodes.flatMap((n) => (n.kind === "file" ? [{ path: n.path, rel: n.path.startsWith(root + "/") ? n.path.slice(root.length + 1) : n.path }] : flat(n.children ?? [], root)));
}

/**
 * Ctrl/Cmd+K: jump to a page, a file or a project, or start an activity on the open file.
 * Typing filters on every word; up/down and Enter pick.
 */
export function Palette({ pid, root, onClose, openFile }: { pid?: string; root?: string; onClose: () => void; openFile?: (path: string, activity?: string) => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const tree = useQuery({ queryKey: ["tree-flat", pid], queryFn: () => get<TreeNode[]>(`/projects/${pid}/tree`), enabled: !!pid, staleTime: 60_000 });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => get<Project[]>("/projects") });

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => nav(to);
    const out: Item[] = [];
    if (pid) {
      const p = `/p/${pid}`;
      for (const [label, to] of [["Today", "today"], ["Explore", "explore"], ["Changes", "changes"], ["Review cards", "review"], ["Map", "map"], ["Learning paths", "paths"], ["Library", "library"], ["Progress", "progress"]]) {
        out.push({ id: `go-${to}`, label, group: "Go to", run: go(`${p}/${to}`) });
      }
      for (const [label, act] of [["Lens on the open file", "lens"], ["Quiz me on the open file", "quiz"], ["Teach it back", "teach"], ["Ask the tutor", "tutor"], ["Walk through the open file", "walk"], ["Practice on the open file", "practice"], ["Bug hunt in the open file", "hunt"], ["Notes on the open file", "notes"]]) {
        out.push({ id: `do-${act}`, label, group: "Do", run: go(`${p}/explore?do=${act}`) });
      }
      if (tree.data && root) {
        for (const f of flat(tree.data, root)) out.push({ id: `f-${f.path}`, label: f.rel, group: "Files", run: () => openFile?.(f.path) });
      }
    }
    out.push({ id: "go-help", label: "Help (Ctrl H)", group: "Go to", run: go("/help") });
    out.push({ id: "go-settings", label: "Settings", group: "Go to", run: go("/settings") });
    for (const pr of projects.data ?? []) out.push({ id: `p-${pr.id}`, label: pr.name, hint: pr.root, group: "Projects", run: go(`/p/${pr.id}/today`) });
    return out;
  }, [pid, root, tree.data, projects.data, nav, openFile]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = words.length ? items.filter((i) => words.every((w) => `${i.label} ${i.hint ?? ""} ${i.group}`.toLowerCase().includes(w))) : items.filter((i) => i.group !== "Files");
    return hits.slice(0, 60);
  }, [items, q]);

  useEffect(() => {
    setAt(0);
  }, [q]);
  // Block body: scrollIntoView returns a Promise in newer browsers, and an effect must not return one.
  useEffect(() => {
    list.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);
  const pick = (i: Item | undefined) => {
    if (!i) return;
    onClose();
    i.run();
  };

  return (
    <Modal title="Go to or do" onClose={onClose} wide>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
        <input
          autoFocus
          className="input pl-9"
          placeholder="Type a page, an activity, a file or a project"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setAt((x) => Math.min(shown.length - 1, x + 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setAt((x) => Math.max(0, x - 1)));
            if (e.key === "Enter") pick(shown[at]);
            if (e.key === "Escape") onClose();
          }}
        />
      </div>
      <div ref={list} className="mt-3 max-h-[50vh] overflow-auto">
        {shown.map((i, n) => {
          const Icon = ICON[i.group];
          const head = n === 0 || shown[n - 1].group !== i.group;
          return (
            <div key={i.id}>
              {head && <div className="px-2 pb-1 pt-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{i.group}</div>}
              <button
                data-i={n}
                onMouseMove={() => setAt(n)}
                onClick={() => pick(i)}
                className={clsx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[14px]", n === at ? "bg-accent/12 text-ink" : "text-ink/85")}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className={clsx("min-w-0 flex-1 truncate", i.group === "Files" && "font-mono text-[13px]")}>{i.label}</span>
                {i.hint && <span className="truncate text-[12px] text-muted">{i.hint}</span>}
                {n === at && <CornerDownLeft className="h-3.5 w-3.5 text-muted" />}
              </button>
            </div>
          );
        })}
        {!shown.length && <div className="px-2 py-6 text-center text-sm text-muted">Nothing matches.</div>}
      </div>
    </Modal>
  );
}

export const SHORTCUTS: [string, string][] = [
  ["Ctrl/Cmd + K", "Go to a page, file or project; start an activity"],
  ["Ctrl/Cmd + H", "Help, opened at the part for this page"],
  ["?", "This list"],
  ["[ and ]", "Fold or show the left and right panes"],
  ["Space", "Review: reveal the answer"],
  ["1 2 3 4", "Review: again, hard, good, easy"],
  ["Ctrl + Enter", "Tutor: send"],
  ["← →", "Trace: step back and forward"],
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <table className="w-full text-sm">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k} className="border-b border-line/60 last:border-0">
              <td className="py-2 pr-4"><span className="kbd">{k}</span></td>
              <td className="py-2 text-muted">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
