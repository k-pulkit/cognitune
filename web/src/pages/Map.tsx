import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode2, Folder, GitBranch, Map as MapIcon, Maximize, Minus, Plus, RefreshCw } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { FileLevel, FileProgress, GitRepo, Graph } from "@core/types";
import { get, relTime } from "@/lib/api";
import { useProject } from "@/lib/project";
import { graphAt, LEAF_MAX, type ScopedEdge, type ScopedNode } from "@/lib/graphScope";
import { rollup, under } from "@/lib/rollup";
import type { LayoutIn, LayoutOut } from "@/lib/layout.worker";
import { CodePane } from "@/components/CodePane";
import { ScopeBar } from "@/components/Scope";
import { Split } from "@/components/Split";
import { Badge, Button, Empty } from "@/components/ui";

const FILL: Record<FileLevel, string> = {
  new: "rgb(var(--muted) / 0.45)",
  seen: "rgb(var(--accent) / 0.45)",
  understood: "rgb(var(--good))",
  fading: "rgb(var(--warn) / 0.7)",
  stale: "rgb(var(--warn))",
};

/** One colour for a folder: what most of it is, with stale/fading winning so a problem shows. */
function fillOf(n: ScopedNode): string {
  const touched = n.files - n.counts.new;
  if (n.counts.stale) return FILL.stale;
  if (n.counts.fading) return FILL.fading;
  if (n.counts.understood * 2 >= n.files) return FILL.understood;
  return touched ? FILL.seen : FILL.new;
}

const labelOf = (n: ScopedNode) => (n.kind === "file" ? n.label.split("/").pop()! : `${n.label}/`);
const radius = (n: ScopedNode) => (n.kind === "file" ? Math.min(16, 5 + Math.sqrt(n.fanIn) * 2.5) : Math.min(34, 10 + Math.sqrt(n.files) * 2.2));

/** Lay the nodes out in a worker; null while it works. A newer request makes older replies stale. */
function useLayout(nodes: ScopedNode[], edges: ScopedEdge[]) {
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const [out, setOut] = useState<LayoutOut | null>(null);
  useEffect(() => {
    const w = new Worker(new URL("../lib/layout.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.onmessage = (e: MessageEvent<LayoutOut>) => e.data.id === seq.current && setOut(e.data);
    return () => w.terminate();
  }, []);
  useEffect(() => {
    if (!worker.current || !nodes.length) return;
    const id = ++seq.current;
    setOut(null);
    const msg: LayoutIn = { id, nodes: nodes.map((n) => ({ id: n.id, r: radius(n), w: labelOf(n).length * 3.4 })), links: edges.map((e) => ({ source: e.from, target: e.to, weight: e.weight })) };
    worker.current.postMessage(msg);
  }, [nodes, edges]);
  return out?.pos ?? null;
}

/** A faint map that breathes while the real one is fetched or laid out. */
function Placeholder({ text }: { text: string }) {
  const dots = [[-140, -60, 22], [-40, -110, 14], [70, -70, 26], [160, -10, 12], [110, 80, 18], [-10, 40, 30], [-120, 70, 16], [30, 140, 10], [-200, 10, 10]] as const;
  const lines = [[0, 5], [0, 1], [1, 2], [2, 3], [2, 5], [4, 5], [5, 6], [4, 7], [6, 8], [3, 4]];
  return (
    <div className="relative h-full w-full bg-panel">
      <svg className="h-full w-full animate-pulse" viewBox="-260 -180 520 360">
        {lines.map(([a, b], i) => <line key={i} x1={dots[a][0]} y1={dots[a][1]} x2={dots[b][0]} y2={dots[b][1]} stroke="rgb(var(--muted) / 0.18)" strokeWidth={1.5} />)}
        {dots.map(([x, y, r], i) => <rect key={i} x={x - r} y={y - r} width={r * 2} height={r * 2} rx={r} fill="rgb(var(--muted) / 0.14)" />)}
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="rounded-full bg-raised/90 px-4 py-1.5 text-[13px] text-muted shadow-soft">{text}</div>
      </div>
    </div>
  );
}

/**
 * The import graph at one scope: repos at a multi-repo root, then folders, then files (a folder of
 * LEAF_MAX code files or fewer shows its files). Click a folder to go in, a file to open it.
 */
export function MapPage() {
  const { project, setOpenFile, setSelected } = useProject();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const root = project.root.replace(/\/$/, "");
  const scopeRel = (params.get("in") ?? "").replace(/^\/+|\/+$/g, "");
  const asked = scopeRel ? `${root}/${scopeRel}` : root;
  const goTo = (abs: string | null) => setParams(abs && abs !== root ? { in: abs.slice(root.length + 1) } : {});

  const g = useQuery({ queryKey: ["graph", project.id], queryFn: () => get<Graph>(`/projects/${project.id}/graph`), staleTime: Infinity });
  const prog = useQuery({ queryKey: ["progress", project.id], queryFn: () => get<FileProgress[]>(`/projects/${project.id}/progress`) });
  const reposQ = useQuery({ queryKey: ["repos", project.id, project.contexts], queryFn: () => get<GitRepo[]>(`/projects/${project.id}/repos`) });
  const repos = useMemo(() => reposQ.data ?? [], [reposQ.data]);
  const levels = useMemo(() => new Map((prog.data ?? []).map((p) => [p.path, p.level])), [prog.data]);
  const progress = useMemo(() => new Map((prog.data ?? []).map((p) => [p.path, p])), [prog.data]);
  const files = useMemo(() => (g.data?.nodes ?? []).map((n) => n.path).filter((p) => under(root, p)), [g.data, root]);
  const repoRows = useMemo(() => (repos.length > 1 ? rollup(root, files, progress, repos).filter((r) => r.kind === "repo") : []), [repos, root, files, progress]);
  const sg = useMemo(() => (g.data ? graphAt(asked, g.data, repos, levels) : null), [g.data, asked, repos, levels]);
  const scope = sg?.scope ?? asked;
  const pos = useLayout(sg?.nodes ?? [], sg?.edges ?? []);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      qc.setQueryData(["graph", project.id], await get<Graph>(`/projects/${project.id}/graph?refresh=1`));
    } finally {
      setRefreshing(false);
    }
  };

  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; node: string | null; moved: boolean } | null>(null);
  /** Nodes the user dragged somewhere else; they win over the layout until the scope changes. */
  const [placed, setPlaced] = useState<Record<string, [number, number]>>({});
  const justDragged = useRef(false);
  /** A file shown in the code pane beside the map (Ctrl/Cmd+click opens Explore instead). */
  const [shown, setShown] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 900, h: 600 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [pos, shown]);
  useEffect(() => {
    // A new scope: forget the old zoom, moved nodes, and the hovered node (it is not on screen any more).
    setView({ x: 0, y: 0, k: 1 });
    setPlaced({});
    setHover(null);
  }, [scope]);

  const open = (path: string) => {
    setOpenFile(path);
    setSelected([path]);
    nav(`/p/${project.id}/explore`);
  };
  const act = (n: ScopedNode, e?: { ctrlKey: boolean; metaKey: boolean }) =>
    n.kind !== "file" ? goTo(n.id) : e?.ctrlKey || e?.metaKey ? open(n.id) : setShown(n.id);

  const bar = (
    <ScopeBar className="rounded-none border-x-0 border-t-0" root={root} rootLabel={project.name} scope={scope} repos={repos} repoRows={repoRows} onScope={goTo}>
      {g.data?.builtAt && <span className="text-[12px] text-muted">imports read {relTime(g.data.builtAt)}</span>}
      <Button size="sm" variant="ghost" icon={<RefreshCw className={refreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />} disabled={refreshing || g.isLoading} onClick={refresh}>
        Refresh
      </Button>
    </ScopeBar>
  );

  if (!g.isLoading && !g.data?.nodes.length) {
    return (
      <Empty icon={<MapIcon className="h-6 w-6" />} title="No imports found">
        The map reads import lines in TypeScript, JavaScript and Python files. This folder has none that point to other files in it.
      </Empty>
    );
  }

  const nodes = sg?.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const near = new Set<string>();
  if (hover) for (const e of sg?.edges ?? []) {
    if (e.from === hover) near.add(e.to);
    if (e.to === hover) near.add(e.from);
  }
  const hubs = nodes.filter((n) => n.fanIn > 0).sort((a, b) => b.fanIn - a.fanIn || b.files - a.files).slice(0, 12);
  // A small view labels everything; a busy one only its biggest nodes, plus whatever is hovered.
  const labelled = new Set((nodes.length <= 40 ? nodes : [...nodes].sort((a, b) => b.fanIn + b.files - (a.fanIn + a.files)).slice(0, 14)).map((n) => n.id));
  const nameOf = labelOf;
  const dirs = nodes.filter((n) => n.kind !== "file").length;
  const fileNodes = nodes.length - dirs;
  const imports = (sg?.edges ?? []).reduce((s, e) => s + e.weight, 0);

  let canvas: React.ReactNode;
  if (g.isLoading || refreshing) canvas = <Placeholder text={refreshing ? "Reading imports again…" : "Reading imports…"} />;
  else if (!nodes.length) canvas = <Empty title="Nothing to show">No code files in here import, or are imported by, another file.</Empty>;
  else if (!pos) canvas = <Placeholder text="Drawing the map…" />;
  else {
    const pts = nodes.map((n) => pos[n.id] ?? [0, 0]);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const pad = 90;
    const cw = Math.max(...xs) - Math.min(...xs) + pad * 2;
    const ch = Math.max(...ys) - Math.min(...ys) + pad * 2;
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    // 1 map unit = 1 pixel at zoom 1; a big graph is shrunk to fit, a small one is never blown up.
    // Not below 70% to start with: labels would crowd. Zoom out (or scroll) to see the rest.
    const K = Math.max(0.7, Math.min(1, size.w / cw, size.h / ch)) * view.k;
    const vbW = size.w / K;
    const vbH = size.h / K;
    // Labels keep their on-screen size when the map is shrunk to fit; zooming in still enlarges them.
    const ts = 1 / Math.min(K, 1);
    const zoom = (f: number) => setView((v) => ({ ...v, k: Math.min(6, Math.max(0.2, v.k * f)) }));
    const at = (id: string): [number, number] => placed[id] ?? pos[id] ?? [0, 0];
    const maxW = Math.max(1, ...(sg?.edges ?? []).map((e) => e.weight));
    canvas = (
      <div ref={wrapRef} className="relative h-full bg-panel">
        <svg
          className="h-full w-full cursor-grab active:cursor-grabbing"
          viewBox={`${cx - vbW / 2 + view.x} ${cy - vbH / 2 + view.y} ${vbW} ${vbH}`}
          onWheel={(e) => zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15)}
          onMouseDown={(e) => (drag.current = { x: e.clientX, y: e.clientY, node: null, moved: false })}
          onMouseUp={() => {
            justDragged.current = !!drag.current?.moved;
            drag.current = null;
          }}
          onMouseLeave={() => (drag.current = null)}
          onMouseMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const dx = (e.clientX - d.x) / K;
            const dy = (e.clientY - d.y) / K;
            if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return; // a click, not a drag
            drag.current = { ...d, x: e.clientX, y: e.clientY, moved: true };
            if (d.node) {
              const id = d.node;
              setPlaced((m) => { const [x, y] = m[id] ?? pos[id] ?? [0, 0]; return { ...m, [id]: [x + dx, y + dy] }; });
            } else setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
          }}
        >
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="rgb(var(--muted) / 0.55)" />
            </marker>
            <marker id="arrow-on" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="rgb(var(--accent))" />
            </marker>
          </defs>
          {(sg?.edges ?? []).map((e) => {
            const a = byId.get(e.from)!;
            const b = byId.get(e.to)!;
            const [x1, y1] = at(a.id);
            const [x2, y2] = at(b.id);
            const d = Math.hypot(x2 - x1, y2 - y1) || 1;
            const rb = radius(b) + (b.kind === "file" ? 3 : 6);
            const on = hover === a.id || hover === b.id;
            return (
              <line key={`${e.from}>${e.to}`} x1={x1} y1={y1} x2={x2 - ((x2 - x1) / d) * rb} y2={y2 - ((y2 - y1) / d) * rb}
                stroke={on ? "rgb(var(--accent))" : "rgb(var(--muted) / 0.28)"}
                strokeWidth={(on ? 1.2 : 0.8) + Math.log2(1 + (e.weight / maxW) * 15) * 0.8}
                markerEnd={on ? "url(#arrow-on)" : "url(#arrow)"} opacity={hover && !on ? 0.25 : 1}>
                <title>{`${nameOf(a)} → ${nameOf(b)}: ${e.weight} import${e.weight === 1 ? "" : "s"}`}</title>
              </line>
            );
          })}
          {nodes.map((n) => {
            const [x, y] = at(n.id);
            const r = radius(n);
            const dim = hover && n.id !== hover && !near.has(n.id);
            return (
              <g key={n.id} transform={`translate(${x},${y})`} opacity={dim ? 0.25 : 1} className="cursor-pointer"
                onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  drag.current = { x: e.clientX, y: e.clientY, node: n.id, moved: false };
                }}
                onClick={(e) => {
                  if (justDragged.current) justDragged.current = false;
                  else act(n, e);
                }}>
                {n.id === shown && <circle r={r + 6} fill="none" stroke="rgb(var(--accent))" strokeWidth={2} />}
                {n.kind === "file"
                  ? <circle r={r} fill={n.counts.new ? FILL.new : fillOf(n)} stroke="rgb(var(--panel))" strokeWidth={1.5} />
                  : <>
                      <circle r={r + 3} fill="none" stroke={n.kind === "repo" ? "rgb(var(--accent) / 0.75)" : "rgb(var(--ink) / 0.2)"} strokeWidth={n.kind === "repo" ? 2.5 : 1.5} />
                      <circle r={r} fill={fillOf(n)} stroke="rgb(var(--panel))" strokeWidth={1.5} />
                    </>}
                {n.kind !== "file" && <text textAnchor="middle" dy="0.35em" fontSize={10 * Math.min(ts, r / 9)} className="fill-ink font-mono" opacity={0.7}>{n.files}</text>}
                {(labelled.has(n.id) || n.id === hover) && (
                  <text y={-r - 6 * ts} textAnchor="middle" className="fill-ink font-mono" fontSize={11.5 * ts} paintOrder="stroke" stroke="rgb(var(--panel))" strokeWidth={3 * ts} strokeLinejoin="round">
                    {nameOf(n)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full border-2 border-ink/25" />folder (number = files)</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full border border-muted/50" />file</span>
          {(["new", "seen", "understood", "fading", "stale"] as FileLevel[]).map((l) => (
            <span key={l} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: FILL[l] }} />{l === "new" ? "not yet" : l}</span>
          ))}
          <span>· thicker arrow = more imports · click a folder to go in, a file to read it (Ctrl+click: Explore) · drag a dot to move it</span>
        </div>
        <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-md border border-line bg-panel shadow-soft">
          <button className="grid h-8 w-8 place-items-center text-muted hover:bg-raised hover:text-ink" title="Zoom in" onClick={() => zoom(1.25)}><Plus className="h-4 w-4" /></button>
          <button className="grid h-8 w-8 place-items-center border-y border-line text-muted hover:bg-raised hover:text-ink" title="Zoom out" onClick={() => zoom(1 / 1.25)}><Minus className="h-4 w-4" /></button>
          <button className="grid h-8 w-8 place-items-center text-muted hover:bg-raised hover:text-ink" title="Fit and put dragged dots back"
            onClick={() => { setView({ x: 0, y: 0, k: 1 }); setPlaced({}); }}><Maximize className="h-3.5 w-3.5" /></button>
        </div>
        {hover && byId.get(hover) && (
          <div className="absolute left-3 top-3 rounded-md bg-raised px-2 py-1 font-mono text-xs">
            {byId.get(hover)!.label}{byId.get(hover)!.kind !== "file" && ` · ${byId.get(hover)!.files} files, click to open`}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {bar}
      <div className="flex min-h-0 flex-1">
        {shown ? (
          <Split id="map-code" side="right" initial={520} min={320} max={900} className="h-full w-full" left={canvas}
            right={<CodePane file={shown} onClose={() => setShown(null)} />} />
        ) : (
        <>
        <div className="min-w-0 flex-1">{canvas}</div>
        <aside className="w-[300px] shrink-0 overflow-auto border-l border-line bg-panel p-4">
          <h1 className="text-base font-semibold">Map</h1>
          <p className="text-xs text-muted">
            {sg ? <>
              {dirs > 0 && `${dirs} ${repoRows.length && scope === root ? "repos and folders" : "folders"}`}{dirs > 0 && fileNodes > 0 && ", "}
              {fileNodes > 0 && `${fileNodes} files`}, {imports} imports between them.
              {sg.outside > 0 && ` ${sg.outside} more cross out of this view.`} Folders of {LEAF_MAX} files or fewer show their files.
            </> : "Reading the imports in TypeScript, JavaScript and Python files."}
          </p>
          {hubs.length > 0 && <div className="label mt-4">Most depended on</div>}
          <ol className="space-y-1">
            {hubs.map((n) => (
              <li key={n.id}>
                <button className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-raised" onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onClick={(e) => act(n, e)}>
                  {n.kind === "repo" ? <GitBranch className="h-3.5 w-3.5 shrink-0 text-accent" /> : n.kind === "dir" ? <Folder className="h-3.5 w-3.5 shrink-0 text-muted" /> : <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted" />}
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={n.label}>{n.label}</span>
                  <Badge>{n.fanIn}</Badge>
                </button>
              </li>
            ))}
          </ol>
        </aside>
        </>
        )}
      </div>
    </div>
  );
}
