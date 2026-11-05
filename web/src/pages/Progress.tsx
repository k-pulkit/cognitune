import { useMemo, useState } from "react";
import { relTime } from "@/lib/api";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { FileLevel, FileProgress, TreeNode } from "@core/types";
import { get } from "@/lib/api";
import { useProject } from "@/lib/project";
import { Badge, Empty, Score, Segmented } from "@/components/ui";

const LEVELS: { level: FileLevel; label: string; tone: "good" | "warn" | "muted"; text: string }[] = [
  { level: "understood", label: "Understood", tone: "good", text: "A check passed (quiz, teach-back 4+, walk, hunt, practice) on the code as it is now." },
  { level: "fading", label: "Fading", tone: "warn", text: "Understood, but nothing recalled for a while. A quick quiz or card keeps it." },
  { level: "stale", label: "Stale", tone: "warn", text: "You passed once, then the code changed. Check it again." },
  { level: "seen", label: "Seen", tone: "muted", text: "Touched by a lens or an activity, no pass yet." },
];

const CELL: Record<FileLevel, string> = {
  new: "bg-line/70",
  seen: "bg-accent/35",
  understood: "bg-good",
  fading: "bg-warn/60",
  stale: "bg-warn",
};

function flatFiles(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => (n.kind === "file" ? [n.path] : flatFiles(n.children ?? [])));
}

/** Every file in the folder as a small square, grouped by folder, coloured by level. */
function Heatmap({ files, levels, onOpen, rel }: { files: string[]; levels: Map<string, FileLevel>; onOpen: (p: string) => void; rel: (p: string) => string }) {
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const f of files) {
      const r = rel(f);
      const dir = r.includes("/") ? r.slice(0, r.lastIndexOf("/")) : ".";
      m.set(dir, [...(m.get(dir) ?? []), f]);
    }
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [files, rel]);
  return (
    <div className="card mt-6 p-4">
      <div className="mb-3 flex flex-wrap gap-3 text-[12px] text-muted">
        {(["understood", "fading", "stale", "seen", "new"] as FileLevel[]).map((l) => (
          <span key={l} className="flex items-center gap-1"><span className={clsx("h-2.5 w-2.5 rounded-sm", CELL[l])} />{l}</span>
        ))}
      </div>
      <div className="space-y-2">
        {groups.map(([dir, list]) => (
          <div key={dir} className="flex items-start gap-3">
            <div className="w-56 shrink-0 truncate pt-0.5 text-right font-mono text-[12px] text-muted" title={dir}>{dir}</div>
            <div className="flex flex-wrap gap-1">
              {list.map((f) => (
                <button key={f} title={`${rel(f)} · ${levels.get(f) ?? "new"}`} onClick={() => onOpen(f)}
                  className={clsx("h-3.5 w-3.5 rounded-sm transition hover:scale-125 hover:ring-2 hover:ring-accent/50", CELL[levels.get(f) ?? "new"])} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** What you can show you understand, per file. Computed from your quizzes, never stored. */
export function ProgressPage() {
  const { project, rel, setOpenFile, setSelected } = useProject();
  const nav = useNavigate();
  const [filter, setFilter] = useState<FileLevel | "all">("all");
  const [mode, setMode] = useState<"table" | "map">("table");
  const q = useQuery({ queryKey: ["progress", project.id], queryFn: () => get<FileProgress[]>(`/projects/${project.id}/progress`) });
  const tree = useQuery({ queryKey: ["tree", project.id, project.contexts], queryFn: () => get<TreeNode[]>(`/projects/${project.id}/tree`), enabled: mode === "map" });
  const levels = useMemo(() => new Map((q.data ?? []).map((r) => [r.path, r.level])), [q.data]);
  const open = (path: string) => {
    setOpenFile(path);
    setSelected([path]);
    nav(`/p/${project.id}/explore`);
  };
  const rows = q.data ?? [];
  const counts = useMemo(() => Object.fromEntries(LEVELS.map((l) => [l.level, rows.filter((r) => r.level === l.level).length])), [rows]);
  const shown = filter === "all" ? rows : rows.filter((r) => r.level === filter);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <h1 className="text-xl font-semibold tracking-tight">Progress</h1>
        <div className="flex items-center gap-3">
          <p className="flex-1 text-sm text-muted">Reading feels like understanding. Only a passed check counts here.</p>
          <Segmented value={mode} onChange={setMode} options={[{ value: "table", label: "Table" }, { value: "map", label: "Whole repo" }]} />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          {LEVELS.map((l) => (
            <button
              key={l.level}
              onClick={() => setFilter(filter === l.level ? "all" : l.level)}
              className={clsx("card p-4 text-left transition hover:border-accent/40", filter === l.level && "ring-2 ring-accent/30")}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{l.label}</span>
                <Badge tone={l.tone}>{l.level}</Badge>
              </div>
              <div className="mt-2 text-3xl font-semibold tabular-nums">{counts[l.level] ?? 0}</div>
              <div className="mt-1 text-xs text-muted">{l.text}</div>
            </button>
          ))}
        </div>

        {mode === "map" ? (
          tree.data ? <Heatmap files={flatFiles(tree.data.slice(0, 1))} levels={levels} onOpen={open} rel={rel} /> : null
        ) : rows.length === 0 && !q.isLoading ? (
          <Empty icon={<BarChart3 className="h-6 w-6" />} title="Nothing yet">Make a lens or take a quiz in Explore. Files show up here as you go.</Empty>
        ) : (
          <div className="card mt-6 overflow-hidden">
            <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
              <span className="text-sm font-medium">{shown.length} files</span>
              <div className="ml-auto">
                <Segmented
                  value={filter}
                  onChange={setFilter}
                  options={[{ value: "all", label: "All" }, ...LEVELS.map((l) => ({ value: l.level, label: l.label }))]}
                />
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">File</th>
                  <th className="px-4 py-2 font-medium">Level</th>
                  <th className="px-4 py-2 text-right font-medium">Best quiz</th>
                  <th className="px-4 py-2 text-right font-medium">Lenses</th>
                  <th className="px-4 py-2 text-right font-medium">Quizzes</th>
                  <th className="px-4 py-2 text-right font-medium">Other</th>
                  <th className="px-4 py-2 text-right font-medium">Last recall</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    key={r.path}
                    className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-raised"
                    onClick={() => open(r.path)}
                  >
                    <td className="max-w-[360px] truncate px-4 py-2 font-mono text-[13.5px]">{rel(r.path)}</td>
                    <td className="px-4 py-2">
                      <Badge tone={r.level === "understood" ? "good" : r.level === "stale" || r.level === "fading" ? "warn" : "muted"}>{r.level}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right">{r.bestScore === null ? <span className="text-muted">-</span> : <Score score={r.bestScore} size="sm" />}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted">{r.lenses}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted">{r.quizzes}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted" title="practice, teach-back, walk, hunt">{r.practices + r.other}</td>
                    <td className="px-4 py-2 text-right text-xs text-muted">{r.lastRetrieval ? relTime(r.lastRetrieval) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
