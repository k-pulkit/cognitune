/** Wait before retry `attempt` (1-based): doubles each time, capped, with jitter so retries spread out. */
export function backoffMs(attempt: number, baseMs = 200, capMs = 10_000, random = Math.random): number {
  const exp = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  // Full jitter: anywhere between half and all of the delay.
  return Math.round(exp / 2 + random() * (exp / 2));
}
