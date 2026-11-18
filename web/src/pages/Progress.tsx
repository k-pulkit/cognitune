import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, ChevronDown, ChevronRight, FileCode2, Folder, GitBranch, Search, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { FileLevel, FileProgress, GitRepo, TreeNode } from "@core/types";
import { get, relTime } from "@/lib/api";
import { useProject } from "@/lib/project";
import { rollup, touched, under, type Rollup } from "@/lib/rollup";
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
const ORDER: FileLevel[] = ["understood", "fading", "stale", "seen", "new"];

function flatFiles(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => (n.kind === "file" ? [n.path] : flatFiles(n.children ?? [])));
}

/** Share of each level as one thin bar: green understood, amber fading/stale, blue seen, grey not yet. */
function CoverageBar({ counts, total, className }: { counts: Record<FileLevel, number>; total: number; className?: string }) {
  return (
    <div className={clsx("flex h-1.5 overflow-hidden rounded-full bg-line/50", className)}>
      {/* A tiny share still gets a few pixels, so "2 of 606 touched" is visible. */}
      {ORDER.map((l) => counts[l] > 0 && <div key={l} className={CELL[l]} style={{ width: `${(counts[l] / Math.max(total, 1)) * 100}%`, minWidth: l === "new" ? 0 : 4 }} />)}
    </div>
  );
}

const levelTone = (l: FileLevel) => (l === "understood" ? "good" : l === "stale" || l === "fading" ? "warn" : "muted");

/** Pick a repo to scope the page to: a filter box and every repo with its coverage. */
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

/** Every file in the scope as a small square, grouped like the table's rows, coloured by level. */
function Heatmap({ groups, levels, onOpen, label }: {
  groups: [string, string[]][]; levels: Map<string, FileLevel>; onOpen: (p: string) => void; label: (p: string) => string;
}) {
  return (
    <div className="card mt-4 p-4">
      <div className="mb-3 flex flex-wrap gap-3 text-[12px] text-muted">
        {ORDER.map((l) => (
          <span key={l} className="flex items-center gap-1"><span className={clsx("h-2.5 w-2.5 rounded-sm", CELL[l])} />{l === "new" ? "not yet" : l}</span>
        ))}
      </div>
      <div className="space-y-2">
        {groups.map(([group, list]) => (
          <div key={group} className="flex items-start gap-3">
            <div className="w-56 shrink-0 truncate pt-0.5 text-right font-mono text-[12px] text-muted" title={group}>{group}</div>
            <div className="flex flex-wrap gap-1">
              {list.map((f) => (
                <button key={f} title={`${label(f)} · ${levels.get(f) ?? "not yet"}`} onClick={() => onOpen(f)}
                  className={clsx("h-3.5 w-3.5 rounded-sm transition hover:scale-125 hover:ring-2 hover:ring-accent/50", CELL[levels.get(f) ?? "new"])} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * What you can show you understand, rolled up from files to folders and git repos. The scope (a
 * folder, in the URL) narrows the cards, the table and the heatmap; rows drill in, the breadcrumb
 * goes back up.
 */
export function ProgressPage() {
  const { project, setOpenFile, setSelected } = useProject();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const root = project.root.replace(/\/$/, "");
  const scopeRel = (params.get("in") ?? "").replace(/^\/+|\/+$/g, "");
  const scope = scopeRel ? `${root}/${scopeRel}` : root;
  const search = params.get("q") ?? "";
  const filter = (params.get("level") as FileLevel | null) ?? null;
  const view = params.get("view") === "map" ? "map" : "table";
  const [showUntouched, setShowUntouched] = useState(false);
  const set = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace });
  };
  const goTo = (abs: string | null) => {
    setShowUntouched(false);
    set({ in: abs && abs !== root ? abs.slice(root.length + 1) : null, q: null });
  };

  const q = useQuery({ queryKey: ["progress", project.id], queryFn: () => get<FileProgress[]>(`/projects/${project.id}/progress`) });
  const tree = useQuery({ queryKey: ["tree", project.id, project.contexts], queryFn: () => get<TreeNode[]>(`/projects/${project.id}/tree`) });
  const reposQ = useQuery({ queryKey: ["repos", project.id, project.contexts], queryFn: () => get<GitRepo[]>(`/projects/${project.id}/repos`) });
  const repos = useMemo(() => reposQ.data ?? [], [reposQ.data]);

  const progress = useMemo(() => new Map((q.data ?? []).map((r) => [r.path, r])), [q.data]);
  const levels = useMemo(() => new Map((q.data ?? []).map((r) => [r.path, r.level])), [q.data]);
  // Every file in the project, plus touched files the tree no longer has (deleted since).
  const files = useMemo(
    () => [...new Set([...flatFiles(tree.data ?? []), ...progress.keys()])].filter((f) => under(root, f)),
    [tree.data, progress, root],
  );
  const rows = useMemo(() => rollup(scope, files, progress, repos), [scope, files, progress, repos]);
  const repoRows = useMemo(() => (repos.length > 1 ? rollup(root, files, progress, repos).filter((r) => r.kind === "repo") : []), [repos, root, files, progress]);
  const scoped = useMemo(() => (q.data ?? []).filter((r) => under(scope, r.path) || r.path === scope), [q.data, scope]);
  const counts = useMemo(() => Object.fromEntries(LEVELS.map((l) => [l.level, scoped.filter((r) => r.level === l.level).length])), [scoped]);

  const relTo = (p: string) => (under(scope, p) ? p.slice(scope.length + 1) : p);
  const open = (path: string) => {
    setOpenFile(path);
    setSelected([path]);
    nav(`/p/${project.id}/explore`);
  };

  // Breadcrumb: the repo the scope is in (picked from the picker), then the folders below it.
  const inRepo = repos.find((r) => r.path === scope || under(r.path, scope)) ?? null;
  const crumbBase = inRepo && inRepo.path !== root ? inRepo.path : root;
  const crumbs = (scope === crumbBase ? [] : scope.slice(crumbBase.length + 1).split("/")).map((part, i, all) => ({
    label: part, path: `${crumbBase}/${all.slice(0, i + 1).join("/")}`,
  }));

  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length
    ? scoped.filter((r) => words.every((w) => relTo(r.path).toLowerCase().includes(w)) && (!filter || r.level === filter))
    : [];
  const visible = rows.filter((r) => (filter ? r.counts[filter] > 0 : touched(r) > 0));
  const untouched = filter ? [] : rows.filter((r) => touched(r) === 0);
  const heat = useMemo(() => {
    const g = new Map<string, string[]>();
    for (const f of files) {
      if (!under(scope, f)) continue;
      const row = rows.find((r) => r.path === f || under(r.path, f));
      const key = row && row.kind !== "file" ? row.label : ".";
      g.set(key, [...(g.get(key) ?? []), f]);
    }
    return [...g].sort((a, b) => (a[0] === "." ? -1 : b[0] === "." ? 1 : a[0].localeCompare(b[0])));
  }, [files, rows, scope]);
  const scopeTotal = rows.reduce((s, r) => s + r.total, 0);
  const scopeTouched = rows.reduce((s, r) => s + touched(r), 0);

  const Row = ({ r }: { r: Rollup }) =>
    r.kind === "file" ? (
      <tr className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-raised" onClick={() => open(r.path)}>
        <td className="max-w-0 px-4 py-2">
          <div className="flex items-center gap-2 truncate font-mono text-[13px]" title={r.label}>
            <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted" /> <span className="truncate">{r.label}</span>
          </div>
        </td>
        <td className="px-4 py-2">{r.file ? <Badge tone={levelTone(r.file.level)}>{r.file.level}</Badge> : <span className="text-[12px] text-muted">not yet</span>}</td>
        <td className="px-4 py-2 text-right text-[12.5px] text-muted">
          {r.file && (
            <span title="best quiz · lenses · quizzes · other activities">
              {r.file.bestScore !== null && <><Score score={r.file.bestScore} size="sm" /> · </>}
              {r.file.lenses} lens{r.file.lenses === 1 ? "" : "es"} · {r.file.quizzes} quiz{r.file.quizzes === 1 ? "" : "zes"}
              {r.file.practices + r.file.other > 0 && ` · ${r.file.practices + r.file.other} other`}
            </span>
          )}
        </td>
        <td className="px-4 py-2 text-right text-xs text-muted">{r.lastRetrieval ? relTime(r.lastRetrieval) : "-"}</td>
      </tr>
    ) : (
      <tr className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-raised" onClick={() => goTo(r.path)}>
        <td className="max-w-0 px-4 py-2">
          <div className="flex items-center gap-2 font-mono text-[13px]" title={r.label}>
            {r.kind === "repo" ? <GitBranch className="h-3.5 w-3.5 shrink-0 text-accent" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-muted" />}
            <span className="truncate">{r.label}</span>
            <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted" />
          </div>
        </td>
        <td className="px-4 py-2"><CoverageBar counts={r.counts} total={r.total} className="w-32" /></td>
        <td className="px-4 py-2 text-right text-[12.5px] tabular-nums text-muted">
          {ORDER.slice(0, 3).map((l) => r.counts[l] > 0 && <span key={l} className={clsx("mr-2", l === "understood" ? "text-good" : "text-warn")}>{r.counts[l]} {l}</span>)}
          <span>{touched(r)} / {r.total} files</span>
        </td>
        <td className="px-4 py-2 text-right text-xs text-muted">{r.lastRetrieval ? relTime(r.lastRetrieval) : "-"}</td>
      </tr>
    );

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-semibold tracking-tight">Progress</h1>
            <p className="text-sm text-muted">Reading feels like understanding. Only a passed check counts here.</p>
          </div>
          <Segmented value={view} onChange={(v) => set({ view: v === "map" ? "map" : null })} options={[{ value: "table", label: "Table" }, { value: "map", label: "Heatmap" }]} />
        </div>

        {/* Scope: project › repo (picker) › folders, and a search over the paths below it. */}
        <div className="mt-5 flex flex-wrap items-center gap-1 rounded-md border border-line bg-panel px-2 py-1.5">
          <button onClick={() => goTo(null)} className={clsx("rounded-md px-2 py-1 text-[13px] font-medium hover:bg-raised", scope === root ? "text-ink" : "text-muted")}>
            {project.name}
          </button>
          {repoRows.length > 0 && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-muted" />
              <RepoPicker repos={repoRows} current={inRepo?.path ?? null} onPick={goTo} />
            </>
          )}
          {(repoRows.length > 0 && !inRepo ? [] : crumbs).map((c) => (
            <span key={c.path} className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-muted" />
              <button onClick={() => goTo(c.path)} className={clsx("rounded-md px-1.5 py-1 font-mono text-[13px] hover:bg-raised", c.path === scope ? "text-ink" : "text-muted")}>
                {c.label}
              </button>
            </span>
          ))}
          {repoRows.length > 0 && !inRepo && scope !== root && (
            <span className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-muted" />
              <span className="px-1.5 py-1 font-mono text-[13px]">{scopeRel}</span>
            </span>
          )}
          <div className="relative ml-auto w-60">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted" />
            <input className="input h-8 pl-8 pr-7 text-[13px]" placeholder={scope === root ? "Search touched files" : "Search in here"} value={search}
              onChange={(e) => set({ q: e.target.value || null }, true)} />
            {search && <button className="absolute right-2 top-2 text-muted hover:text-ink" onClick={() => set({ q: null }, true)} aria-label="Clear search"><X className="h-3.5 w-3.5" /></button>}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {LEVELS.map((l) => (
            <button
              key={l.level}
              onClick={() => set({ level: filter === l.level ? null : l.level })}
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

        {view === "map" ? (
          tree.data ? <Heatmap groups={heat} levels={levels} onOpen={open} label={relTo} /> : null
        ) : (q.data ?? []).length === 0 && !q.isLoading ? (
          <Empty icon={<BarChart3 className="h-6 w-6" />} title="Nothing yet">Make a lens or take a quiz in Explore. Files show up here as you go.</Empty>
        ) : (
          <div className="card mt-4 overflow-hidden">
            <div className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-sm">
              {words.length ? (
                <span className="font-medium">{matches.length} touched file{matches.length === 1 ? "" : "s"} match “{search}”</span>
              ) : (
                <>
                  <span className="font-medium">{scopeTouched} of {scopeTotal} files touched</span>
                  <CoverageBar counts={rows.reduce((acc, r) => { ORDER.forEach((l) => (acc[l] += r.counts[l])); return acc; }, { new: 0, seen: 0, understood: 0, fading: 0, stale: 0 } as Record<FileLevel, number>)} total={scopeTotal} className="w-40" />
                </>
              )}
              {filter && (
                <button className="ml-auto flex items-center gap-1 text-xs text-muted hover:text-ink" onClick={() => set({ level: null })}>
                  only {filter} <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <table className="w-full table-fixed text-sm">
              <colgroup><col /><col className="w-40" /><col className="w-72" /><col className="w-28" /></colgroup>
              <tbody>
                {words.length
                  ? matches.map((f) => <Row key={f.path} r={{ path: f.path, label: relTo(f.path), kind: "file", total: 1, counts: { new: 0, seen: 0, understood: 0, fading: 0, stale: 0, [f.level]: 1 }, lastRetrieval: f.lastRetrieval, file: f }} />)
                  : visible.map((r) => <Row key={r.path} r={r} />)}
                {!words.length && visible.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-muted">{filter ? `Nothing ${filter} in here.` : "Nothing touched in here yet."}</td></tr>
                )}
                {!words.length && showUntouched && untouched.map((r) => <Row key={r.path} r={r} />)}
              </tbody>
            </table>
            {!words.length && untouched.length > 0 && (
              <button className="w-full border-t border-line px-4 py-2 text-left text-[12.5px] text-muted hover:bg-raised hover:text-ink" onClick={() => setShowUntouched((v) => !v)}>
                {showUntouched ? "Hide" : "Show"} {untouched.length} untouched {untouched.every((r) => r.kind === "file") ? "files" : "items"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
