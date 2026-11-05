import { newId } from "./store.js";
import type { Job, JobKind } from "./types.js";

/**
 * Model calls take 20-120 s, longer than a request should wait. A job runs the work in the
 * background; the page polls GET /api/jobs/:id. Jobs live in memory only: the result is saved
 * by the work itself, so a restart loses only the "running" badge.
 */
export class Jobs {
  private readonly jobs = new Map<string, Job>();

  start(kind: JobKind, projectId: string, work: () => Promise<{ id: string }>): Job {
    const job: Job = { id: newId(), kind, projectId, status: "running", startedAt: new Date().toISOString() };
    this.jobs.set(job.id, job);
    work()
      .then((r) => Object.assign(job, { status: "done", resultId: r.id }))
      .catch((e: unknown) => Object.assign(job, { status: "failed", error: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        job.endedAt = new Date().toISOString();
      });
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  running(projectId: string): Job[] {
    return [...this.jobs.values()].filter((j) => j.projectId === projectId && j.status === "running");
  }
}
