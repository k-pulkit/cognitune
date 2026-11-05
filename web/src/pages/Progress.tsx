import { useMemo, useState } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { FileLevel, FileProgress } from "@core/types";
import { get } from "@/lib/api";
import { useProject } from "@/lib/project";
import { Badge, Empty, Score, Segmented } from "@/components/ui";

const LEVELS: { level: FileLevel; label: string; tone: "good" | "warn" | "muted"; text: string }[] = [
  { level: "understood", label: "Understood", tone: "good", text: "A quiz passed, and the file has not changed since." },
  { level: "stale", label: "Stale", tone: "warn", text: "You passed once, then the code changed. Quiz it again." },
  { level: "seen", label: "Seen", tone: "muted", text: "A lens or practice touched it, no pass yet." },
];

/** What you can show you understand, per file. Computed from your quizzes, never stored. */
export function ProgressPage() {
  const { project, rel, setOpenFile, setSelected } = useProject();
  const nav = useNavigate();
  const [filter, setFilter] = useState<FileLevel | "all">("all");
  const q = useQuery({ queryKey: ["progress", project.id], queryFn: () => get<FileProgress[]>(`/projects/${project.id}/progress`) });
  const rows = q.data ?? [];
  const counts = useMemo(() => Object.fromEntries(LEVELS.map((l) => [l.level, rows.filter((r) => r.level === l.level).length])), [rows]);
  const shown = filter === "all" ? rows : rows.filter((r) => r.level === filter);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <h1 className="text-xl font-semibold tracking-tight">Progress</h1>
        <p className="text-sm text-muted">Reading feels like understanding. Only a passed quiz counts here.</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
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

        {rows.length === 0 && !q.isLoading ? (
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
                  <th className="px-4 py-2 text-right font-medium">Practice</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    key={r.path}
                    className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-raised"
                    onClick={() => {
                      setOpenFile(r.path);
                      setSelected([r.path]);
                      nav(`/p/${project.id}/explore`);
                    }}
                  >
                    <td className="max-w-[360px] truncate px-4 py-2 font-mono text-[12.5px]">{rel(r.path)}</td>
                    <td className="px-4 py-2">
                      <Badge tone={r.level === "understood" ? "good" : r.level === "stale" ? "warn" : "muted"}>{r.level}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right">{r.bestScore === null ? <span className="text-muted">-</span> : <Score score={r.bestScore} size="sm" />}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted">{r.lenses}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted">{r.quizzes}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted">{r.practices}</td>
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
