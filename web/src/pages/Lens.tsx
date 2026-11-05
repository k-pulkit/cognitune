import { useState } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, FileCode2, Lightbulb, ListChecks, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { FileContent, Lens } from "@core/types";
import { del, get, relTime, useJob } from "@/lib/api";
import { useProject } from "@/lib/project";
import { CodeView } from "@/components/CodeView";
import { Markdown } from "@/components/Markdown";
import { Split } from "@/components/Split";
import { Badge, Button, Empty, ErrorNote, JobProgress, Spinner } from "@/components/ui";

/** A lens reads as: summary, concepts, intuition, then deep dives (closed) that open the code beside it. */
export function LensPage() {
  const { id = "" } = useParams();
  const { project, rel } = useProject();
  const nav = useNavigate();
  const job = useJob();
  const [openDive, setOpenDive] = useState<number | null>(null);
  const [view, setView] = useState<{ file: string; line?: number } | null>(null);
  const lens = useQuery({ queryKey: ["lens", project.id, id], queryFn: () => get<Lens>(`/projects/${project.id}/lenses/${id}`) });
  const file = useQuery({
    queryKey: ["file", project.id, view?.file],
    queryFn: () => get<FileContent>(`/projects/${project.id}/file?path=${encodeURIComponent(view!.file)}`),
    enabled: !!view,
  });

  if (lens.isLoading) return <div className="p-8"><Spinner /></div>;
  if (!lens.data) return <Empty title="Lens not found" />;
  const l = lens.data;

  const show = (file?: string, line?: number) => file && setView({ file, line });

  const doc = (
    <div className="h-full overflow-auto">
      <article className="mx-auto max-w-3xl px-8 py-8">
        <Link to={`/p/${project.id}/library`} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Library
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone="accent">{l.kind} lens</Badge>
          {l.diff && <Badge tone="warn">change {l.diff.base}..{l.diff.head || "working tree"}</Badge>}
          <span className="text-xs text-muted">{relTime(l.createdAt)}</span>
        </div>
        <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-tight">{l.title}</h1>
        <p className="mt-1 text-sm italic text-muted">“{l.question}”</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {l.files.map((f) => (
            <button key={f} onClick={() => show(f)} className="inline-flex items-center gap-1 rounded-md bg-raised px-2 py-1 font-mono text-[11px] hover:text-accent">
              <FileCode2 className="h-3 w-3" /> {rel(f)}
            </button>
          ))}
        </div>

        {l.summary && (
          <div className="mt-6 rounded-xl border border-accent/25 bg-accent/5 p-4 text-[15px] leading-relaxed">{l.summary}</div>
        )}

        {l.concepts.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Concepts</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {l.concepts.map((c) => (
                <div key={c.term} className="card p-3">
                  <div className="text-sm font-semibold">{c.term}</div>
                  <div className="mt-0.5 text-[13px] leading-snug text-muted">{c.explain}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {l.intuition && (
          <section className="mt-8">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted">
              <Lightbulb className="h-4 w-4" /> Intuition
            </h2>
            <Markdown>{l.intuition}</Markdown>
          </section>
        )}

        {l.deepDives.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Deep dives</h2>
            <div className="space-y-2">
              {l.deepDives.map((d, i) => {
                const isOpen = openDive === i;
                return (
                  <div key={i} className={clsx("card overflow-hidden transition", isOpen && "ring-1 ring-accent/30")}>
                    <button
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                      onClick={() => {
                        setOpenDive(isOpen ? null : i);
                        if (!isOpen) show(d.file, d.line);
                      }}
                    >
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-raised text-xs font-semibold text-muted">{i + 1}</span>
                      <span className="flex-1 text-sm font-medium">{d.title}</span>
                      {d.file && <span className="hidden font-mono text-[11px] text-muted sm:inline">{rel(d.file)}{d.line ? `:${d.line}` : ""}</span>}
                      <ChevronDown className={clsx("h-4 w-4 text-muted transition", isOpen && "rotate-180")} />
                    </button>
                    {isOpen && (
                      <div className="border-t border-line px-4 py-3">
                        <Markdown>{d.body}</Markdown>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="mt-10 rounded-xl border border-line bg-raised/50 p-5">
          <div className="text-sm font-semibold">Did it land?</div>
          <p className="mt-0.5 text-sm text-muted">Reading feels like understanding. A quiz on the same files tells you if it is.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon={<ListChecks className="h-4 w-4" />}
              disabled={job.busy}
              onClick={() => job.run(`/projects/${project.id}/quizzes`, { lensId: l.id, files: l.files, diff: l.diff }, (j) => nav(`/p/${project.id}/quiz/${j.resultId}`))}
            >
              Quiz me on this
            </Button>
            <Button
              variant="ghost"
              icon={<Trash2 className="h-4 w-4" />}
              onClick={async () => {
                await del(`/projects/${project.id}/lenses/${l.id}`);
                nav(`/p/${project.id}/library`);
              }}
            >
              Archive
            </Button>
          </div>
          {job.busy && job.job && <div className="mt-3"><JobProgress kind="quiz" elapsed={job.elapsed} /></div>}
          {job.error && <div className="mt-3"><ErrorNote error={job.error} onClose={job.clearError} /></div>}
        </section>
      </article>
    </div>
  );

  const code = (
    <div className="flex h-full flex-col bg-panel">
      {view ? (
        <>
          <div className="border-b border-line px-4 py-2 font-mono text-[12px] text-muted">{rel(view.file)}{view.line ? `:${view.line}` : ""}</div>
          <div className="min-h-0 flex-1 overflow-auto">
            {file.data && <CodeView text={file.data.text} lang={file.data.lang} focusLine={view.line} />}
            {file.error && <div className="p-3"><ErrorNote error={(file.error as Error).message} /></div>}
          </div>
        </>
      ) : (
        <Empty title="Code shows here">Open a deep dive or a file chip to see the code at the line.</Empty>
      )}
    </div>
  );

  return <Split id="lens-code" side="right" initial={520} min={320} max={900} className="h-full" left={doc} right={code} />;
}
