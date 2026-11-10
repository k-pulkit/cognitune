# tiny-queue

A small in-memory job queue with retries, used as the learnforge demo project.

- `src/queue.ts`: the queue (add, take, ack, fail with retry and backoff)
- `src/backoff.ts`: how long to wait before a retry
- `src/worker.ts`: runs jobs from the queue with a concurrency limit
- `src/index.ts`: wires it together
