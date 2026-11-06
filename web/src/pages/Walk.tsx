import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { Lightbulb } from "lucide-react";
import { ArrowRight, Check, Footprints, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import type { FileContent, Walk } from "@core/types";
import { get, relTime, useJob } from "@/lib/api";
import { useProject } from "@/lib/project";
import { BackLink, useArchive } from "@/components/BackLink";
import { CodePane } from "@/components/CodePane";
import { CodeView } from "@/components/CodeView";
import { Markdown } from "@/components/Markdown";
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
  const file = useQuery({
    queryKey: ["file", project.id, w?.file],
    enabled: !!w,
    queryFn: () => get<FileContent>(`/projects/${project.id}/file?path=${encodeURIComponent(w!.file)}`),
  });
  const firstOpen = w ? Math.max(0, w.blocks.findIndex((b) => !b.verdict)) : 0;
  const [at, setAt] = useState<number | null>(null);
  const i = at ?? firstOpen;
  const [answer, setAnswer] = useState("");
  useEffect(() => {
    setAnswer("");
  }, [i]);
  const block = useMemo(() => {
    const cur = w?.blocks[i];
    if (!cur || !file.data) return null;
    const lines = file.data.text.split("\n");
    const part = lines.slice(cur.startLine - 1, Math.min(cur.endLine, lines.length));
    const pad = Math.min(...part.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)?.[0].length ?? 0));
    return part.map((l) => l.slice(Number.isFinite(pad) ? pad : 0)).join("\n");
  }, [w, i, file.data]);
  const marks = useMemo(() => (w ? [{ from: w.blocks[i].startLine, to: w.blocks[i].endLine, cls: "block" }] : []), [w, i]);
  if (q.isLoading) return <div className="p-8"><Spinner /></div>;
  if (!w) return <Empty title="Walkthrough not found" />;
  const b = w.blocks[i];
  const done = w.blocks.filter((x) => x.verdict).length;
  const pts = w.blocks.reduce((s, x) => s + (x.verdict === "right" ? 1 : x.verdict === "partial" ? 0.5 : 0), 0);

  const doc = (
    <div className="h-full overflow-auto">
      <div className="page">
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
          <p className="reading mt-1 text-muted">{b.why}</p>
          {block !== null && (
            <div className="mt-5 min-w-0 overflow-hidden rounded-md border border-line bg-panel">
              <div className="border-b border-line bg-raised/60 px-3 py-1.5 font-mono text-[12px] text-muted">{rel(w.file).split("/").slice(-2).join("/")}:{b.startLine}–{b.endLine}</div>
              <div className="lens-step-code"><CodeView text={block} lang={file.data!.lang} firstLine={b.startLine} /></div>
            </div>
          )}
          {b.explain && <div className="mt-5"><Markdown>{b.explain}</Markdown></div>}
          {b.example && (
            <div className="mt-5 rounded-r-lg border-l-[3px] border-good bg-good/5 px-4 py-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-good"><Lightbulb className="h-3.5 w-3.5" /> Try it with real values</div>
              <Markdown>{b.example}</Markdown>
            </div>
          )}
          <div className="mt-5 rounded-lg border border-accent/25 bg-accent/5 p-3 text-[15.5px] font-medium">{b.question}</div>
          {b.verdict ? (
            <div className="mt-4 space-y-2">
              <div className="whitespace-pre-wrap rounded-lg bg-raised px-3 py-2 text-sm">{b.answer || <span className="text-muted">(no answer)</span>}</div>
              {b.feedback && <p className="reading">{b.feedback}</p>}
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
