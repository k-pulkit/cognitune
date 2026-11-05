import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Flame, Layers, Map as MapIcon, Route, Sparkles, Target, TimerReset } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import type { Today } from "@core/types";
import { get, relTime, useJob } from "@/lib/api";
import { useProject } from "@/lib/project";
import { Badge, Button, ErrorNote, JobProgress, Spinner } from "@/components/ui";

/** What to do now: due cards, weak spots, fading files, the next stop on a path. */
export function TodayPage() {
  const { project, rel, setSelected, setOpenFile } = useProject();
  const nav = useNavigate();
  const job = useJob();
  const q = useQuery({ queryKey: ["today", project.id], queryFn: () => get<Today>(`/projects/${project.id}/today`) });
  const p = `/p/${project.id}`;
  if (q.isLoading) return <div className="p-8"><Spinner /></div>;
  if (!q.data) return q.error ? <div className="p-8"><ErrorNote error={(q.error as Error).message} /></div> : null;
  const t = q.data;

  /** Open Explore with these files ticked and an activity tab chosen. */
  const go = (files: string[], activity: string) => {
    if (activity === "review") return nav(`${p}/review`);
    if (activity === "weak") return job.run(`/projects/${project.id}/quizzes`, { files: [], weak: true }, (j) => nav(`${p}/quiz/${j.resultId}`));
    setSelected(files);
    if (files[0]) setOpenFile(files[0]);
    const tab = activity === "teachback" ? "teach" : activity;
    nav(`${p}/explore?do=${tab}`);
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <span className="text-sm text-muted">{project.name}</span>
          {t.streak > 0 && (
            <Badge tone="warn" className="ml-auto"><Flame className="h-3.5 w-3.5" /> {t.streak} day{t.streak === 1 ? "" : "s"} in a row</Badge>
          )}
        </div>

        {t.suggestion && (
          <div className="card mt-6 flex items-center gap-4 border-accent/30 bg-accent/5 p-5">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent"><Sparkles className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium uppercase tracking-wide text-accent">Suggested next, about 10 minutes</div>
              <div className="mt-0.5 text-[16px]">{t.suggestion.text}</div>
            </div>
            <Button variant="primary" icon={<ArrowRight className="h-4 w-4" />} disabled={job.busy} onClick={() => go(t.suggestion!.files, t.suggestion!.activity)}>Start</Button>
          </div>
        )}
        {job.busy && job.job && <div className="mt-3"><JobProgress kind={job.job.kind} elapsed={job.elapsed} /></div>}
        {job.error && <div className="mt-3"><ErrorNote error={job.error} onClose={job.clearError} /></div>}

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <section className="card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold"><Layers className="h-4 w-4 text-accent" /> Review cards</div>
            <div className="mt-3 flex items-end gap-3">
              <div className="text-4xl font-semibold tabular-nums">{t.due}</div>
              <div className="pb-1 text-sm text-muted">due now{t.newCards ? ` · ${t.newCards} never seen` : ""}</div>
            </div>
            <Button className="mt-4" size="sm" disabled={!t.due} onClick={() => nav(`${p}/review`)}>Start review</Button>
          </section>

          <section className="card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold"><Target className="h-4 w-4 text-bad" /> Weak spots</div>
            {t.weak.length ? (
              <ul className="mt-3 space-y-2">
                {t.weak.map((m) => (
                  <li key={m.id} className="text-[14px] leading-snug">
                    {m.text}
                    <span className="ml-1 text-[12px] text-muted">
                      {m.file && `· ${rel(m.file)}`}{m.seen > 1 && ` · seen ${m.seen}×`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted">None open. Wrong answers in quizzes, teach-backs and walkthroughs show up here.</p>
            )}
            <Button className="mt-4" size="sm" disabled={!t.weak.length || job.busy} onClick={() => go([], "weak")}>Quiz my weak spots</Button>
          </section>

          <section className="card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold"><TimerReset className="h-4 w-4 text-warn" /> Needs a refresh</div>
            {t.attention.length ? (
              <ul className="mt-3 space-y-1.5">
                {t.attention.map((f) => (
                  <li key={f.path} className="flex items-center gap-2 text-[14px]">
                    <button className="min-w-0 flex-1 truncate text-left font-mono text-[13px] hover:text-accent" onClick={() => go([f.path], "quiz")}>{rel(f.path)}</button>
                    <Badge tone="warn">{f.level}</Badge>
                    {f.lastRetrieval && <span className="text-[12px] text-muted">{relTime(f.lastRetrieval)}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted">Nothing stale or fading. Files you passed come back here when the code changes or a few weeks go by.</p>
            )}
          </section>

          <section className="card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold"><Route className="h-4 w-4 text-good" /> Learning path</div>
            {t.nextStop ? (
              <>
                <div className="mt-3 text-xs text-muted">{t.nextStop.title} · stop {t.nextStop.index + 1}</div>
                <div className="mt-0.5 text-[16px] font-medium">{t.nextStop.stop.title}</div>
                <p className="mt-1 text-[14px] text-muted">{t.nextStop.stop.why}</p>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => go(t.nextStop!.stop.files, t.nextStop!.stop.activity)}>Do this stop</Button>
                  <Link to={`${p}/paths/${t.nextStop.pathId}`} className="inline-flex items-center text-xs text-muted hover:text-ink">see the path</Link>
                </div>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm text-muted">A path is an ordered tour of the repo: where to start, what next, and how to check each stop.</p>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" onClick={() => nav(`${p}/paths`)}>Make a path</Button>
                  <Button size="sm" variant="ghost" icon={<MapIcon className="h-3.5 w-3.5" />} onClick={() => nav(`${p}/map`)}>See the map</Button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
