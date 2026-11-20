import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  BarChart3, BookOpen, CheckCircle2, HelpCircle, Command, Compass, FolderGit2, GitCompare, Home, Layers, Map as MapIcon, Monitor, Moon, Route, Settings, Sun,
  Sunrise, X, XCircle, History,
} from "lucide-react";
import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { sectionFor } from "@/pages/Help";
import type { AgentInfo, Card, Job, JobKind, Project } from "@core/types";
import { get, relTime, watchedJobs } from "@/lib/api";
import { Spinner } from "./ui";
import { useTheme, type ThemePref } from "@/lib/theme";
import { Palette, ShortcutHelp } from "./Palette";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="6" fill="rgb(var(--accent))" />
      <circle cx="14" cy="14" r="6.5" fill="none" stroke="white" strokeWidth="2.8" />
      <path d="M19 19l6 6" stroke="white" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  );
}

/** Activity-bar button: icon only, name in the tooltip, 2px bar on the left when active. */
function NavItem({ to, icon, label, end, badge }: { to: string; icon: React.ReactNode; label: string; end?: boolean; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      aria-label={label}
      className={({ isActive }) =>
        clsx(
          "relative grid h-12 w-12 shrink-0 place-items-center transition-colors",
          isActive ? "text-ink before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent" : "text-muted hover:text-ink",
        )
      }
    >
      {icon}
      {!!badge && (
        <span className="absolute bottom-2 right-1.5 min-w-[16px] rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 text-accent-ink">{badge > 99 ? "99+" : badge}</span>
      )}
    </NavLink>
  );
}

const NEXT: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };

const JOB_NAME: Record<JobKind, string> = {
  lens: "lens", quiz: "quiz", grade: "grading", practice: "practice", review: "review", teachback: "teach-back", tutor: "tutor reply",
  walk: "walkthrough", walkcheck: "check", hunt: "bug hunt", huntgrade: "grading", path: "path",
};
/** Where a finished job's result opens; kinds without a page of their own are left out. */
const RESULT_PAGE: Partial<Record<JobKind, string>> = {
  lens: "lens", quiz: "quiz", practice: "practice", teachback: "teach", tutor: "tutor", walk: "walk", hunt: "hunt", path: "paths",
};

/** Kinds that work on an existing thing: open that thing (a rework opens its lens, grading opens the quiz). */
const TARGET_PAGE: Partial<Record<JobKind, string>> = {
  lens: "lens", grade: "quiz", walkcheck: "walk", huntgrade: "hunt", review: "practice", tutor: "tutor", quiz: "lens",
};

/** "42s", "1m 42s". */
function took(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Where a job's row should go: its result, else the thing it worked on. */
function jobLink(pid: string, j: Job): string | null {
  if (j.status === "done" && j.resultId && RESULT_PAGE[j.kind]) return `/p/${pid}/${RESULT_PAGE[j.kind]}/${j.resultId}`;
  if (j.target && TARGET_PAGE[j.kind]) return `/p/${pid}/${TARGET_PAGE[j.kind]}/${j.target}`;
  return null;
}

/**
 * Activity: this project's model jobs, running and recent, from any page. What each was, how long it
 * took (or has been running), and a link to its result.
 */
function ActivityPanel({ pid, onClose }: { pid: string; onClose: () => void }) {
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ["activity", pid],
    queryFn: () => get<Job[]>(`/projects/${pid}/jobs`),
    refetchInterval: (s) => (s.state.data?.some((j) => j.status === "running") ? 1000 : 5000),
  });
  const list = q.data ?? [];
  return (
    <div className="absolute bottom-full left-0 z-50 mb-1 max-h-[60vh] w-[440px] overflow-auto rounded-md border border-line bg-panel py-1 text-[13px] text-ink shadow-lg">
      <div className="flex items-center px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted">
        Activity <span className="ml-auto font-normal normal-case tracking-normal">model jobs in this project</span>
      </div>
      {!list.length && <div className="px-3 py-3 text-muted">Nothing yet. Lenses, quizzes and the tutor show up here while they run.</div>}
      {list.map((j) => {
        const to = jobLink(pid, j);
        const end = j.endedAt ? Date.parse(j.endedAt) : Date.now();
        const dur = took(end - Date.parse(j.startedAt));
        return (
          <button
            key={j.id}
            disabled={!to}
            onClick={() => { if (to) { onClose(); nav(to); } }}
            className={clsx("flex w-full items-start gap-2.5 px-3 py-2 text-left", to ? "hover:bg-raised" : "cursor-default")}
            title={j.error ?? j.label ?? JOB_NAME[j.kind]}
          >
            <span className="mt-0.5 shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
              {j.status === "running" ? <Spinner className="text-accent" /> : j.status === "done" ? <CheckCircle2 className="text-good" /> : <XCircle className="text-bad" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{j.label ?? JOB_NAME[j.kind].replace(/^./, (c) => c.toUpperCase())}</span>
              <span className="block truncate text-[12px] text-muted">
                {j.status === "running" ? `running · ${dur}` : `${j.status === "done" ? "took" : "failed after"} ${dur} · ${relTime(j.endedAt ?? j.startedAt)}`}
                {j.status === "failed" && j.error ? ` · ${j.error}` : ""}
              </span>
            </span>
            {to && <span className="mt-0.5 shrink-0 text-[12px] text-accent">open</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Running jobs in the status bar, so leaving a page mid-job is safe. Polls only while something
 * runs. A job that finishes with no page left to open its result shows a "ready" link instead.
 * Clicking the activity button (or the running job) opens the Activity list.
 */
function JobsStatus({ pid }: { pid: string }) {
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ["project-jobs", pid],
    queryFn: async () => (await get<{ running: Job[] }>(`/projects/${pid}`)).running,
    refetchInterval: (s) => (s.state.data?.length ? 2000 : false),
  });
  const running = q.data ?? [];
  const seen = useRef(new Set<string>());
  const [ready, setReady] = useState<Job[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const now = new Set(running.map((j) => j.id));
    const gone = [...seen.current].filter((id) => !now.has(id) && !watchedJobs.has(id));
    seen.current = now;
    for (const id of gone) {
      void get<Job>(`/jobs/${id}`).then((j) => {
        if (j.status === "done" && j.resultId && RESULT_PAGE[j.kind]) setReady((r) => [...r.filter((x) => x.id !== j.id), j]);
      }).catch(() => {});
    }
  }, [q.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // Close the list on a click outside it or on Escape.
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", key); };
  }, [open]);

  const last = ready[ready.length - 1];
  const j = running[0];
  const secs = j ? Math.max(0, Math.round((Date.now() - Date.parse(j.startedAt)) / 1000)) : 0;
  return (
    <span ref={box} className="relative flex items-center">
      <button
        className={clsx("flex items-center gap-1.5 px-1.5 hover:bg-raised", open && "bg-raised text-ink")}
        title={running.length ? running.map((x) => x.label ?? JOB_NAME[x.kind]).join("\n") : "Activity: running and recent model jobs"}
        onClick={() => setOpen((o) => !o)}
      >
        {running.length ? (
          <>
            <span className="[&>svg]:h-3 [&>svg]:w-3"><Spinner className="text-accent" /></span>
            <span className="max-w-[340px] truncate">
              {running.length === 1 ? `${j.label ?? JOB_NAME[j.kind]} · ${secs}s` : `${running.length} jobs running`}
            </span>
          </>
        ) : (
          <><History className="h-3 w-3" /> Activity</>
        )}
      </button>
      {!running.length && last && (
        <>
          <button
            className="flex items-center gap-1.5 px-1.5 text-good hover:bg-raised"
            onClick={() => {
              setReady((r) => r.filter((x) => x.id !== last.id));
              nav(`/p/${pid}/${RESULT_PAGE[last.kind]}/${last.resultId}`);
            }}
          >
            <CheckCircle2 className="h-3 w-3" /> {JOB_NAME[last.kind]} ready · open{ready.length > 1 ? ` (+${ready.length - 1})` : ""}
          </button>
          <button className="px-1 hover:bg-raised hover:text-ink" title="Dismiss" onClick={() => setReady((r) => r.filter((x) => x.id !== last.id))}>
            <X className="h-3 w-3" />
          </button>
        </>
      )}
      {open && <ActivityPanel pid={pid} onClose={() => setOpen(false)} />}
    </span>
  );
}

/** App frame: a slim rail on the left, the page on the right. */
export function Shell() {
  const { pid } = useParams();
  const { pref, setPref } = useTheme();
  const health = useQuery({ queryKey: ["health"], queryFn: () => get<{ agent: AgentInfo }>("/health"), staleTime: 60_000 });
  const ready = health.data?.agent.ready;
  const ThemeIcon = pref === "dark" ? Moon : pref === "light" ? Sun : Monitor;
  const nav = useNavigate();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const due = useQuery({ queryKey: ["cards-due", pid], queryFn: () => get<Card[]>(`/projects/${pid}/cards/due`), enabled: !!pid, staleTime: 60_000 });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => get<Project[]>("/projects"), enabled: !!pid, staleTime: 60_000 });
  const root = projects.data?.find((p) => p.id === pid)?.root;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        const s = sectionFor(window.location.pathname);
        nav(s ? `/help?s=${s}` : "/help");
        return;
      }
      const typing = (e.target as HTMLElement).closest("input, textarea, [contenteditable], .cm-editor");
      if (!typing && e.key === "?") setHelp(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const modelText = ready === undefined ? "checking model" : ready ? "model ready" : "model off";
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-12 shrink-0 flex-col items-stretch overflow-y-auto bg-rail">
          <NavLink to="/" className="grid h-12 place-items-center" title="cognitune: projects" aria-label="cognitune: projects">
            <Logo className="h-6 w-6" />
          </NavLink>
          {pid ? (
            <>
              <NavItem to={`/p/${pid}/today`} icon={<Sunrise className="h-6 w-6" strokeWidth={1.5} />} label="Today" />
              <NavItem to={`/p/${pid}/explore`} icon={<Compass className="h-6 w-6" strokeWidth={1.5} />} label="Explore" />
              <NavItem to={`/p/${pid}/changes`} icon={<GitCompare className="h-6 w-6" strokeWidth={1.5} />} label="Changes" />
              <NavItem to={`/p/${pid}/review`} icon={<Layers className="h-6 w-6" strokeWidth={1.5} />} label="Review" badge={due.data?.length} />
              <NavItem to={`/p/${pid}/map`} icon={<MapIcon className="h-6 w-6" strokeWidth={1.5} />} label="Map" />
              <NavItem to={`/p/${pid}/paths`} icon={<Route className="h-6 w-6" strokeWidth={1.5} />} label="Paths" />
              <NavItem to={`/p/${pid}/library`} icon={<BookOpen className="h-6 w-6" strokeWidth={1.5} />} label="Library" />
              <NavItem to={`/p/${pid}/progress`} icon={<BarChart3 className="h-6 w-6" strokeWidth={1.5} />} label="Progress" />
            </>
          ) : (
            <NavItem to="/" end icon={<Home className="h-6 w-6" strokeWidth={1.5} />} label="Projects" />
          )}
          <div className="flex-1" />
          {pid && <NavItem to="/" end icon={<FolderGit2 className="h-6 w-6" strokeWidth={1.5} />} label="Projects" />}
          <NavItem to="/help" icon={<HelpCircle className="h-6 w-6" strokeWidth={1.5} />} label="Help" />
          <NavItem to="/settings" icon={<Settings className="h-6 w-6" strokeWidth={1.5} />} label="Settings" />
        </aside>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
      <footer className="flex h-[22px] shrink-0 items-center gap-1 border-t border-line bg-status px-2 text-[12px] text-muted">
        {root && <span className="px-1.5" title={root}>{root.split("/").filter(Boolean).pop()}</span>}
        <NavLink to="/settings" title={health.data?.agent.detail ?? "checking the model"} className="flex items-center gap-1.5 px-1.5 hover:bg-raised">
          <span className={clsx("h-2 w-2 rounded-full", ready === undefined ? "bg-line" : ready ? "bg-good" : "bg-bad")} />
          {modelText}
        </NavLink>
        {pid && <JobsStatus pid={pid} />}
        <div className="flex-1" />
        <button
          onClick={() => setPalette(true)}
          title="Go to or do (Ctrl/Cmd+K). Press ? for all shortcuts."
          className="flex items-center gap-1 px-1.5 hover:bg-raised"
        >
          <Command className="h-3 w-3" /> Ctrl K
        </button>
        <button onClick={() => setPref(NEXT[pref])} title={`Theme: ${pref} (click to change)`} className="flex items-center gap-1 px-1.5 hover:bg-raised">
          <ThemeIcon className="h-3 w-3" /> <span className="capitalize">{pref}</span>
        </button>
      </footer>
      {palette && (
        <Palette
          pid={pid}
          root={root}
          onClose={() => setPalette(false)}
          openFile={(path) => {
            // The open file is kept per project in sessionStorage by ProjectProvider.
            try {
              sessionStorage.setItem(`gl.open.${pid}`, JSON.stringify(path));
            } catch {
              /* ignore */
            }
            nav(`/p/${pid}/explore`);
            window.dispatchEvent(new CustomEvent("cognitune:open", { detail: path }));
          }}
        />
      )}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    </div>
  );
}
