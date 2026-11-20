import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Job } from "@core/types";

/** Thin fetch wrapper: JSON in, JSON out, server `{error}` becomes a thrown Error. */
export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const r = await fetch(`/api${path}`, {
    ...rest,
    headers: { "content-type": "application/json", ...(rest.headers ?? {}) },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error || `${r.status} ${r.statusText}`);
  return data as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, json: unknown = {}) => api<T>(path, { method: "POST", json });
export const put = <T>(path: string, json: unknown) => api<T>(path, { method: "PUT", json });
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: "PATCH", json });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Jobs a mounted page is polling and will handle itself; the status bar announces only the others. */
export const watchedJobs = new Set<string>();

/**
 * Start a model job and poll it. `elapsed` drives the progress text; on success every query is
 * refreshed (lists, progress) and `onDone` gets the finished job.
 */
export function useJob() {
  const qc = useQueryClient();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  useEffect(() => {
    if (job?.status !== "running") return;
    const t0 = Date.parse(job.startedAt);
    const t = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(t);
  }, [job?.status, job?.startedAt]);

  const run = useCallback(
    async (path: string, body: unknown, onDone?: (j: Job) => void) => {
      setError(null);
      setElapsed(0);
      let id: string | undefined;
      try {
        let j = await post<Job>(path, body);
        id = j.id;
        watchedJobs.add(id);
        setJob(j);
        void qc.invalidateQueries({ queryKey: ["project-jobs"] });
        while (j.status === "running") {
          await sleep(1000);
          if (!alive.current) return;
          j = await get<Job>(`/jobs/${j.id}`);
          setJob(j);
        }
        if (j.status === "failed") setError(j.error ?? "the job failed");
        else {
          await qc.invalidateQueries();
          onDone?.(j);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setJob(null);
      } finally {
        if (id) watchedJobs.delete(id);
      }
    },
    [qc],
  );

  return { run, job, busy: job?.status === "running", error, elapsed, clearError: () => setError(null) };
}

export function relTime(iso: string): string {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/**
 * A job working on `target` (a lens being reworked, a quiz being graded) that this page did not start
 * itself: typically one started before you left the page and came back. Returns it while it runs, with
 * the real elapsed time; when it ends, `onDone` gets the finished job (done or failed).
 */
export function useJobOn(pid: string, target: string | undefined, onDone: (j: Job) => void) {
  const q = useQuery({
    queryKey: ["project-jobs", pid],
    queryFn: async () => (await get<{ running: Job[] }>(`/projects/${pid}`)).running,
    refetchInterval: (s) => (s.state.data?.length ? 2000 : false),
  });
  const job = target ? (q.data ?? []).find((j) => j.target === target && !watchedJobs.has(j.id)) : undefined;
  const [elapsed, setElapsed] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  const last = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!job) return;
    const t0 = Date.parse(job.startedAt);
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - t0) / 1000)));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [job?.id, job?.startedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (job) {
      last.current = job.id;
      return;
    }
    const id = last.current;
    if (!id) return;
    last.current = undefined;
    void get<Job>(`/jobs/${id}`).then((j) => done.current(j)).catch(() => {});
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return job ? { job, elapsed } : null;
}
