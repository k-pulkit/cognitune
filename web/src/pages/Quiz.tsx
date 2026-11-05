import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, CircleHelp, FileCode2, RotateCcw, Send, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Answer, Attempt, FileContent, Quiz } from "@core/types";
import { del, get, relTime, useJob } from "@/lib/api";
import { useProject } from "@/lib/project";
import { CodeView } from "@/components/CodeView";
import { Split } from "@/components/Split";
import { Badge, Button, Empty, ErrorNote, JobProgress, Score, Segmented, Spinner, VerdictBadge } from "@/components/ui";

/**
 * Answer first, then see the grade. The code is one click away but closed by default:
 * the point is to recall, not to look it up.
 */
export function QuizPage() {
  const { id = "" } = useParams();
  const { project, rel } = useProject();
  const nav = useNavigate();
  const job = useJob();
  const quiz = useQuery({ queryKey: ["quiz", project.id, id], queryFn: () => get<Quiz>(`/projects/${project.id}/quizzes/${id}`) });
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [retake, setRetake] = useState(false);
  const [shown, setShown] = useState<number | null>(null);
  const [peek, setPeek] = useState<{ file: string; line?: number } | null>(null);
  const file = useQuery({
    queryKey: ["file", project.id, peek?.file],
    queryFn: () => get<FileContent>(`/projects/${project.id}/file?path=${encodeURIComponent(peek!.file)}`),
    enabled: !!peek,
  });

  const q = quiz.data;
  const attempts = q?.attempts ?? [];
  const last: Attempt | undefined = attempts[attempts.length - 1];
  const viewing: Attempt | undefined = retake ? undefined : shown !== null ? attempts[shown] : last;
  const draftKey = `groklab.quiz.${id}`;

  // Keep unsent answers in this tab so a reload does not lose them.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) setAnswers(JSON.parse(saved));
    } catch {
      /* ignore */
    }
  }, [draftKey]);
  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(answers));
    } catch {
      /* ignore */
    }
  }, [draftKey, answers]);

  const answered = useMemo(() => Object.values(answers).filter((a) => a.answer.trim()).length, [answers]);

  if (quiz.isLoading) return <div className="p-8"><Spinner /></div>;
  if (!q) return <Empty title="Quiz not found" />;

  const set = (qid: string, patch: Partial<Answer>) =>
    setAnswers((a) => ({ ...a, [qid]: { ...(a[qid] ?? { qid, answer: "", sure: false }), ...patch } }));

  const submit = () =>
    job.run(`/projects/${project.id}/quizzes/${q.id}/attempts`, { answers: Object.values(answers) }, () => {
      setRetake(false);
      setShown(null);
      setAnswers({});
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
    });

  const sureWrong = viewing
    ? viewing.grades.filter((g) => g.verdict === "wrong" && viewing.answers.find((a) => a.qid === g.qid)?.sure).length
    : 0;

  const doc = (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-8 py-8">
        <Link to={`/p/${project.id}/library`} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Library
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone="accent">quiz</Badge>
          {q.diff && <Badge tone="warn">change</Badge>}
          <span className="text-xs text-muted">{q.questions.length} questions · {relTime(q.createdAt)}</span>
        </div>
        <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-tight">{q.title}</h1>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {q.files.map((f) => (
            <button key={f} onClick={() => setPeek({ file: f })} className="inline-flex items-center gap-1 rounded-md bg-raised px-2 py-1 font-mono text-[11px] hover:text-accent">
              <FileCode2 className="h-3 w-3" /> {rel(f)}
            </button>
          ))}
        </div>

        {viewing && (
          <div className="card mt-6 flex flex-wrap items-center gap-4 p-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">Score</div>
              <div className="text-3xl"><Score score={viewing.score} /></div>
            </div>
            <div className="text-sm text-muted">
              {viewing.grades.filter((g) => g.verdict === "right").length} right · {viewing.grades.filter((g) => g.verdict === "partial").length} partial ·{" "}
              {viewing.grades.filter((g) => g.verdict === "wrong").length} wrong
              {sureWrong > 0 && <div className="text-bad">{sureWrong} wrong while sure: the best ones to look at.</div>}
            </div>
            {attempts.length > 1 && (
              <div className="ml-auto">
                <Segmented
                  value={shown ?? attempts.length - 1}
                  onChange={(v) => setShown(v)}
                  options={attempts.map((a, i) => ({ value: i, label: `#${i + 1}`, title: `${Math.round(a.score * 100)}% · ${relTime(a.at)}` }))}
                />
              </div>
            )}
          </div>
        )}

        <ol className="mt-6 space-y-4">
          {q.questions.map((qq, i) => {
            const g = viewing?.grades.find((x) => x.qid === qq.id);
            const a = viewing?.answers.find((x) => x.qid === qq.id);
            const draft = answers[qq.id];
            return (
              <li key={qq.id} className={clsx("card p-5", g && (g.verdict === "right" ? "border-good/30" : g.verdict === "partial" ? "border-warn/30" : "border-bad/30"))}>
                <div className="flex items-start gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/10 text-sm font-semibold text-accent">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium leading-snug">{qq.prompt}</div>
                    {qq.file && (
                      <button className="mt-1 font-mono text-[11px] text-muted hover:text-accent" onClick={() => setPeek({ file: qq.file!, line: qq.line })}>
                        {rel(qq.file)}{qq.line ? `:${qq.line}` : ""}
                      </button>
                    )}
                  </div>
                  {g && <VerdictBadge v={g.verdict} />}
                </div>

                {viewing ? (
                  <div className="mt-4 space-y-3 pl-10">
                    <div>
                      <div className="label flex items-center gap-2">
                        Your answer {a?.sure ? <Badge tone="accent">sure</Badge> : <Badge>guess</Badge>}
                      </div>
                      <div className="whitespace-pre-wrap rounded-lg bg-raised px-3 py-2 text-sm">{a?.answer || <span className="text-muted">(no answer)</span>}</div>
                    </div>
                    {g?.feedback && <p className="text-sm">{g.feedback}</p>}
                    {g?.modelAnswer && (
                      <div className="rounded-lg border border-line px-3 py-2 text-sm">
                        <span className="font-medium text-muted">A good answer: </span>
                        {g.modelAnswer}
                      </div>
                    )}
                    {qq.focus && <div className="text-xs text-muted">Tests: {qq.focus}</div>}
                  </div>
                ) : (
                  <div className="mt-4 pl-10">
                    <textarea
                      className="input min-h-[88px] resize-y"
                      placeholder="Your answer, in your own words"
                      value={draft?.answer ?? ""}
                      onChange={(e) => set(qq.id, { answer: e.target.value })}
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <Segmented
                        value={draft?.sure ? "sure" : "guess"}
                        onChange={(v) => set(qq.id, { sure: v === "sure" })}
                        options={[
                          { value: "guess", label: <span className="flex items-center gap-1"><CircleHelp className="h-3.5 w-3.5" />Guess</span> },
                          { value: "sure", label: <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Sure</span> },
                        ]}
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {viewing ? (
            <Button variant="primary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setRetake(true)}>Try again</Button>
          ) : (
            <>
              <Button variant="primary" icon={<Send className="h-4 w-4" />} loading={job.busy} disabled={answered === 0} onClick={submit}>
                Grade my answers ({answered}/{q.questions.length})
              </Button>
              {retake && <Button variant="ghost" onClick={() => setRetake(false)}>Cancel</Button>}
            </>
          )}
          <Button
            variant="ghost"
            className="ml-auto"
            icon={<Trash2 className="h-4 w-4" />}
            onClick={async () => {
              await del(`/projects/${project.id}/quizzes/${q.id}`);
              nav(`/p/${project.id}/library`);
            }}
          >
            Archive
          </Button>
        </div>
        {job.busy && job.job && <div className="mt-3"><JobProgress kind="grade" elapsed={job.elapsed} /></div>}
        {job.error && <div className="mt-3"><ErrorNote error={job.error} onClose={job.clearError} /></div>}
      </div>
    </div>
  );

  if (!peek) return doc;
  return (
    <Split
      id="quiz-code"
      side="right"
      initial={480}
      min={300}
      max={900}
      className="h-full"
      left={doc}
      right={
        <div className="flex h-full flex-col bg-panel">
          <div className="flex items-center border-b border-line px-4 py-2 font-mono text-[12px] text-muted">
            <span className="flex-1 truncate">{rel(peek.file)}{peek.line ? `:${peek.line}` : ""}</span>
            <button className="text-xs hover:text-ink" onClick={() => setPeek(null)}>close</button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">{file.data && <CodeView text={file.data.text} lang={file.data.lang} focusLine={peek.line} />}</div>
        </div>
      }
    />
  );
}
