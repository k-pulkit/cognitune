import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import type { FileLevel, GitRepo } from "@core/types";
import { touched, under, type Rollup } from "@/lib/rollup";

export const CELL: Record<FileLevel, string> = {
  new: "bg-line/70",
  seen: "bg-accent/35",
  understood: "bg-good",
  fading: "bg-warn/60",
  stale: "bg-warn",
};
export const ORDER: FileLevel[] = ["understood", "fading", "stale", "seen", "new"];

/** Share of each level as one thin bar: green understood, amber fading/stale, blue seen, grey not yet. */
export function CoverageBar({ counts, total, className }: { counts: Record<FileLevel, number>; total: number; className?: string }) {
  return (
    <div className={clsx("flex h-1.5 overflow-hidden rounded-full bg-line/50", className)}>
      {/* A tiny share still gets a few pixels, so "2 of 606 touched" is visible. */}
      {ORDER.map((l) => counts[l] > 0 && <div key={l} className={CELL[l]} style={{ width: `${(counts[l] / Math.max(total, 1)) * 100}%`, minWidth: l === "new" ? 0 : 4 }} />)}
    </div>
  );
}

/** Pick a repo to scope a page to: a filter box and every repo with its coverage. */
function RepoPicker({ repos, current, onPick }: { repos: Rollup[]; current: string | null; onPick: (path: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const shown = repos.filter((r) => r.label.toLowerCase().includes(q.toLowerCase()));
  const name = repos.find((r) => r.path === current)?.label;
  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={clsx("flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[13px] transition hover:bg-raised", name ? "text-ink" : "text-muted")}
      >
        <GitBranch className="h-3.5 w-3.5 text-accent" /> {name ?? `all ${repos.length} repos`} <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-[34rem] rounded-md border border-line bg-panel p-2 shadow-soft">
          <input className="input mb-2" placeholder="Filter repos" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="max-h-80 overflow-auto">
            {current && (
              <button className="w-full rounded px-2 py-1.5 text-left text-[13px] text-muted hover:bg-raised" onClick={() => { onPick(null); setOpen(false); }}>
                All repos
              </button>
            )}
            {shown.map((r) => (
              <button
                key={r.path}
                onClick={() => { onPick(r.path); setOpen(false); }}
                className={clsx("grid w-full grid-cols-[1fr_5rem_4.5rem] items-center gap-3 rounded px-2 py-1.5 text-left hover:bg-raised", r.path === current && "bg-raised")}
              >
                <span className="truncate font-mono text-[12.5px]">{r.label}</span>
                <CoverageBar counts={r.counts} total={r.total} />
                <span className="text-right text-[11.5px] tabular-nums text-muted">{touched(r)} / {r.total}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Where a page is looking: project › repo (picked from a list, when there are several) › folders.
 * Any crumb goes back up to it. `children` sit at the right end (a search box, a refresh button).
 */
export function ScopeBar({ root, rootLabel, scope, repos, repoRows, onScope, children, className }: {
  root: string; rootLabel: string; scope: string; repos: GitRepo[]; repoRows: Rollup[];
  onScope: (abs: string | null) => void; children?: ReactNode; className?: string;
}) {
  const inRepo = repos.find((r) => r.path === scope || under(r.path, scope)) ?? null;
  const base = inRepo && inRepo.path !== root ? inRepo.path : root;
  const crumbs = (scope === base ? [] : scope.slice(base.length + 1).split("/")).map((part, i, all) => ({
    label: part, path: `${base}/${all.slice(0, i + 1).join("/")}`,
  }));
  // Outside every repo (a plain folder that holds repos): show its path as one crumb.
  const loose = repoRows.length > 0 && !inRepo;
  return (
    <div className={clsx("flex flex-wrap items-center gap-1 rounded-md border border-line bg-panel px-2 py-1.5", className)}>
      <button onClick={() => onScope(null)} className={clsx("rounded-md px-2 py-1 text-[13px] font-medium hover:bg-raised", scope === root ? "text-ink" : "text-muted")}>
        {rootLabel}
      </button>
      {repoRows.length > 0 && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-muted" />
          <RepoPicker repos={repoRows} current={inRepo?.path ?? null} onPick={onScope} />
        </>
      )}
      {(loose ? [] : crumbs).map((c) => (
        <span key={c.path} className="flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 text-muted" />
          <button onClick={() => onScope(c.path)} className={clsx("rounded-md px-1.5 py-1 font-mono text-[13px] hover:bg-raised", c.path === scope ? "text-ink" : "text-muted")}>
            {c.label}
          </button>
        </span>
      ))}
      {loose && scope !== root && (
        <span className="flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 text-muted" />
          <span className="px-1.5 py-1 font-mono text-[13px]">{scope.slice(root.length + 1)}</span>
        </span>
      )}
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  );
}
