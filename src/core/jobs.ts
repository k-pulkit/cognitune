import { join } from "node:path";
import { newId, type Store } from "./store.js";
import type { Job, JobKind } from "./types.js";

/** Most jobs kept in memory and in jobs.json; older ones drop off. */
const JOB_CAP = 100;

/**
 * Model calls take 20-120 s, longer than a request should wait. A job runs the work in the
 * background; the page polls GET /api/jobs/:id. Finished jobs are written to jobs.json (capped),
 * so Settings can show a history with times. A job that was running when the server stopped is
 * marked failed on the next start.
 */
export class Jobs {
  private readonly jobs = new Map<string, Job>();
  private readonly file?: string;

  constructor(private readonly store?: Store) {
    if (!store) return;
    this.file = join(store.home, "jobs.json");
    for (const j of store.read<Job[]>(this.file, [])) {
      if (j.status === "running") Object.assign(j, { status: "failed", error: "groklab stopped while this ran", endedAt: j.startedAt });
      this.jobs.set(j.id, j);
    }
  }

  private save(): void {
    while (this.jobs.size > JOB_CAP) {
      const oldest = [...this.jobs.values()].find((j) => j.status !== "running");
      if (!oldest) break;
      this.jobs.delete(oldest.id);
    }
    if (this.store && this.file) this.store.write(this.file, [...this.jobs.values()]);
  }

  start(kind: JobKind, projectId: string, work: () => Promise<{ id: string }>): Job {
    const job: Job = { id: newId(), kind, projectId, status: "running", startedAt: new Date().toISOString() };
    this.jobs.set(job.id, job);
    this.save();
    work()
      .then((r) => Object.assign(job, { status: "done", resultId: r.id }))
      .catch((e: unknown) => Object.assign(job, { status: "failed", error: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        job.endedAt = new Date().toISOString();
        this.save();
      });
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  running(projectId: string): Job[] {
    return [...this.jobs.values()].filter((j) => j.projectId === projectId && j.status === "running");
  }

  /** Newest first. */
  history(limit = 50): Job[] {
    return [...this.jobs.values()].reverse().slice(0, limit);
  }
}
