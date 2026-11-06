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
          <NavLink to="/" className="grid h-12 place-items-center" title="groklab: projects" aria-label="groklab: projects">
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
            window.dispatchEvent(new CustomEvent("groklab:open", { detail: path }));
          }}
        />
      )}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    </div>
  );
}
