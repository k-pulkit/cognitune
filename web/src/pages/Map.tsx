import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { Map as MapIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { FileLevel, FileProgress, Graph } from "@core/types";
import { get } from "@/lib/api";
import { useProject } from "@/lib/project";
import { shortPath } from "@/lib/path";
import { Badge, Empty, Spinner } from "@/components/ui";

type N = SimulationNodeDatum & { id: string; fanIn: number; fanOut: number; r: number };

const FILL: Record<FileLevel, string> = {
  new: "rgb(var(--muted) / 0.45)",
  seen: "rgb(var(--accent) / 0.45)",
  understood: "rgb(var(--good))",
  fading: "rgb(var(--warn) / 0.7)",
  stale: "rgb(var(--warn))",
};

/** Lay the graph out once (no animation): a few hundred ticks of a force simulation. */
function layout(g: Graph): { nodes: N[]; links: { s: N; t: N }[] } {
  const nodes: N[] = g.nodes.map((n) => ({ id: n.path, fanIn: n.fanIn, fanOut: n.fanOut, r: Math.min(18, 4 + Math.sqrt(n.fanIn) * 2.5) }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = g.edges.map((e) => ({ source: e.from, target: e.to }));
  forceSimulation(nodes)
    .force("link", forceLink<N, { source: string; target: string }>(links).id((d) => d.id).distance(60).strength(0.3))
    .force("charge", forceManyBody().strength(-170))
    .force("center", forceCenter(0, 0))
    // A weak pull to the middle keeps separate clusters from drifting off the screen.
    .force("x", forceX(0).strength(0.07))
    .force("y", forceY(0).strength(0.07))
    .force("collide", forceCollide<N>().radius((d) => d.r + 3))
    .stop()
    .tick(300);
  return { nodes, links: g.edges.map((e) => ({ s: byId.get(e.from)!, t: byId.get(e.to)! })) };
}

/** The import graph: who depends on whom, sized by how many files import each one. */
export function MapPage() {
  const { project, rel, setOpenFile, setSelected } = useProject();
  const nav = useNavigate();
  const g = useQuery({ queryKey: ["graph", project.id], queryFn: () => get<Graph>(`/projects/${project.id}/graph`) });
  const prog = useQuery({ queryKey: ["progress", project.id], queryFn: () => get<FileProgress[]>(`/projects/${project.id}/progress`) });
  const levels = useMemo(() => new Map((prog.data ?? []).map((p) => [p.path, p.level])), [prog.data]);
  const lay = useMemo(() => (g.data ? layout(g.data) : null), [g.data]);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<{ x: number; y: number; k: number }>({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  if (g.isLoading) return <div className="p-8"><Spinner /></div>;
  if (!lay || !lay.nodes.length) {
    return (
      <Empty icon={<MapIcon className="h-6 w-6" />} title="No imports found">
        The map reads import lines in TypeScript, JavaScript and Python files. This folder has none that point to other files in it.
      </Empty>
    );
  }
  const hubs = [...lay.nodes].sort((a, b) => b.fanIn - a.fanIn).slice(0, 15);
  const label = new Set(hubs.slice(0, 8).map((n) => n.id));
  const near = new Set<string>();
  if (hover) for (const l of lay.links) {
    if (l.s.id === hover) near.add(l.t.id);
    if (l.t.id === hover) near.add(l.s.id);
  }
  const xs = lay.nodes.map((n) => n.x ?? 0);
  const ys = lay.nodes.map((n) => n.y ?? 0);
  const pad = 40;
  const box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  const vb = `${box.x + view.x} ${box.y + view.y} ${box.w / view.k} ${box.h / view.k}`;
  const open = (path: string) => {
    setOpenFile(path);
    setSelected([path]);
    nav(`/p/${project.id}/explore`);
  };

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1 bg-panel">
        <svg
          className="h-full w-full cursor-grab active:cursor-grabbing"
          viewBox={vb}
          onWheel={(e) => setView((v) => ({ ...v, k: Math.min(8, Math.max(0.3, v.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15))) }))}
          onMouseDown={(e) => (drag.current = { x: e.clientX, y: e.clientY })}
          onMouseUp={() => (drag.current = null)}
          onMouseLeave={() => (drag.current = null)}
          onMouseMove={(e) => {
            if (!drag.current) return;
            const el = e.currentTarget.getBoundingClientRect();
            const sx = box.w / view.k / el.width;
            const dx = (e.clientX - drag.current.x) * sx;
            const dy = (e.clientY - drag.current.y) * sx;
            drag.current = { x: e.clientX, y: e.clientY };
            setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
          }}
        >
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="rgb(var(--muted) / 0.5)" />
            </marker>
          </defs>
          {lay.links.map((l, i) => {
            const on = hover && (l.s.id === hover || l.t.id === hover);
            const dx = (l.t.x ?? 0) - (l.s.x ?? 0);
            const dy = (l.t.y ?? 0) - (l.s.y ?? 0);
            const d = Math.hypot(dx, dy) || 1;
            return (
              <line
                key={i}
                x1={l.s.x} y1={l.s.y}
                x2={(l.t.x ?? 0) - (dx / d) * (l.t.r + 2)} y2={(l.t.y ?? 0) - (dy / d) * (l.t.r + 2)}
                stroke={on ? "rgb(var(--accent))" : "rgb(var(--muted) / 0.25)"}
                strokeWidth={on ? 1.5 : 0.8}
                markerEnd="url(#arrow)"
              />
            );
          })}
          {lay.nodes.map((n) => {
            const dim = hover && n.id !== hover && !near.has(n.id);
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`} opacity={dim ? 0.25 : 1} className="cursor-pointer"
                onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onClick={() => open(n.id)}>
                <circle r={n.r} fill={FILL[levels.get(n.id) ?? "new"]} stroke="rgb(var(--panel))" strokeWidth={1.5} />
                {(label.has(n.id) || n.id === hover) && (
                  <text y={-n.r - 4} textAnchor="middle" className="fill-ink font-mono" fontSize={10} paintOrder="stroke" stroke="rgb(var(--panel))" strokeWidth={3} strokeLinejoin="round">{n.id.split("/").pop()}</text>
                )}
              </g>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2 text-[11px] text-muted">
          {(["new", "seen", "understood", "fading", "stale"] as FileLevel[]).map((l) => (
            <span key={l} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: FILL[l] }} />{l}</span>
          ))}
          <span>· size = imported by · scroll to zoom, drag to move</span>
        </div>
        {hover && <div className="absolute left-3 top-3 rounded-md bg-raised px-2 py-1 font-mono text-xs">{rel(hover)}</div>}
      </div>
      <aside className="w-[300px] shrink-0 overflow-auto border-l border-line bg-panel p-4">
        <h1 className="text-base font-semibold">Map</h1>
        <p className="text-xs text-muted">{lay.nodes.length} files, {lay.links.length} imports. Files many others import are a good place to start.</p>
        <div className="label mt-4">Most depended on</div>
        <ol className="space-y-1">
          {hubs.map((n) => (
            <li key={n.id}>
              <button className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-raised" onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onClick={() => open(n.id)}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: FILL[levels.get(n.id) ?? "new"] }} />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={rel(n.id)}>{shortPath(rel(n.id), 30)}</span>
                <Badge>{n.fanIn}</Badge>
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
