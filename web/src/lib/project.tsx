import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Job, Project } from "@core/types";
import { get } from "./api";

export type ProjectInfo = Project & { isGit: boolean; running: Job[] };

interface Ctx {
  project: ProjectInfo;
  /** Ticked files: the context for lenses, quizzes and practice. */
  selected: string[];
  toggle: (path: string, on?: boolean) => void;
  setSelected: (paths: string[]) => void;
  openFile: string | null;
  setOpenFile: (path: string | null, line?: number) => void;
  focusLine: number | null;
  rel: (path: string) => string;
}

const ProjectCtx = createContext<Ctx | null>(null);

function load<T>(key: string, fallback: T): T {
  try {
    const v = sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, v: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

export function ProjectProvider({ pid, children, fallback }: { pid: string; children: ReactNode; fallback: ReactNode }) {
  const q = useQuery({ queryKey: ["project", pid], queryFn: () => get<ProjectInfo>(`/projects/${pid}`) });
  const [selected, setSelectedRaw] = useState<string[]>(() => load(`gl.sel.${pid}`, []));
  const [openFile, setOpen] = useState<string | null>(() => load(`gl.open.${pid}`, null));
  const [focusLine, setFocusLine] = useState<number | null>(null);

  useEffect(() => save(`gl.sel.${pid}`, selected), [pid, selected]);
  useEffect(() => save(`gl.open.${pid}`, openFile), [pid, openFile]);

  const setSelected = useCallback((paths: string[]) => setSelectedRaw([...new Set(paths)]), []);
  const toggle = useCallback((path: string, on?: boolean) => {
    setSelectedRaw((s) => {
      const has = s.includes(path);
      const want = on ?? !has;
      return want ? (has ? s : [...s, path]) : s.filter((x) => x !== path);
    });
  }, []);
  const setOpenFile = useCallback((path: string | null, line?: number) => {
    setOpen(path);
    setFocusLine(line ?? null);
  }, []);

  const value = useMemo<Ctx | null>(() => {
    const p = q.data;
    if (!p) return null;
    const rel = (path: string) => {
      if (path.startsWith(p.root + "/")) return path.slice(p.root.length + 1);
      for (const c of p.contexts) if (path.startsWith(c + "/")) return `${c.split("/").pop()}/${path.slice(c.length + 1)}`;
      return path;
    };
    return { project: p, selected, toggle, setSelected, openFile, setOpenFile, focusLine, rel };
  }, [q.data, selected, toggle, setSelected, openFile, setOpenFile, focusLine]);

  if (q.error) return <>{fallback}</>;
  if (!value) return null;
  return <ProjectCtx.Provider value={value}>{children}</ProjectCtx.Provider>;
}

export function useProject(): Ctx {
  const c = useContext(ProjectCtx);
  if (!c) throw new Error("useProject outside ProjectProvider");
  return c;
}
