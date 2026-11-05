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
import { shortPath } from "@/lib/path";
import { CardDialog } from "@/components/CardDialog";
import { CodePane } from "@/components/CodePane";
import { CodeView } from "@/components/CodeView";
import { Inline, Markdown } from "@/components/Markdown";
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
  const dives = l.deepDives;
  const shownDives = mode === "all" ? dives.map((d, i) => [d, i] as const) : dives[step] ? [[dives[step], step] as const] : [];
  /** A section heading, like a blog post's h2. */
  const H2 = ({ icon, children, aside }: { icon?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) => (
    <div className="mb-5 mt-14 flex items-center gap-3">
      <h2 className="flex items-center gap-2 text-[23px] font-semibold tracking-tight">
        {icon && <span className="text-accent">{icon}</span>}
        {children}
      </h2>
      {aside && <div className="ml-auto">{aside}</div>}
    </div>
  );

  // Blog layout: text sits in a centred reading column (.lens > *), figures, cards and code
  // break out wider (.wide). See .lens in index.css.
  const doc = (
    <div className="h-full overflow-auto">
      <article className="lens py-10">
        <Link to={`/p/${project.id}/library`} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Library
        </Link>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Badge tone="accent">{l.kind} lens</Badge>
          {l.depth && l.depth !== "standard" && <Badge>{l.depth}</Badge>}
          {l.diff && <Badge tone="warn">change {l.diff.base}..{l.diff.head || "working tree"}</Badge>}
          <span className="text-[13px] text-muted">{relTime(l.createdAt)}</span>
          <a href={`/api/projects/${project.id}/lenses/${l.id}/export`} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-raised hover:text-ink" title="Download as markdown">
            <Download className="h-3.5 w-3.5" /> .md
          </a>
        </div>
        <h1 className="mt-3 text-[34px] font-bold leading-[1.15] tracking-tight">{l.title}</h1>
        <p className="mt-3 text-[18px] leading-relaxed text-muted">{l.question}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {l.files.slice(0, 6).map((f) => (
            <button key={f} onClick={() => show(f)} title={rel(f)} className="inline-flex max-w-full items-center gap-1 rounded-md bg-raised px-2 py-1 font-mono text-[12px] text-muted hover:text-accent">
              <FileCode2 className="h-3 w-3 shrink-0" /> <span className="truncate">{shortPath(rel(f), 64)}</span>
            </button>
          ))}
          {l.files.length > 6 && <span className="px-1 py-1 text-[12px] text-muted">+{l.files.length - 6} more</span>}
        </div>

        {l.changed.length > 0 && (
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-warn/40 bg-warn/8 px-4 py-3 text-[14px]">
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

        {/* The one idea, as a pull quote */}
        <div className="mt-10 border-l-4 border-accent pl-5">
          <div className="text-[12px] font-semibold uppercase tracking-wider text-accent">The idea in one sentence</div>
          <p className="read-lead mt-2"><Inline>{l.tldr || l.summary}</Inline></p>
        </div>
        {l.whyItMatters && (
          <p className="read mt-6"><strong>Why it matters.</strong> <Inline>{l.whyItMatters}</Inline></p>
        )}
        {l.tldr && l.summary && <div className="mt-5"><Markdown>{l.summary}</Markdown></div>}

        {l.sketch && (
          <div className="mt-8 rounded-2xl bg-raised/70 p-6">
            <div className="flex items-center gap-2 text-[15px] font-semibold"><PenLine className="h-4 w-4 text-accent" /> {l.diff ? "Your prediction" : "Your take"}, and where it differs</div>
            <p className="read mt-3 italic text-muted">“{l.sketch}”</p>
            {l.differences && l.differences.length > 0 && (
              <ul className="read mt-4 space-y-2">
                {l.differences.map((d, i) => <li key={i} className="flex gap-2.5"><span className="mt-0.5 text-accent">→</span><span><Inline>{d}</Inline></span></li>)}
              </ul>
            )}
          </div>
        )}

        {l.concepts.length > 0 && (
          <>
            <H2 icon={<BookOpen className="h-5 w-5" />}>Words you need first</H2>
            <div className="wide lens-concepts grid gap-5">
              {l.concepts.map((c) => (
                <div key={c.term} className="card group flex flex-col p-6">
                  <div className="flex items-baseline gap-2">
                    <div className="flex-1 text-[18px] font-semibold tracking-tight">{c.term}</div>
                    {c.file && (
                      <button className="font-mono text-[12px] text-muted hover:text-accent" onClick={() => show(c.file, c.line)} title="Show in the code">
                        {c.line ? `line ${c.line}` : "code"}
                      </button>
                    )}
                    <button
                      className="self-center text-muted opacity-0 transition hover:text-accent group-hover:opacity-100"
                      title="Make a review card"
                      onClick={() => setCard({ kind: "concept", front: `What is "${c.term}" in this code, and why does it matter?`, back: c.explain, file: c.file ?? l.files[0], source: { lensId: l.id } })}
                    >
                      <Layers className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="read mt-2"><Inline>{c.explain}</Inline></p>
                  {c.example && (
                    <p className="read mt-4 rounded-xl bg-raised/70 px-4 py-3 text-muted">
                      <span className="mr-1.5 text-[12px] font-semibold uppercase tracking-wider text-ink/70">Example</span>
                      <Inline>{c.example}</Inline>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {l.trace && (
          <>
            <H2>Trace a run</H2>
            <div className="wide"><Tracer trace={l.trace} onStep={(f, line) => show(f ?? l.files[0], line)} /></div>
          </>
        )}

        {l.intuition && (
          <>
            <H2 icon={<Lightbulb className="h-5 w-5" />}>The intuition</H2>
            <Markdown>{l.intuition}</Markdown>
          </>
        )}

        {dives.length > 0 && (
          <>
            <H2
              aside={<Segmented value={mode} onChange={(m) => { setMode(m); setStep(0); }} options={[{ value: "all", label: "All steps" }, { value: "step", label: "One at a time" }]} />}
            >
              Walkthrough <span className="text-[17px] font-normal text-muted">· {dives.length} steps</span>
            </H2>
            {mode === "step" && (
              <div className="mb-6 flex items-center gap-1.5">
                {dives.map((d, i) => (
                  <button key={i} title={d.title} onClick={() => setStep(i)}
                    className={clsx("h-1.5 flex-1 rounded-full transition", i < step ? "bg-accent/50" : i === step ? "bg-accent" : "bg-line")} />
                ))}
              </div>
            )}
            <ol className="wide space-y-8">
              {shownDives.map(([d, i]) => (
                <Step key={i} d={d} n={i + 1} text={d.file ? fileText.get(d.file) : undefined} rel={rel} onShow={show} />
              ))}
            </ol>
            {mode === "step" && (
              <div className="mt-6 flex items-center justify-between">
                <Button size="sm" variant="ghost" icon={<ChevronLeft className="h-4 w-4" />} disabled={step === 0} onClick={() => setStep(step - 1)}>Back</Button>
                <span className="text-[13px] text-muted">Step {step + 1} of {dives.length}</span>
                <Button size="sm" variant={step < dives.length - 1 ? "primary" : "secondary"} disabled={step === dives.length - 1} onClick={() => setStep(step + 1)}>
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}

        {l.gotchas && l.gotchas.length > 0 && (
          <>
            <H2 icon={<TriangleAlert className="h-5 w-5" />}>Gotchas</H2>
            <ul className="read space-y-3">
              {l.gotchas.map((g, i) => <li key={i} className="flex gap-3"><span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-warn" /><span><Inline>{g}</Inline></span></li>)}
            </ul>
          </>
        )}

        {l.nextSteps && l.nextSteps.length > 0 && (
          <>
            <H2 icon={<ArrowRight className="h-5 w-5" />}>Read next</H2>
            <div className="space-y-2">
              {l.nextSteps.map((s) => (
                <button key={s.file} onClick={() => openInExplore(s.file)} className="card flex w-full items-start gap-3 px-4 py-3 text-left transition hover:border-accent/40">
                  <FileCode2 className="mt-1 h-4 w-4 shrink-0 text-accent" />
                  <span className="min-w-0">
                    <span className="block font-mono text-[13px]">{rel(s.file)}</span>
                    <span className="read block text-muted"><Inline>{s.why}</Inline></span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        <section className="mt-16 rounded-2xl border border-line bg-raised/50 p-6">
          <div className="text-[17px] font-semibold">Did it land?</div>
          <p className="read mt-1 text-muted">Reading feels like understanding. A quiz on the same files tells you if it is.</p>
          <div className="mt-4 flex flex-wrap gap-2">
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
    <li className={clsx("lens-step", snippet && "has-code")}>
      <div className="lens-step-text min-w-0">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[15px] font-semibold text-accent">{String(n).padStart(2, "0")}</span>
          <h3 className="text-[20px] font-semibold leading-snug tracking-tight">{d.title}</h3>
        </div>
        {d.file && (
          <button className="mt-1 block max-w-full truncate text-left font-mono text-[12px] text-muted hover:text-accent" onClick={() => onShow(d.file, d.line)} title={`${rel(d.file)} (open the whole file on the right)`}>
            {shortPath(rel(d.file), 48)}{r ? `:${r[0]}-${r[1]}` : ""}
          </button>
        )}
        <div className="mt-3"><Markdown>{d.body}</Markdown></div>
        {d.pitfall && (
          <p className="read mt-4 flex gap-2.5 rounded-xl bg-warn/8 px-4 py-3">
            <AlertTriangle className="mt-[0.3em] h-4 w-4 shrink-0 text-warn" />
            <span><strong>Pitfall.</strong> <Inline>{d.pitfall}</Inline></span>
          </p>
        )}
        {d.check && (
          <div className="mt-4 rounded-xl border border-accent/25 px-4 py-3">
            <p className="read"><strong className="text-accent">Check yourself.</strong> <Inline>{d.check.q}</Inline></p>
            {answer ? (
              <p className="read mt-2 text-muted"><Inline>{d.check.a}</Inline></p>
            ) : (
              <button className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink" onClick={() => setAnswer(true)}>
                <Eye className="h-3.5 w-3.5" /> Think first, then show the answer
              </button>
            )}
          </div>
        )}
      </div>
      {snippet && (
        <div className="lens-step-code min-w-0 max-h-[460px] overflow-auto rounded-xl border border-line bg-panel shadow-soft">
          <CodeView text={snippet.body} lang={text!.lang} firstLine={snippet.first} marks={keyMark} onLineClick={(line) => onShow(d.file, line)} />
        </div>
      )}
    </li>
  );
}
