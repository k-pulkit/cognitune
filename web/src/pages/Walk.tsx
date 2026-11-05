import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Footprints, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import type { Walk } from "@core/types";
import { get, relTime, useJob } from "@/lib/api";
import { useProject } from "@/lib/project";
import { BackLink, useArchive } from "@/components/BackLink";
import { CodePane } from "@/components/CodePane";
import { Split } from "@/components/Split";
import { Badge, Button, Empty, ErrorNote, JobProgress, PageHead, Spinner, VerdictBadge } from "@/components/ui";

/** A file in reading order, one block at a time, with a check question per block. */
export function WalkPage() {
  const { id = "" } = useParams();
  const { project, rel } = useProject();
  const nav = useNavigate();
  const job = useJob();
  const archive = useArchive(`walks/${id}`);
  const q = useQuery({ queryKey: ["walk", project.id, id], queryFn: () => get<Walk>(`/projects/${project.id}/walks/${id}`) });
  const w = q.data;
  const firstOpen = w ? Math.max(0, w.blocks.findIndex((b) => !b.verdict)) : 0;
  const [at, setAt] = useState<number | null>(null);
  const i = at ?? firstOpen;
  const [answer, setAnswer] = useState("");
  useEffect(() => {
    setAnswer("");
  }, [i]);
  const marks = useMemo(() => (w ? [{ from: w.blocks[i].startLine, to: w.blocks[i].endLine, cls: "block" }] : []), [w, i]);
  if (q.isLoading) return <div className="p-8"><Spinner /></div>;
  if (!w) return <Empty title="Walkthrough not found" />;
  const b = w.blocks[i];
  const done = w.blocks.filter((x) => x.verdict).length;
  const pts = w.blocks.reduce((s, x) => s + (x.verdict === "right" ? 1 : x.verdict === "partial" ? 0.5 : 0), 0);

  const doc = (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <PageHead
          back={<BackLink />}
          badges={<><Badge tone="accent">walkthrough</Badge><span className="text-xs text-muted">{done}/{w.blocks.length} checked · {relTime(w.createdAt)}</span></>}
          title={<span className="font-mono text-[20px]">{rel(w.file)}</span>}
          actions={<Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => archive(nav)}>Archive</Button>}
        />
        <div className="mt-5 flex gap-1">
          {w.blocks.map((x, j) => (
            <button
              key={j}
              title={x.title}
              onClick={() => setAt(j)}
              className={clsx(
                "h-2 flex-1 rounded-full transition",
                x.verdict === "right" ? "bg-good" : x.verdict === "partial" ? "bg-warn" : x.verdict === "wrong" ? "bg-bad" : "bg-line",
                j === i && "ring-2 ring-accent/40 ring-offset-2 ring-offset-bg",
              )}
            />
          ))}
        </div>

        <div className="card mt-6 p-6">
          <div className="flex items-center gap-2 text-xs text-muted">
            Block {i + 1} of {w.blocks.length} · lines {b.startLine}-{b.endLine}
            {b.verdict && <span className="ml-auto"><VerdictBadge v={b.verdict} /></span>}
          </div>
          <h2 className="mt-1 text-lg font-semibold">{b.title || `Block ${i + 1}`}</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">{b.why}</p>
          <div className="mt-5 rounded-lg border border-accent/25 bg-accent/5 p-3 text-[14.5px] font-medium">{b.question}</div>
          {b.verdict ? (
            <div className="mt-4 space-y-2">
              <div className="whitespace-pre-wrap rounded-lg bg-raised px-3 py-2 text-sm">{b.answer || <span className="text-muted">(no answer)</span>}</div>
              {b.feedback && <p className="text-sm">{b.feedback}</p>}
            </div>
          ) : (
            <>
              <textarea className="input mt-4 min-h-[88px]" placeholder="Your answer, from the block on the right" value={answer} onChange={(e) => setAnswer(e.target.value)} />
              <Button
                variant="primary"
                className="mt-3"
                icon={<Check className="h-4 w-4" />}
                disabled={job.busy || !answer.trim()}
                onClick={() => {
                  setAt(i); // stay on this block to read the feedback
                  job.run(`/projects/${project.id}/walks/${w.id}/blocks/${i}`, { answer });
                }}
              >
                Check
              </Button>
            </>
          )}
          {job.busy && job.job && <div className="mt-3"><JobProgress kind="walkcheck" elapsed={job.elapsed} /></div>}
          {job.error && <div className="mt-3"><ErrorNote error={job.error} onClose={job.clearError} /></div>}
          <div className="mt-5 flex justify-end">
            {i < w.blocks.length - 1 && (
              <Button size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />} onClick={() => setAt(i + 1)}>Next block</Button>
            )}
          </div>
        </div>

        {done === w.blocks.length && (
          <div className="card mt-6 flex items-center gap-3 border-good/30 p-4">
            <Footprints className="h-5 w-5 text-good" />
            <div className="text-sm">Walk done: {Math.round((pts / w.blocks.length) * 100)}% of the checks right. Next, try explaining the file in your own words (Teach) or hunt a bug in it.</div>
          </div>
        )}
      </div>
    </div>
  );
  return <Split id="walk-code" collapsible side="right" initial={560} min={320} max={960} className="h-full" left={doc} right={<CodePane file={w.file} line={b.startLine} marks={marks} />} />;
}
