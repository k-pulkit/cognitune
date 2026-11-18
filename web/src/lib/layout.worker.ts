/// <reference lib="webworker" />
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";

export interface LayoutIn {
  id: number;
  /** r = circle radius; w = half the label's width, so labels get room too. */
  nodes: { id: string; r: number; w: number }[];
  links: { source: string; target: string; weight: number }[];
}
export interface LayoutOut {
  id: number;
  pos: Record<string, [number, number]>;
}

type N = SimulationNodeDatum & { id: string; r: number; w: number };

// The force layout runs here, off the main thread, so a big graph never freezes the page.
self.onmessage = (e: MessageEvent<LayoutIn>) => {
  const { id, nodes: input, links: raw } = e.data;
  const nodes: N[] = input.map((n) => ({ ...n }));
  const maxW = Math.max(1, ...raw.map((l) => l.weight));
  const links = raw.map((l) => ({ ...l }));
  forceSimulation(nodes)
    .force("link", forceLink<N, { source: string; target: string; weight: number }>(links).id((d) => d.id)
      .distance((l) => 110 + (l.source as unknown as N).r + (l.target as unknown as N).r)
      // Heavier arrows pull their two ends closer.
      .strength((l) => 0.06 + 0.24 * (l.weight / maxW)))
    .force("charge", forceManyBody<N>().strength((d) => -360 - d.r * 12))
    .force("center", forceCenter(0, 0))
    // A weak pull to the middle keeps separate clusters from drifting off the screen.
    .force("x", forceX(0).strength(0.06))
    .force("y", forceY(0).strength(0.06))
    .force("collide", forceCollide<N>().radius((d) => Math.max(d.r + 24, d.w + 8)).strength(0.9))
    .stop()
    .tick(300);
  const pos: LayoutOut["pos"] = {};
  for (const n of nodes) pos[n.id] = [n.x ?? 0, n.y ?? 0];
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, pos } satisfies LayoutOut);
};
