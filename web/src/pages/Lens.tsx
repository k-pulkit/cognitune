import { useMemo, useState } from "react";
import clsx from "clsx";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpen, ChevronLeft, ChevronRight, CornerDownRight, Download, Eye, FileCode2, GitCompareArrows, Layers,
  Lightbulb, ListChecks, Maximize2, MessageSquarePlus, PenLine, RefreshCw, Sparkles, Trash2, TriangleAlert, Wand2,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Card, DeepDive, FileContent, Lens } from "@core/types";
import { del, get, relTime, useJob } from "@/lib/api";
import { useProject } from "@/lib/project";
import { shortPath } from "@/lib/path";
import { CardDialog } from "@/components/CardDialog";
import { CodePane } from "@/components/CodePane";
import { CodeView } from "@/components/CodeView";
import { type CodeLinks, Inline, Markdown } from "@/components/Markdown";
import { embedded, toEditor } from "@/lib/embed";
import { Split } from "@/components/Split";
import { Tracer } from "@/components/Tracer";
import { Badge, Button, Empty, ErrorNote, JobProgress, Modal, Segmented, Spinner } from "@/components/ui";

type LensView = Lens & { changed: string[] };

/** Lines a step shows: its range, or a window round the key line (older lenses have only that). */
function range(d: DeepDive): [number, number] | null {
  if (d.startLine && d.endLine) return [d.startLine, d.endLine];
  if (d.line) return [Math.max(1, d.line - 3), d.line + 6];
  return null;
}

/**
 * The file a lens cites: an exact path (absolute, or relative to the project), else the one known file
 * with that base name or path tail. Ambiguous or unknown names stay plain text: a wrong link is worse.
 */
function resolveCited(path: string, known: string[], root: string): string | undefined {
  const p = path.replace(/^\.\//, "");
  if (known.includes(p)) return p;
  const abs = `${root}/${p}`;
  if (known.includes(abs)) return abs;
  const hits = known.filter((f) => f.endsWith(`/${p}`));
  if (hits.length === 1) return hits[0];
  // A relative path to a file the lens never listed (a caller the model opened): trust a full path.
  return !hits.length && p.includes("/") && !p.startsWith("/") ? abs : undefined;
}

/** A section heading, like a blog post's h2. */
function H2({ icon, children, aside }: { icon?: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-5 mt-16 flex items-center gap-3">
      <h2 className="flex items-center gap-2 text-[22px] font-semibold tracking-[-0.015em]">
        {icon && <span className="text-muted [&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span>}
        {children}
      </h2>
      {aside && <div className="ml-auto">{aside}</div>}
    </div>
  );
}

/**
 * A lens reads top to bottom like a lesson: the one idea, why it matters, the words you need,
 * the intuition, then a walkthrough where each step shows its own lines of code, a pitfall and a
 * question to check yourself. Read it all at once, or one step at a time.
 */
export function LensPage() {
  const { id = "" } = useParams();
  const { project, rel, selected, setOpenFile, setSelected } = useProject();
  const nav = useNavigate();
  const job = useJob();
  const refresh = useJob();
  const more = useJob();
  const [ask, setAsk] = useState("");
  /** The rework panel: null = closed, else the steer being written. */
  const [rework, setRework] = useState<{ steer: string; depth: "overview" | "standard" | "deep" } | null>(null);
  const [withTicked, setWithTicked] = useState(true);
  const [view, setView] = useState<{ file: string; line?: number; to?: number } | null>(null);
  const [card, setCard] = useState<Partial<Card> | null>(null);
  const [mode, setMode] = useState<"all" | "step">("all");
  const [step, setStep] = useState(0);
  const lens = useQuery({ queryKey: ["lens", project.id, id], queryFn: () => get<LensView>(`/projects/${project.id}/lenses/${id}`) });
  const l = lens.data;

  // The text of every file a step points at, for the inline snippets.
  const diveFiles = useMemo(
    () => [...new Set([...(l?.deepDives ?? []), ...(l?.followUps ?? []).flatMap((f) => f.deepDives)].map((d) => d.file).filter((f): f is string => !!f))],
    [l],
  );
  const texts = useQueries({
    queries: diveFiles.map((f) => ({
      queryKey: ["file", project.id, f],
      queryFn: () => get<FileContent>(`/projects/${project.id}/file?path=${encodeURIComponent(f)}`),
      staleTime: 60_000,
    })),
  });
  const fileText = useMemo(() => new Map(diveFiles.map((f, i) => [f, texts[i]?.data])), [diveFiles, texts]);

  // Code citations in the prose become links: click shows the file in the pane on the right;
  // inside VS Code, Ctrl/Cmd+click opens it in the editor instead.
  const known = useMemo(
    () => (l ? [...new Set([...l.files, ...diveFiles, ...(l.nextSteps ?? []).map((n) => n.file), ...l.concepts.flatMap((c) => (c.file ? [c.file] : []))])] : []),
    [l, diveFiles],
  );
  const codeBase = useMemo<CodeLinks>(() => ({
    resolve: (p) => resolveCited(p, known, project.root),
    open: (ref, e) => {
      if (embedded && (e.ctrlKey || e.metaKey)) toEditor({ type: "reveal", path: ref.file, line: ref.from });
      else setView({ file: ref.file, line: ref.from, to: ref.to });
    },
  }), [known, project.root]);
  // Outside a step, a bare line means the lens's file only when there is just one.
  const code = useMemo<CodeLinks>(() => ({ ...codeBase, current: l?.files.length === 1 ? l.files[0] : undefined }), [codeBase, l]);

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
  const extraTicked = selected.filter((f) => !l.files.includes(f));
  const askMore = () =>
    more.run(`/projects/${project.id}/lenses/${l.id}/more`, { question: ask, files: withTicked ? extraTicked : [] }, () => {
      setAsk("");
      void lens.refetch();
    });
  const dives = l.deepDives;
  // Runs of steps that share a part name (older lenses have none).
  const parts = dives.reduce<{ name: string; from: number; to: number }[]>((acc, d, i) => {
    const last = acc[acc.length - 1];
    if (d.part && last?.name === d.part && last.to === i - 1) last.to = i;
    else if (d.part) acc.push({ name: d.part, from: i, to: i });
    return acc;
  }, []);
  const shownDives = mode === "all" ? dives.map((d, i) => [d, i] as const) : dives[step] ? [[dives[step], step] as const] : [];
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
          <button
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-raised hover:text-ink"
            title="Write this lens again with an extra instruction"
            onClick={() => setRework(rework ? null : { steer: l.steer ?? "", depth: l.depth ?? "standard" })}
          >
            <Wand2 className="h-3.5 w-3.5" /> Rework
          </button>
          <a href={`/api/projects/${project.id}/lenses/${l.id}/export`} className=" inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-raised hover:text-ink" title="Download as markdown">
            <Download className="h-3.5 w-3.5" /> .md
          </a>
        </div>
        <h1 className="mt-4 text-[36px] font-bold leading-[1.1] tracking-[-0.02em]">{l.title}</h1>
        <p className="mt-3 text-[16.5px] leading-relaxed text-muted">{l.question}</p>
        {l.steer && !rework && <p className="mt-1 text-[13.5px] text-muted"><span className="font-medium">Steer:</span> {l.steer}</p>}
        {rework && (
          <div className="mt-5 rounded-md border border-line p-4">
            <div className="flex items-center gap-2 text-[15px] font-semibold"><Wand2 className="h-4 w-4 text-accent" /> Rework this lens</div>
            <p className="mt-1 text-[13px] text-muted">Same question and files, written again with your steer. The new lens replaces this one; follow-ups are not carried over.</p>
            <textarea
              className="input mt-3 min-h-[72px] resize-y text-[14px]"
              placeholder="e.g. Lead with the decision. Fewer steps, and leave out the audit model. Explain merge with one example."
              value={rework.steer}
              onChange={(e) => setRework({ ...rework, steer: e.target.value })}
              autoFocus
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Segmented value={rework.depth} onChange={(depth) => setRework({ ...rework, depth })}
                options={[{ value: "overview", label: "Overview" }, { value: "standard", label: "Standard" }, { value: "deep", label: "Deep" }]} />
              <Button variant="primary" size="sm" icon={<Wand2 className="h-3.5 w-3.5" />} disabled={refresh.busy || (!rework.steer.trim() && rework.depth === (l.depth ?? "standard"))}
                onClick={() => refresh.run(`/projects/${project.id}/lenses/${l.id}/refresh`, { steer: rework.steer.trim(), depth: rework.depth }, (j) => {
                  setRework(null);
                  nav(`/p/${project.id}/lens/${j.resultId}`, { replace: true });
                })}>
                Rework lens
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRework(null)}>Cancel</Button>
            </div>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {l.files.slice(0, 6).map((f) => (
            <button key={f} onClick={() => show(f)} title={rel(f)} className="inline-flex max-w-full items-center gap-1 rounded-md bg-ink/5 px-2 py-1 font-mono text-[12px] text-muted hover:text-accent">
              <FileCode2 className="h-3 w-3 shrink-0" /> <span className="truncate">{shortPath(rel(f), 64)}</span>
            </button>
          ))}
          {l.files.length > 6 && <span className="px-1 py-1 text-[12px] text-muted">+{l.files.length - 6} more</span>}
        </div>

        {l.changed.length > 0 && (
          <div className="mt-6 flex items-center gap-3 rounded-md border border-warn/40 bg-warn/8 px-4 py-3 text-[14px]">
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
        <div className="mt-10 border-l-[3px] border-accent py-1 pl-5">
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-accent">The idea in one sentence</div>
          <p className="read-lead mt-2"><Inline code={code}>{l.tldr || l.summary}</Inline></p>
        </div>
        {l.whyItMatters && (
          <p className="read mt-6"><strong>Why it matters.</strong> <Inline code={code}>{l.whyItMatters}</Inline></p>
        )}
        {l.tldr && l.summary && <div className="mt-5"><Markdown code={code}>{l.summary}</Markdown></div>}
        {l.verdict && (
          <div className="mt-6 rounded-md border border-accent/30 bg-accent/5 px-5 py-4">
            <div className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-accent">The answer</div>
            <div className="mt-2"><Markdown code={code}>{l.verdict}</Markdown></div>
          </div>
        )}

        {l.sketch && (
          <div className="mt-8 rounded-md bg-raised/70 p-6">
            <div className="flex items-center gap-2 text-[15px] font-semibold"><PenLine className="h-4 w-4 text-accent" /> {l.diff ? "Your prediction" : "Your take"}, and where it differs</div>
            <p className="read mt-3 italic text-muted">“{l.sketch}”</p>
            {l.differences && l.differences.length > 0 && (
              <ul className="read mt-4 space-y-2">
                {l.differences.map((d, i) => <li key={i} className="flex gap-2.5"><span className="mt-0.5 text-accent">→</span><span><Inline code={code}>{d}</Inline></span></li>)}
              </ul>
            )}
          </div>
        )}

        {l.concepts.length > 0 && (
          <>
            <H2 icon={<BookOpen className="h-5 w-5" />}>Words you need first</H2>
            <div className="wide lens-concepts grid gap-5">
              {l.concepts.map((c) => (
                <ConceptCard
                  key={c.term}
                  c={c}
                  code={codeBase}
                  onShow={() => show(c.file, c.line)}
                  onCard={() => setCard({ kind: "concept", front: `What is "${c.term}" in this code, and why does it matter?`, back: c.explain, file: c.file ?? l.files[0], source: { lensId: l.id } })}
                />
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
            <Markdown code={code}>{l.intuition}</Markdown>
          </>
        )}

        {dives.length > 0 && (
          <>
            <H2
              aside={<Segmented value={mode} onChange={(m) => { setMode(m); setStep(0); }} options={[{ value: "all", label: "All steps" }, { value: "step", label: "One at a time" }]} />}
            >
              Walkthrough <span className="text-[15px] font-normal text-muted">· {dives.length} steps</span>
            </H2>
            {mode === "step" && (
              <div className="mb-6 flex items-center gap-1.5">
                {dives.map((d, i) => (
                  <button key={i} title={d.title} onClick={() => setStep(i)}
                    className={clsx("h-1.5 flex-1 rounded-full transition", i < step ? "bg-accent/50" : i === step ? "bg-accent" : "bg-line")} />
                ))}
              </div>
            )}
            {mode === "all" && parts.length > 1 && (
              <ol className="read mb-10 space-y-1 text-muted">
                {parts.map((p, k) => (
                  <li key={k}><span className="font-medium text-ink">{k + 1}. {p.name}</span> · steps {p.from + 1}{p.to > p.from ? `–${p.to + 1}` : ""}</li>
                ))}
              </ol>
            )}
            <ol className="space-y-12 [&>li+li]:border-t [&>li+li]:border-line [&>li+li]:pt-10">
              {shownDives.map(([d, i]) => (
                <Step key={i} d={d} n={i + 1} text={d.file ? fileText.get(d.file) : undefined} rel={rel} onShow={show} code={codeBase}
                  part={d.part && (mode === "step" || i === 0 || dives[i - 1].part !== d.part) ? `${parts.findIndex((p) => p.from <= i && i <= p.to) + 1}. ${d.part}` : undefined} />
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
              {l.gotchas.map((g, i) => <li key={i} className="flex gap-3"><span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-warn" /><span><Inline code={code}>{g}</Inline></span></li>)}
            </ul>
          </>
        )}

        {l.alsoNoticed && l.alsoNoticed.length > 0 && (
          <details className="mt-12 rounded-md border border-line px-5 py-3">
            <summary className="cursor-pointer text-[15px] font-semibold">Also noticed <span className="font-normal text-muted">· {l.alsoNoticed.length}, not part of the answer</span></summary>
            <ul className="read mt-3 space-y-2">
              {l.alsoNoticed.map((a, i) => <li key={i} className="flex gap-3"><span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-muted" /><span><Inline code={code}>{a}</Inline></span></li>)}
            </ul>
          </details>
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

        {(l.followUps ?? []).length > 0 && (
          <>
            <H2 icon={<CornerDownRight className="h-5 w-5" />}>Follow-ups</H2>
            <div className="space-y-14">
              {l.followUps!.map((f, k) => (
                <div key={k}>
                  <div className="border-l-[3px] border-accent/60 py-1 pl-5">
                    <div className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-accent">You asked · {relTime(f.at)}</div>
                    <p className="read mt-1 font-medium">{f.question}</p>
                    {f.files.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {f.files.map((p) => (
                          <button key={p} onClick={() => show(p)} title={rel(p)} className="inline-flex max-w-full items-center gap-1 rounded-md bg-ink/5 px-2 py-0.5 font-mono text-[11.5px] text-muted hover:text-accent">
                            + <span className="truncate">{shortPath(rel(p), 64)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="mt-5"><Markdown code={code}>{f.answer}</Markdown></div>
                  {f.deepDives.length > 0 && (
                    <ol className="mt-10 space-y-12 [&>li+li]:border-t [&>li+li]:border-line [&>li+li]:pt-10">
                      {f.deepDives.map((d, i) => (
                        <Step key={i} d={d} n={i + 1} text={d.file ? fileText.get(d.file) : undefined} rel={rel} onShow={show} code={codeBase} />
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <section className="mt-16 rounded-md border border-line p-6">
          <div className="flex items-center gap-2 text-[17px] font-semibold"><MessageSquarePlus className="h-4 w-4 text-accent" /> Ask more about this</div>
          <p className="read mt-1 text-muted">The answer is added to this lens, not a new one. New terms and gotchas join the lists above.</p>
          <textarea
            className="input mt-4 min-h-[84px] resize-y text-[14px]"
            placeholder="e.g. How would this change if the caller were an IAM user instead of a role?  Ctrl+Enter to send."
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && ask.trim() && !more.busy) askMore();
            }}
          />
          {extraTicked.length > 0 && (
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[13px] text-muted">
              <input type="checkbox" checked={withTicked} onChange={(e) => setWithTicked(e.target.checked)} />
              Also use {extraTicked.length === 1 ? shortPath(rel(extraTicked[0]), 48) : `the ${extraTicked.length} ticked files`} as context
            </label>
          )}
          <div className="mt-3 flex items-center gap-3">
            <Button variant="primary" icon={<MessageSquarePlus className="h-4 w-4" />} disabled={more.busy || !ask.trim()} onClick={askMore}>Add to lens</Button>
            {extraTicked.length === 0 && <span className="text-[12.5px] text-muted">Tick files in Explore to add them as extra context.</span>}
          </div>
          {more.busy && more.job && <div className="mt-3"><JobProgress kind="lens" elapsed={more.elapsed} /></div>}
          {more.error && <div className="mt-3"><ErrorNote error={more.error} onClose={more.clearError} /></div>}
        </section>

        <section className="mt-16 rounded-md border border-line bg-raised/40 p-6">
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
      right={<CodePane file={view?.file} line={view?.line} marks={view?.line && view.to && view.to > view.line ? [{ from: view.line, to: view.to, cls: "hl" }] : undefined} empty="Click a file, a step or a line link to see the whole file here." />} />
  );
}

/** Last two path parts ("lineage/events.py"): says more than initials. */
/** A concept example: short `code` stays inline; a long `code` span becomes its own wrapped block. */
type Concept = Lens["concepts"][number];

/** A concept card. It lifts on hover; a long one is clipped, and the expand button (or a click on the text) pops it out to read. */
function ConceptCard({ c, onShow, onCard, code: base }: { c: Concept; onShow: () => void; onCard: () => void; code: CodeLinks }) {
  const [open, setOpen] = useState(false);
  const code = useMemo<CodeLinks>(() => ({ ...base, current: c.file }), [base, c.file]);
  const long = c.explain.length + (c.example?.length ?? 0) > 340;
  const body = (clip: boolean) => (
    <>
      <p className={clsx("read-sm mt-2", clip && "line-clamp-5")}><Inline code={code}>{c.explain}</Inline></p>
      {c.example && (
        <div className={clsx("read-sm mt-3 rounded-lg bg-raised/70 px-3.5 py-2.5 text-muted", clip && "max-h-[9.5rem] overflow-hidden")}>
          <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink/70">Example</div>
          <Example text={c.example} />
        </div>
      )}
    </>
  );
  return (
    <>
      <div className="card group flex flex-col p-5 transition duration-150 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-soft">
        <div className="flex items-baseline gap-2">
          <div className="flex-1 text-[16px] font-semibold tracking-tight">{c.term}</div>
          {c.file && (
            <button className="rounded bg-raised px-1.5 py-0.5 font-mono text-[11.5px] text-muted hover:text-accent" onClick={onShow} title="Show in the code">
              {c.line ? `line ${c.line}` : "code"}
            </button>
          )}
          <button className="self-center text-muted opacity-0 transition hover:text-accent group-hover:opacity-100" title="Make a review card" onClick={onCard}>
            <Layers className="h-4 w-4" />
          </button>
          <button
            className={clsx("self-center text-muted transition hover:text-accent", long ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
            title="Open to read" aria-label="Open to read" onClick={() => setOpen(true)}
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
        {body(long)}
        {long && (
          <button className="mt-2 self-start text-[12.5px] text-accent hover:underline" onClick={() => setOpen(true)}>Read all</button>
        )}
      </div>
      {open && (
        <Modal
          wide
          title={c.term}
          onClose={() => setOpen(false)}
          footer={<>
            {c.file && <Button size="sm" variant="ghost" onClick={() => { setOpen(false); onShow(); }}>Show in the code</Button>}
            <Button size="sm" onClick={() => { setOpen(false); onCard(); }}>Make a review card</Button>
          </>}
        >
          <div className="[&_.read-sm]:!text-[16px] [&_.read-sm]:!leading-[1.65]">{body(false)}</div>
        </Modal>
      )}
    </>
  );
}

function Example({ text }: { text: string }) {
  const parts = text.split(/(`[^`]{36,}`)/g).filter((x) => x.replace(/[\s.,;:]+/g, ""));
  return (
    <>
      {parts.map((x, i) =>
        /^`[^`]{36,}`$/.test(x) ? (
          <pre key={i} className="my-2 whitespace-pre-wrap break-words rounded-md border border-line/70 bg-panel px-3 py-2 font-mono text-[12.5px] leading-[1.6] text-ink">
            {x.slice(1, -1)}
          </pre>
        ) : (
          <p key={i}><Inline>{x}</Inline></p>
        ),
      )}
    </>
  );
}

function tail(path: string): string {
  return path.split("/").slice(-2).join("/");
}

/**
 * Where a snippet should start: walk up from the range start to the head of the enclosing block
 * (a def / class / decorator line, or a top-level line), so a card never opens mid-expression.
 */
function blockStart(lines: string[], start: number, key: number): number {
  const indent = (l: string) => /^\s*/.exec(l)?.[0].length ?? 0;
  const keyIndent = indent(lines[key - 1] ?? "");
  for (let n = start; n >= Math.max(1, start - 25); n--) {
    const l = lines[n - 1] ?? "";
    if (!l.trim()) continue;
    const head = /^\s*(def |async def |class |@|function |export |const |func |fn |pub |public |private )/.test(l);
    if ((head && indent(l) <= keyIndent) || indent(l) === 0) return n;
  }
  return start;
}

/** One walkthrough step: the claim, why, its own lines of code, a pitfall, and a question to check yourself. */
function Step({ d, n, text, rel, onShow, code: base, part }: {
  d: DeepDive;
  n: number;
  text?: FileContent;
  rel: (p: string) => string;
  onShow: (file?: string, line?: number) => void;
  code: CodeLinks;
  /** Set on the first step of a part: the part's heading. */
  part?: string;
}) {
  const [answer, setAnswer] = useState(false);
  // In a step, "line 12" and `:12` mean the step's own file.
  const code = useMemo<CodeLinks>(() => ({ ...base, current: d.file }), [base, d.file]);
  const r = range(d);
  const snippet = useMemo(() => {
    if (!text || !r) return null;
    const lines = text.text.split("\n");
    const end = Math.min(r[1], lines.length);
    const first = blockStart(lines, Math.min(r[0], lines.length), d.line ?? r[0]);
    // Drop the indent all lines share, so nested code fits the column without odd wraps.
    const part = lines.slice(first - 1, end);
    const pad = Math.min(...part.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)?.[0].length ?? 0));
    const body = part.map((l) => l.slice(Number.isFinite(pad) ? pad : 0)).join("\n");
    return { first, last: end, body };
  }, [text, r?.[0], r?.[1], d.line]); // eslint-disable-line react-hooks/exhaustive-deps
  const keyMark = useMemo(() => (d.line ? [{ from: d.line, to: d.line, cls: "hl" }] : []), [d.line]);
  return (
    <li className="lens-step">
      {part && <div className="lens-part text-[12px] font-semibold uppercase tracking-[0.08em] text-accent">{part}</div>}
      <div className="min-w-0">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[13px] font-semibold tabular-nums text-accent/80">{String(n).padStart(2, "0")}</span>
          <h3 className="text-[18px] font-semibold leading-[1.3] tracking-tight">{d.title}</h3>
        </div>
        <div className="mt-3"><Markdown code={code}>{d.body}</Markdown></div>
      </div>
      {snippet && d.file && (
        <div className="min-w-0 overflow-hidden rounded-md border border-line bg-panel">
          <div className="flex items-center justify-between gap-3 border-b border-line bg-raised/60 px-3 py-1.5 font-mono text-[12px] text-muted">
            <span className="truncate" title={rel(d.file)}>{tail(rel(d.file))}:{snippet.first}–{snippet.last}</span>
            <button className="shrink-0 font-sans hover:text-accent" onClick={() => onShow(d.file, d.line)}>open file</button>
          </div>
          <div className="lens-step-code">
            <CodeView text={snippet.body} lang={text!.lang} firstLine={snippet.first} marks={keyMark} onLineClick={(line) => onShow(d.file, line)} />
          </div>
        </div>
      )}
      {d.pitfall && (
        <p className="read-sm flex gap-2.5 rounded-r-lg border-l-[3px] border-warn bg-warn/5 px-4 py-3">
          <AlertTriangle className="mt-[0.25em] h-4 w-4 shrink-0 text-warn" />
          <span><strong>Pitfall.</strong> <Inline code={code}>{d.pitfall}</Inline></span>
        </p>
      )}
      {d.check && (
        <div className="read-sm rounded-r-lg border-l-[3px] border-accent bg-accent/5 px-4 py-3">
          <p><strong className="text-accent">Check yourself.</strong> <Inline code={code}>{d.check.q}</Inline></p>
          {answer ? (
            <p className="mt-3 border-t border-line/70 pt-3 text-ink/85"><Inline code={code}>{d.check.a}</Inline></p>
          ) : (
            <button className="mt-2 inline-flex items-center gap-1.5 font-sans text-[13px] text-muted hover:text-ink" onClick={() => setAnswer(true)}>
              <Eye className="h-3.5 w-3.5" /> Think first, then show the answer
            </button>
          )}
        </div>
      )}
    </li>
  );
}
