import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, BookOpen, Compass, FolderGit2, GitCompare, Home, Monitor, Moon, Settings, Sun } from "lucide-react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import type { AgentInfo } from "@core/types";
import { get } from "@/lib/api";
import { useTheme, type ThemePref } from "@/lib/theme";

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

function NavItem({ to, icon, label, end }: { to: string; icon: React.ReactNode; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          "group relative flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10.5px] font-medium transition",
          isActive ? "bg-accent/12 text-accent" : "text-muted hover:bg-raised hover:text-ink",
        )
      }
    >
      {icon}
      <span>{label}</span>
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

  return (
    <div className="flex h-full">
      <aside className="flex w-[72px] shrink-0 flex-col items-stretch gap-1 border-r border-line bg-panel px-2 py-3">
        <NavLink to="/" className="mb-3 flex justify-center" title="groklab: projects">
          <Logo className="h-9 w-9" />
        </NavLink>
        {pid ? (
          <>
            <NavItem to={`/p/${pid}/explore`} icon={<Compass className="h-5 w-5" />} label="Explore" />
            <NavItem to={`/p/${pid}/changes`} icon={<GitCompare className="h-5 w-5" />} label="Changes" />
            <NavItem to={`/p/${pid}/library`} icon={<BookOpen className="h-5 w-5" />} label="Library" />
            <NavItem to={`/p/${pid}/progress`} icon={<BarChart3 className="h-5 w-5" />} label="Progress" />
          </>
        ) : (
          <NavItem to="/" end icon={<Home className="h-5 w-5" />} label="Projects" />
        )}
        <div className="flex-1" />
        {pid && <NavItem to="/" end icon={<FolderGit2 className="h-5 w-5" />} label="Projects" />}
        <NavItem to="/settings" icon={<Settings className="h-5 w-5" />} label="Settings" />
        <button
          onClick={() => setPref(NEXT[pref])}
          title={`Theme: ${pref} (click to change)`}
          className="flex flex-col items-center gap-1 rounded-xl py-2 text-[10.5px] font-medium text-muted transition hover:bg-raised hover:text-ink"
        >
          <ThemeIcon className="h-5 w-5" />
          <span className="capitalize">{pref}</span>
        </button>
        <NavLink
          to="/settings"
          title={health.data?.agent.detail ?? "checking the model"}
          className="mt-1 flex items-center justify-center gap-1.5 text-[10px] text-muted"
        >
          <span className={clsx("h-2 w-2 rounded-full", ready === undefined ? "bg-line" : ready ? "bg-good" : "bg-bad")} />
          model
        </NavLink>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
