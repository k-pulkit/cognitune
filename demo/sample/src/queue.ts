import { backoffMs } from "./backoff.js";

export interface Job<T> {
  id: number;
  payload: T;
  attempts: number;
  /** Not before this time (ms since epoch). */
  runAt: number;
}

/**
 * In-memory queue. take() hands out the oldest ready job and keeps it "in flight" until
 * ack() or fail(). fail() puts it back with a backoff, or drops it after maxAttempts.
 */
export class Queue<T> {
  private ready: Job<T>[] = [];
  private inFlight = new Map<number, Job<T>>();
  private nextId = 1;
  readonly dead: Job<T>[] = [];

  constructor(private readonly maxAttempts = 3, private readonly now = () => Date.now()) {}

  add(payload: T): number {
    const job = { id: this.nextId++, payload, attempts: 0, runAt: this.now() };
    this.ready.push(job);
    return job.id;
  }

  take(): Job<T> | undefined {
    const t = this.now();
    const i = this.ready.findIndex((j) => j.runAt <= t);
    if (i < 0) return undefined;
    const [job] = this.ready.splice(i, 1);
    job.attempts++;
    this.inFlight.set(job.id, job);
    return job;
  }

  ack(id: number): void {
    this.inFlight.delete(id);
  }

  fail(id: number): void {
    const job = this.inFlight.get(id);
    if (!job) return;
    this.inFlight.delete(id);
    if (job.attempts >= this.maxAttempts) {
      this.dead.push(job);
      return;
    }
    job.runAt = this.now() + backoffMs(job.attempts);
    this.ready.push(job);
  }

  get size(): number {
    return this.ready.length + this.inFlight.size;
  }
}
