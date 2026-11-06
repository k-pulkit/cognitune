import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  BarChart3, BookOpen, HelpCircle, Command, Compass, FolderGit2, GitCompare, Home, Layers, Map as MapIcon, Monitor, Moon, Route, Settings, Sun, Sunrise,
} from "lucide-react";
import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { sectionFor } from "@/pages/Help";
import type { AgentInfo, Card, Project } from "@core/types";
import { get } from "@/lib/api";
import { useTheme, type ThemePref } from "@/lib/theme";
import { Palette, ShortcutHelp } from "./Palette";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="gl-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(var(--accent))" />
          <stop offset="1" stopColor="#c056f5" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#gl-g)" />
      <circle cx="14" cy="14" r="6.5" fill="none" stroke="white" strokeWidth="2.8" />
      <path d="M19 19l6 6" stroke="white" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  );
}

function NavItem({ to, icon, label, end, badge }: { to: string; icon: React.ReactNode; label: string; end?: boolean; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          "group relative flex flex-col items-center gap-1 rounded-xl px-1.5 py-2 text-[11px] font-medium leading-tight transition",
          isActive ? "bg-accent/12 text-accent" : "text-muted hover:bg-raised hover:text-ink",
        )
      }
    >
      {icon}
      <span>{label}</span>
      {!!badge && (
        <span className="absolute right-1.5 top-1 min-w-[16px] rounded-full bg-accent px-1 text-center text-[11px] font-semibold leading-4 text-accent-ink">{badge > 99 ? "99+" : badge}</span>
      )}
    </NavLink>
  );
}

const NEXT: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };

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

  return (
    <div className="flex h-full">
      <aside className="flex w-[80px] shrink-0 flex-col items-stretch gap-1 overflow-y-auto border-r border-line bg-panel px-3 py-3">
        <NavLink to="/" className="mb-3 flex justify-center" title="groklab: projects">
          <Logo className="h-9 w-9" />
        </NavLink>
        {pid ? (
          <>
            <NavItem to={`/p/${pid}/today`} icon={<Sunrise className="h-5 w-5" />} label="Today" />
            <NavItem to={`/p/${pid}/explore`} icon={<Compass className="h-5 w-5" />} label="Explore" />
            <NavItem to={`/p/${pid}/changes`} icon={<GitCompare className="h-5 w-5" />} label="Changes" />
            <NavItem to={`/p/${pid}/review`} icon={<Layers className="h-5 w-5" />} label="Review" badge={due.data?.length} />
            <NavItem to={`/p/${pid}/map`} icon={<MapIcon className="h-5 w-5" />} label="Map" />
            <NavItem to={`/p/${pid}/paths`} icon={<Route className="h-5 w-5" />} label="Paths" />
            <NavItem to={`/p/${pid}/library`} icon={<BookOpen className="h-5 w-5" />} label="Library" />
            <NavItem to={`/p/${pid}/progress`} icon={<BarChart3 className="h-5 w-5" />} label="Progress" />
          </>
        ) : (
          <NavItem to="/" end icon={<Home className="h-5 w-5" />} label="Projects" />
        )}
        <div className="flex-1" />
        <button
          onClick={() => setPalette(true)}
          title="Go to or do (Ctrl/Cmd+K). Press ? for all shortcuts."
          className="flex flex-col items-center gap-1 rounded-xl px-1.5 py-2 text-[11px] font-medium leading-tight text-muted transition hover:bg-raised hover:text-ink"
        >
          <Command className="h-5 w-5" />
          <span>Ctrl K</span>
        </button>
        {pid && <NavItem to="/" end icon={<FolderGit2 className="h-5 w-5" />} label="Projects" />}
        <NavItem to="/help" icon={<HelpCircle className="h-5 w-5" />} label="Help" />
        <NavItem to="/settings" icon={<Settings className="h-5 w-5" />} label="Settings" />
        <button
          onClick={() => setPref(NEXT[pref])}
          title={`Theme: ${pref} (click to change)`}
          className="flex flex-col items-center gap-1 rounded-xl px-1.5 py-2 text-[11px] font-medium leading-tight text-muted transition hover:bg-raised hover:text-ink"
        >
          <ThemeIcon className="h-5 w-5" />
          <span className="capitalize">{pref}</span>
        </button>
        <NavLink
          to="/settings"
          title={health.data?.agent.detail ?? "checking the model"}
          className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-muted"
        >
          <span className={clsx("h-2 w-2 rounded-full", ready === undefined ? "bg-line" : ready ? "bg-good" : "bg-bad")} />
          model
        </NavLink>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
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
            window.dispatchEvent(new CustomEvent("groklab:open", { detail: path }));
          }}
        />
      )}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    </div>
  );
}
