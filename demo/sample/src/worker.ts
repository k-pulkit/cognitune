import type { Queue } from "./queue.js";

/** Pull jobs and run them, at most `concurrency` at a time, until the queue is empty. */
export async function drain<T>(queue: Queue<T>, handle: (payload: T) => Promise<void>, concurrency = 2): Promise<void> {
  const running = new Set<Promise<void>>();
  while (queue.size > 0) {
    const job = running.size < concurrency ? queue.take() : undefined;
    if (!job) {
      // Nothing ready (or no free slot): wait for a running job, or a short tick for backoff.
      await (running.size ? Promise.race(running) : new Promise((r) => setTimeout(r, 50)));
      continue;
    }
    const p = handle(job.payload)
      .then(() => queue.ack(job.id))
      .catch(() => queue.fail(job.id))
      .finally(() => running.delete(p));
    running.add(p);
  }
  await Promise.all(running);
}
