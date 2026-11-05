import { useMemo, useState } from "react";
import clsx from "clsx";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpen, ChevronLeft, ChevronRight, Download, Eye, FileCode2, GitCompareArrows, Layers,
  Lightbulb, ListChecks, PenLine, RefreshCw, Sparkles, Trash2, TriangleAlert,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Card, DeepDive, FileContent, Lens } from "@core/types";
import { del, get, relTime, useJob } from "@/lib/api";
import { useProject } from "@/lib/project";
import { CardDialog } from "@/components/CardDialog";
import { CodePane } from "@/components/CodePane";
import { CodeView } from "@/components/CodeView";
import { Markdown } from "@/components/Markdown";
import { Split } from "@/components/Split";
import { Tracer } from "@/components/Tracer";
import { Badge, Button, Empty, ErrorNote, JobProgress, Segmented, Spinner } from "@/components/ui";

type LensView = Lens & { changed: string[] };

/** Lines a step shows: its range, or a window round the key line (older lenses have only that). */
function range(d: DeepDive): [number, number] | null {
  if (d.startLine && d.endLine) return [d.startLine, d.endLine];
  if (d.line) return [Math.max(1, d.line - 3), d.line + 6];
  return null;
}

/**
 * A lens reads top to bottom like a lesson: the one idea, why it matters, the words you need,
 * the intuition, then a walkthrough where each step shows its own lines of code, a pitfall and a
 * question to check yourself. Read it all at once, or one step at a time.
 */
export function LensPage() {
  const { id = "" } = useParams();
  const { project, rel, setOpenFile, setSelected } = useProject();
  const nav = useNavigate();
  const job = useJob();
  const refresh = useJob();
  const [view, setView] = useState<{ file: string; line?: number } | null>(null);
  const [card, setCard] = useState<Partial<Card> | null>(null);
  const [mode, setMode] = useState<"all" | "step">("all");
  const [step, setStep] = useState(0);
  const lens = useQuery({ queryKey: ["lens", project.id, id], queryFn: () => get<LensView>(`/projects/${project.id}/lenses/${id}`) });
  const l = lens.data;

  // The text of every file a step points at, for the inline snippets.
  const diveFiles = useMemo(() => [...new Set((l?.deepDives ?? []).map((d) => d.file).filter((f): f is string => !!f))], [l]);
  const texts = useQueries({
    queries: diveFiles.map((f) => ({
      queryKey: ["file", project.id, f],
      queryFn: () => get<FileContent>(`/projects/${project.id}/file?path=${encodeURIComponent(f)}`),
      staleTime: 60_000,
    })),
  });
  const fileText = useMemo(() => new Map(diveFiles.map((f, i) => [f, texts[i]?.data])), [diveFiles, texts]);

  if (lens.isLoading) return <div className="p-8"><Spinner /></div>;
  if (!l) return <Empty title="Lens not found" />;

  const show = (file?: string, line?: number) => {
    if (file) setView({ file, line });
  };
  const openInExplore = (file: string) => {
    setSelected([file]);
    setOpenFile(file);
    nav(`/p/${project.id}/explore`);
  };
  const h2 = "mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted";
  const dives = l.deepDives;
  const shownDives = mode === "all" ? dives.map((d, i) => [d, i] as const) : dives[step] ? [[dives[step], step] as const] : [];

  const doc = (
    <div className="h-full overflow-auto">
      <article className="lens mx-auto max-w-[1400px] px-10 py-8">
        <Link to={`/p/${project.id}/library`} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Library
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone="accent">{l.kind} lens</Badge>
          {l.depth && l.depth !== "standard" && <Badge>{l.depth}</Badge>}
          {l.diff && <Badge tone="warn">change {l.diff.base}..{l.diff.head || "working tree"}</Badge>}
          <span className="text-xs text-muted">{relTime(l.createdAt)}</span>
        </div>
        <div className="mt-2 flex items-start gap-2">
          <h1 className="min-w-0 flex-1 text-[26px] font-semibold leading-tight tracking-tight">{l.title}</h1>
          <a href={`/api/projects/${project.id}/lenses/${l.id}/export`} className="mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-raised hover:text-ink" title="Download as markdown">
            <Download className="h-3.5 w-3.5" /> .md
          </a>
        </div>
        <p className="mt-1 text-sm italic text-muted">“{l.question}”</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {l.files.slice(0, 8).map((f) => (
            <button key={f} onClick={() => show(f)} className="inline-flex items-center gap-1 rounded-md bg-raised px-2 py-1 font-mono text-[11px] hover:text-accent">
              <FileCode2 className="h-3 w-3" /> {rel(f)}
            </button>
          ))}
          {l.files.length > 8 && <span className="px-1 py-1 text-[11px] text-muted">+{l.files.length - 8} more</span>}
        </div>

        {l.changed.length > 0 && (
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-warn/40 bg-warn/8 px-4 py-3 text-sm">
            <GitCompareArrows className="h-4 w-4 shrink-0 text-warn" />
            <div className="min-w-0 flex-1">The code changed since this lens was made ({l.changed.map((f) => rel(f)).join(", ")}). It may be out of date.</div>
            <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} disabled={refresh.busy}
              onClick={() => refresh.run(`/projects/${project.id}/lenses/${l.id}/refresh`, {}, (j) => nav(`/p/${project.id}/lens/${j.resultId}`, { replace: true }))}>
              Refresh
            </Button>
          </div>
        )}
        {refresh.busy && refresh.job && <div className="mt-3"><JobProgress kind="lens" elapsed={refresh.elapsed} /></div>}
        {refresh.error && <div className="mt-3"><ErrorNote error={refresh.error} onClose={refresh.clearError} /></div>}

        {/* The one idea */}
        <div className="mt-6 rounded-2xl border border-accent/25 bg-accent/5 p-5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent"><Sparkles className="h-3.5 w-3.5" /> In one sentence</div>
          <p className="mt-1.5 text-[17px] font-medium leading-snug">{l.tldr || l.summary}</p>
          {l.whyItMatters && <p className="mt-2 text-[13.5px] text-muted"><span className="font-medium text-ink/80">Why it matters: </span>{l.whyItMatters}</p>}
        </div>
        {l.tldr && l.summary && <p className="mt-4 text-[15px] leading-relaxed">{l.summary}</p>}

        {l.sketch && (
          <section className="mt-6 rounded-xl border border-line p-4">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><PenLine className="h-4 w-4 text-accent" /> {l.diff ? "Your prediction" : "Your take"} and where it differs</h2>
            <div className="whitespace-pre-wrap rounded-lg bg-raised px-3 py-2 text-[13.5px]">{l.sketch}</div>
            {l.differences && l.differences.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {l.differences.map((d, i) => <li key={i} className="flex gap-2 text-[14px] leading-snug"><span className="text-accent">→</span><span>{d}</span></li>)}
              </ul>
            )}
          </section>
        )}

        {l.concepts.length > 0 && (
          <section className="mt-8">
            <h2 className={h2}><BookOpen className="h-4 w-4" /> Words you need first</h2>
            <div className="lens-concepts grid gap-2">
              {l.concepts.map((c) => (
                <div key={c.term} className="card group p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 text-sm font-semibold">{c.term}</div>
                    {c.file && (
                      <button className="font-mono text-[10.5px] text-muted hover:text-accent" onClick={() => show(c.file, c.line)}>
                        {c.line ? `:${c.line}` : "code"}
                      </button>
                    )}
                    <button
                      className="text-muted opacity-0 transition hover:text-accent group-hover:opacity-100"
                      title="Make a review card"
                      onClick={() => setCard({ kind: "concept", front: `What is "${c.term}" in this code, and why does it matter?`, back: c.explain, file: c.file ?? l.files[0], source: { lensId: l.id } })}
                    >
                      <Layers className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-0.5 text-[13px] leading-snug text-ink/80">{c.explain}</div>
                  {c.example && <div className="mt-1.5 rounded-md bg-raised px-2 py-1 text-[12.5px] italic text-muted">e.g. {c.example}</div>}
                </div>
              ))}
            </div>
          </section>
        )}

        {l.trace && (
          <section className="mt-8">
            <h2 className={h2}>Trace</h2>
            <Tracer trace={l.trace} onStep={(f, line) => show(f ?? l.files[0], line)} />
          </section>
        )}

        {l.intuition && (
          <section className="mt-8">
            <h2 className={h2}><Lightbulb className="h-4 w-4" /> Intuition</h2>
            <Markdown>{l.intuition}</Markdown>
          </section>
        )}

        {dives.length > 0 && (
          <section className="mt-10">
            <div className="mb-4 flex items-center gap-3">
              <h2 className={clsx(h2, "mb-0")}>Walkthrough · {dives.length} steps</h2>
              <div className="ml-auto">
                <Segmented value={mode} onChange={(m) => { setMode(m); setStep(0); }} options={[{ value: "all", label: "All steps" }, { value: "step", label: "One at a time" }]} />
              </div>
            </div>
            {mode === "step" && (
              <div className="mb-4 flex items-center gap-1.5">
                {dives.map((d, i) => (
                  <button key={i} title={d.title} onClick={() => setStep(i)}
                    className={clsx("h-1.5 flex-1 rounded-full transition", i < step ? "bg-accent/50" : i === step ? "bg-accent" : "bg-line")} />
                ))}
              </div>
            )}
            <ol className="space-y-5">
              {shownDives.map(([d, i]) => (
                <Step key={i} d={d} n={i + 1} text={d.file ? fileText.get(d.file) : undefined} rel={rel} onShow={show} />
              ))}
            </ol>
            {mode === "step" && (
              <div className="mt-4 flex items-center justify-between">
                <Button size="sm" variant="ghost" icon={<ChevronLeft className="h-4 w-4" />} disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>
                <span className="text-xs text-muted">Step {step + 1} of {dives.length}</span>
                <Button size="sm" variant={step < dives.length - 1 ? "primary" : "secondary"} disabled={step === dives.length - 1} onClick={() => setStep(step + 1)}>
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </section>
        )}

        {l.gotchas && l.gotchas.length > 0 && (
          <section className="mt-10">
            <h2 className={h2}><TriangleAlert className="h-4 w-4" /> Gotchas</h2>
            <ul className="space-y-1.5">
              {l.gotchas.map((g, i) => <li key={i} className="flex gap-2 rounded-lg border border-warn/25 bg-warn/5 px-3 py-2 text-[13.5px]"><span className="text-warn">!</span><span>{g}</span></li>)}
            </ul>
          </section>
        )}

        {l.nextSteps && l.nextSteps.length > 0 && (
          <section className="mt-10">
            <h2 className={h2}><ArrowRight className="h-4 w-4" /> Read next</h2>
            <div className="space-y-1.5">
              {l.nextSteps.map((s) => (
                <button key={s.file} onClick={() => openInExplore(s.file)} className="card flex w-full items-center gap-3 px-3 py-2 text-left transition hover:border-accent/40">
                  <FileCode2 className="h-4 w-4 shrink-0 text-accent" />
                  <span className="shrink-0 font-mono text-[12px]">{rel(s.file)}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{s.why}</span>
                </button>
              ))}
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
          {card && <CardDialog initial={card} onClose={() => setCard(null)} />}
        </section>
      </article>
    </div>
  );

  return (
    <Split id="lens-file" collapsible startCollapsed openSignal={view} side="right" initial={520} min={320} max={900} className="h-full" left={doc}
      right={<CodePane file={view?.file} line={view?.line} empty="Click a file, a step or a line link to see the whole file here." />} />
  );
}

/** One walkthrough step: the claim, its own lines of code, why, a pitfall, and a question to check yourself. */
function Step({ d, n, text, rel, onShow }: {
  d: DeepDive;
  n: number;
  text?: FileContent;
  rel: (p: string) => string;
  onShow: (file?: string, line?: number) => void;
}) {
  const [answer, setAnswer] = useState(false);
  const r = range(d);
  const snippet = useMemo(() => {
    if (!text || !r) return null;
    const lines = text.text.split("\n");
    const [a, b] = [Math.min(r[0], lines.length), Math.min(r[1], lines.length)];
    return { first: a, body: lines.slice(a - 1, b).join("\n") };
  }, [text, r?.[0], r?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const keyMark = useMemo(() => (d.line ? [{ from: d.line, to: d.line, cls: "hl" }] : []), [d.line]);
  return (
    <li className="card overflow-hidden">
      <div className="flex items-start gap-3 px-5 pt-4">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/12 text-xs font-semibold text-accent">{n}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15.5px] font-semibold leading-snug">{d.title}</h3>
          {d.file && (
            <button className="mt-0.5 font-mono text-[11px] text-muted hover:text-accent" onClick={() => onShow(d.file, d.line)} title="Open the whole file on the right">
              {rel(d.file)}{r ? `:${r[0]}-${r[1]}` : ""}
            </button>
          )}
        </div>
      </div>
      <div className={clsx("lens-step px-5 pb-4 pt-3", snippet && "has-code")}>
        <div className="lens-step-text min-w-0">
          <Markdown>{d.body}</Markdown>
          {d.pitfall && (
            <div className="mt-3 flex gap-2 rounded-lg border border-warn/30 bg-warn/8 px-3 py-2 text-[13.5px]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
              <span><span className="font-medium">Pitfall: </span>{d.pitfall}</span>
            </div>
          )}
        </div>
        {snippet && (
          <div className="lens-step-code min-w-0 max-h-[420px] overflow-auto rounded-lg border border-line bg-panel">
            <CodeView text={snippet.body} lang={text!.lang} firstLine={snippet.first} marks={keyMark} onLineClick={(line) => onShow(d.file, line)} />
          </div>
        )}
      </div>
      {d.check && (
        <div className="border-t border-line bg-raised/40 px-5 py-3">
          <div className="text-[14px]"><span className="font-semibold text-accent">Check yourself: </span>{d.check.q}</div>
          {answer ? (
            <div className="mt-1.5 text-[14px] text-ink/85">{d.check.a}</div>
          ) : (
            <button className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted hover:text-ink" onClick={() => setAnswer(true)}>
              <Eye className="h-3.5 w-3.5" /> Think first, then show the answer
            </button>
          )}
        </div>
      )}
    </li>
  );
}
