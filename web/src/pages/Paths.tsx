import { useState } from "react";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CheckCircle2, Circle, Route, Sparkles, Trash2, X } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { LearningPath, PathStop } from "@core/types";
import { del, get, patch, relTime, useJob } from "@/lib/api";
import { useProject } from "@/lib/project";
import { BackLink } from "@/components/BackLink";
import { Badge, Button, Empty, ErrorNote, JobProgress, PageHead, Spinner } from "@/components/ui";

type PathView = LearningPath & { done: boolean[] };

const ACTIVITY_LABEL: Record<string, string> = { lens: "Read a lens", walk: "Walk through", quiz: "Quiz", teachback: "Teach back" };

/** All paths, and a form to make a new one. */
export function PathsPage() {
  const { project } = useProject();
  const nav = useNavigate();
  const job = useJob();
  const [goal, setGoal] = useState("");
  const list = useQuery({ queryKey: ["paths", project.id], queryFn: () => get<PathView[]>(`/projects/${project.id}/paths`) });
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-8 py-8">
        <h1 className="text-xl font-semibold tracking-tight">Learning paths</h1>
        <p className="text-sm text-muted">An ordered tour of the repo: where to start, what next, and how to check each stop. Stops tick off as you do them.</p>
        <div className="card mt-6 p-5">
          <div className="label">What do you want to be able to do? (optional)</div>
          <input className="input" placeholder="e.g. change how retries work, or review PRs to the scheduler" value={goal} onChange={(e) => setGoal(e.target.value)} />
          <Button variant="primary" className="mt-3" icon={<Sparkles className="h-4 w-4" />} disabled={job.busy}
            onClick={() => job.run(`/projects/${project.id}/paths`, { goal }, (j) => nav(`/p/${project.id}/paths/${j.resultId}`))}>
            Make a path
          </Button>
          {job.busy && job.job && <div className="mt-3"><JobProgress kind="path" elapsed={job.elapsed} /></div>}
          {job.error && <div className="mt-3"><ErrorNote error={job.error} onClose={job.clearError} /></div>}
        </div>
        <div className="mt-6 space-y-2">
          {list.data?.map((p) => {
            const n = p.done.filter(Boolean).length;
            return (
              <Link key={p.id} to={`/p/${project.id}/paths/${p.id}`} className="card flex items-center gap-3 p-4 transition hover:border-accent/40">
                <Route className="h-5 w-5 text-good" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{p.title}</div>
                  <div className="text-xs text-muted">{p.stops.length} stops · {relTime(p.createdAt)}</div>
                </div>
                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-line"><div className="h-full bg-good" style={{ width: `${(n / p.stops.length) * 100}%` }} /></div>
                <span className="w-10 text-right text-xs tabular-nums text-muted">{n}/{p.stops.length}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** One path: the stops in order, each with its activity, editable by hand. */
export function PathPage() {
  const { id = "" } = useParams();
  const { project, rel, setSelected, setOpenFile } = useProject();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["path", project.id, id], queryFn: () => get<PathView>(`/projects/${project.id}/paths/${id}`) });
  const save = useMutation({
    mutationFn: (stops: PathStop[]) => patch<PathView>(`/projects/${project.id}/paths/${id}`, { stops }),
    onSuccess: (p) => qc.setQueryData(["path", project.id, id], p),
  });
  if (q.isLoading) return <div className="p-8"><Spinner /></div>;
  if (!q.data) return <Empty title="Path not found" />;
  const p = q.data;
  const firstOpen = p.done.findIndex((d) => !d);
  const move = (i: number, d: number) => {
    const s = [...p.stops];
    const [x] = s.splice(i, 1);
    s.splice(i + d, 0, x);
    save.mutate(s);
  };
  const doStop = (st: PathStop) => {
    setSelected(st.files);
    setOpenFile(st.files[0]);
    nav(`/p/${project.id}/explore?do=${st.activity === "teachback" ? "teach" : st.activity}`);
  };
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-8 py-8">
        <PageHead
          back={<BackLink to="paths" label="Paths" />}
          badges={<><Badge tone="good">path</Badge><span className="text-xs text-muted">{p.done.filter(Boolean).length}/{p.stops.length} done · {relTime(p.createdAt)}</span></>}
          title={p.title}
          actions={<Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={async () => { await del(`/projects/${project.id}/paths/${p.id}`); nav(`/p/${project.id}/paths`); }}>Archive</Button>}
        />
        <ol className="relative mt-8 space-y-3 border-l-2 border-line pl-6">
          {p.stops.map((st, i) => (
            <li key={`${i}-${st.title}`} className="relative">
              <span className={clsx("absolute -left-[35px] top-4 grid h-5 w-5 place-items-center rounded-full bg-bg", p.done[i] ? "text-good" : i === firstOpen ? "text-accent" : "text-muted")}>
                {p.done[i] ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
              </span>
              <div className={clsx("card group p-4", i === firstOpen && "ring-1 ring-accent/40")}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted">Stop {i + 1} · {ACTIVITY_LABEL[st.activity] ?? st.activity}</div>
                    <div className="font-medium">{st.title}</div>
                  </div>
                  <div className="flex gap-0.5 opacity-0 transition group-hover:opacity-100">
                    <button className="rounded p-1 text-muted hover:bg-raised hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button className="rounded p-1 text-muted hover:bg-raised hover:text-ink disabled:opacity-30" disabled={i === p.stops.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
                    <button className="rounded p-1 text-muted hover:bg-raised hover:text-bad" onClick={() => save.mutate(p.stops.filter((_, j) => j !== i))} aria-label="Remove stop"><X className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                <p className="mt-1 text-[13.5px] text-muted">{st.why}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {st.files.map((f) => <span key={f} className="rounded bg-raised px-1.5 py-0.5 font-mono text-[11px]">{rel(f)}</span>)}
                  <Button size="sm" variant={i === firstOpen ? "primary" : "secondary"} className="ml-auto" onClick={() => doStop(st)}>
                    {p.done[i] ? "Again" : "Do this stop"}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
