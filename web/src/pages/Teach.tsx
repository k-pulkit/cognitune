import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, CircleDashed, FileCode2, GraduationCap, RotateCcw, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import type { Teachback } from "@core/types";
import { get, relTime, useJob } from "@/lib/api";
import { useProject } from "@/lib/project";
import { BackLink, useArchive } from "@/components/BackLink";
import { CodePane } from "@/components/CodePane";
import { Split } from "@/components/Split";
import { Badge, Button, Empty, ErrorNote, JobProgress, PageHead, Spinner } from "@/components/ui";

const SCORE_TEXT = ["", "Mostly wrong or empty", "Some right, big gaps", "Right but shallow", "Right, covers what matters", "Right, with the why and the edges"];

/** Your explanation, graded: right, missing, wrong. Then try again in your own words. */
export function TeachPage() {
  const { id = "" } = useParams();
  const { project, rel } = useProject();
  const nav = useNavigate();
  const job = useJob();
  const archive = useArchive(`teachbacks/${id}`);
  const [peek, setPeek] = useState<string | null>(null);
  const [again, setAgain] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["teachback", project.id, id], queryFn: () => get<Teachback>(`/projects/${project.id}/teachbacks/${id}`) });
  if (q.isLoading) return <div className="p-8"><Spinner /></div>;
  if (!q.data) return <Empty title="Teach-back not found" />;
  const t = q.data;
  const g = t.grade;

  const list = (title: string, items: string[], icon: React.ReactNode, tone: string) =>
    items.length > 0 && (
      <section className="mt-6">
        <h2 className={`mb-2 flex items-center gap-1.5 text-sm font-semibold ${tone}`}>{icon} {title}</h2>
        <ul className="space-y-1.5">
          {items.map((x, i) => <li key={i} className="card reading px-4 py-2.5">{x}</li>)}
        </ul>
      </section>
    );

  const doc = (
    <div className="h-full overflow-auto">
      <div className="page">
        <PageHead
          back={<BackLink />}
          badges={<><Badge tone="accent">teach-back</Badge><span className="text-xs text-muted">{relTime(t.createdAt)}</span></>}
          title="Your explanation"
          actions={<Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => archive(nav)}>Archive</Button>}
        />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {t.files.map((f) => (
            <button key={f} onClick={() => setPeek(f)} className="inline-flex items-center gap-1 rounded-md bg-raised px-2 py-1 font-mono text-[12px] hover:text-accent">
              <FileCode2 className="h-3 w-3" /> {rel(f)}
            </button>
          ))}
        </div>
        {g && (
          <div className="card mt-6 flex items-center gap-5 p-5">
            <div className="text-center">
              <div className={`text-4xl font-semibold ${g.score >= 4 ? "text-good" : g.score >= 3 ? "text-warn" : "text-bad"}`}>{g.score}<span className="text-lg text-muted">/5</span></div>
            </div>
            <div>
              <div className="text-sm font-medium">{SCORE_TEXT[g.score]}</div>
              <div className="text-sm text-muted">{g.summary}</div>
              {g.score >= 4 && <div className="mt-1 text-xs text-good">Counts as understood for these files.</div>}
            </div>
          </div>
        )}
        <section className="mt-6">
          <div className="label">What you wrote</div>
          <div className="reading whitespace-pre-wrap rounded-lg bg-raised px-4 py-3">{t.text}</div>
        </section>
        {g && list("Wrong", g.wrong, <CircleAlert className="h-4 w-4" />, "text-bad")}
        {g && list("Missing", g.missing, <CircleDashed className="h-4 w-4" />, "text-warn")}
        {g && list("Right", g.right, <CheckCircle2 className="h-4 w-4" />, "text-good")}

        <section className="mt-10 rounded-xl border border-line bg-raised/50 p-5">
          <div className="text-sm font-semibold">Explain it again</div>
          <p className="mt-0.5 text-sm text-muted">Close this page in your head: write it fresh, without copying the feedback.</p>
          {again === null ? (
            <Button className="mt-3" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setAgain("")}>Try again</Button>
          ) : (
            <>
              <textarea className="input mt-3 min-h-[160px]" value={again} onChange={(e) => setAgain(e.target.value)} autoFocus />
              <Button
                variant="primary"
                className="mt-2"
                icon={<GraduationCap className="h-4 w-4" />}
                disabled={job.busy || again.trim().length < 20}
                onClick={() => job.run(`/projects/${project.id}/teachbacks`, { files: t.files, text: again }, (j) => { setAgain(null); nav(`/p/${project.id}/teach/${j.resultId}`); })}
              >
                Grade this one
              </Button>
            </>
          )}
          {job.busy && job.job && <div className="mt-3"><JobProgress kind="teachback" elapsed={job.elapsed} /></div>}
          {job.error && <div className="mt-3"><ErrorNote error={job.error} onClose={job.clearError} /></div>}
        </section>
      </div>
    </div>
  );
  if (!peek) return doc;
  return <Split id="teach-code" side="right" initial={480} min={300} max={900} className="h-full" left={doc} right={<CodePane file={peek} onClose={() => setPeek(null)} />} />;
}
