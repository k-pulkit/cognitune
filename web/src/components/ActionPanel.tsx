import { useState } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { Compass, Hammer, ListChecks, Plus, Sparkles, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { DiffSpec, LensKind } from "@core/types";
import { get, useJob } from "@/lib/api";
import { useProject } from "@/lib/project";
import { shortPath } from "@/lib/path";
import { ContextPicker } from "./ContextPicker";
import { Button, ErrorNote, JobProgress, Segmented, Tabs } from "./ui";

/** Chips shown before "+N more". */
const FEW = 5;

type Tab = "lens" | "quiz" | "practice";

const LEVELS = [
  { value: 1, label: "1", title: "One short hole" },
  { value: 2, label: "2", title: "A condition and a computation" },
  { value: 3, label: "3", title: "Core logic" },
  { value: 4, label: "4", title: "Whole function bodies" },
] as const;

/**
 * The "do something with these files" panel: make a lens, a quiz or a practice.
 * `files` is the context; `diff` makes the lens and quiz about a change.
 */
export function ActionPanel({
  files, diff, practiceFile, onRemove, onSetFiles,
}: {
  files: string[];
  diff?: DiffSpec;
  practiceFile?: string | null;
  onRemove?: (path: string) => void;
  /** Replace the whole context (from the "Add" picker). Default: the Explore selection. */
  onSetFiles?: (paths: string[]) => void;
}) {
  const { project, rel, toggle, setSelected } = useProject();
  const remove = onRemove ?? ((f: string) => toggle(f, false));
  const setFiles = onSetFiles ?? setSelected;
  const [picking, setPicking] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("lens");
  const [kind, setKind] = useState(diff ? "change" : "explain");
  const [question, setQuestion] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [level, setLevel] = useState(2);
  const job = useJob();
  const kinds = useQuery({ queryKey: ["lens-kinds"], queryFn: () => get<LensKind[]>("/lens-kinds"), staleTime: Infinity });

  const base = `/projects/${project.id}`;
  const noFiles = files.length === 0;

  const makeLens = () =>
    job.run(`${base}/lenses`, { files, kind: question.trim() ? "custom" : kind, question: question.trim() || undefined, diff }, (j) =>
      nav(`/p/${project.id}/lens/${j.resultId}`),
    );
  const makeQuiz = () =>
    job.run(`${base}/quizzes`, { files, diff, count: count ?? undefined }, (j) => nav(`/p/${project.id}/quiz/${j.resultId}`));
  const makePractice = () =>
    practiceFile && job.run(`${base}/practice`, { file: practiceFile, level }, (j) => nav(`/p/${project.id}/practice/${j.resultId}`));

  return (
    <div className="flex h-full flex-col bg-panel">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "lens", label: "Lens", icon: <Compass className="h-4 w-4" /> },
          { value: "quiz", label: "Quiz", icon: <ListChecks className="h-4 w-4" /> },
          { value: "practice", label: "Practice", icon: <Hammer className="h-4 w-4" /> },
        ]}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {tab !== "practice" && (
          <section>
            <div className="label flex items-center gap-1">
              <span>Context · {files.length}</span>
              {diff && <span className="truncate normal-case tracking-normal">· change {diff.base}..{diff.head || "working tree"}</span>}
              <button
                className="ml-auto inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 normal-case tracking-normal text-accent hover:bg-accent/10"
                onClick={() => setPicking(true)}
                title="Add files from the project or a context folder (docs, notes, a session)"
              >
                <Plus className="h-3 w-3" /> Add
              </button>
            </div>
            {noFiles ? (
              <p className="rounded-lg border border-dashed border-line p-3 text-[13px] text-muted">
                Tick files in the tree, open one, or use Add. The model reads only what you pick.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {(showAll ? files : files.slice(0, FEW)).map((f) => (
                  <span key={f} className="group inline-flex max-w-full items-center gap-1 rounded-md bg-raised px-2 py-1 font-mono text-[11px]" title={f}>
                    <span className="truncate">{shortPath(rel(f))}</span>
                    <button className="text-muted hover:text-bad" onClick={() => remove(f)} aria-label="Remove">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {files.length > FEW && (
                  <button className="rounded-md px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/10" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "show less" : `+${files.length - FEW} more`}
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {tab === "lens" && (
          <>
            <section>
              <div className="label">Pick a lens</div>
              <div className="grid grid-cols-1 gap-1.5">
                {(kinds.data ?? []).map((k) => (
                  <button
                    key={k.id}
                    onClick={() => {
                      setKind(k.id);
                      setQuestion("");
                    }}
                    className={clsx(
                      "rounded-lg border px-3 py-2 text-left transition",
                      kind === k.id && !question.trim() ? "border-accent/60 bg-accent/8 ring-1 ring-accent/30" : "border-line hover:border-accent/30 hover:bg-raised",
                    )}
                  >
                    <div className="text-[13px] font-medium">{k.label}</div>
                    <div className="text-xs text-muted">{k.blurb}</div>
                  </button>
                ))}
              </div>
            </section>
            <section>
              <div className="label">Or ask your own question</div>
              <textarea
                className="input min-h-[72px] resize-y"
                placeholder="e.g. Why is the retry here and not in the caller?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </section>
            <Button variant="primary" className="w-full" icon={<Sparkles className="h-4 w-4" />} disabled={noFiles || job.busy} onClick={makeLens}>
              Make the lens
            </Button>
          </>
        )}

        {tab === "quiz" && (
          <>
            <section>
              <div className="label">Questions</div>
              <Segmented
                value={count ?? 0}
                onChange={(v) => setCount(v === 0 ? null : v)}
                options={[{ value: 0, label: "Default" }, { value: 3, label: "3" }, { value: 5, label: "5" }, { value: 8, label: "8" }]}
              />
              <p className="mt-2 text-xs text-muted">Free-text answers. Questions ask about behaviour and reasons, not names. Mark each answer sure or guess.</p>
            </section>
            <Button variant="primary" className="w-full" icon={<ListChecks className="h-4 w-4" />} disabled={noFiles || job.busy} onClick={makeQuiz}>
              Quiz me on {files.length || ""} file{files.length === 1 ? "" : "s"}
            </Button>
          </>
        )}

        {tab === "practice" && (
          <>
            <section>
              <div className="label">File</div>
              {practiceFile ? (
                <div className="truncate rounded-md bg-raised px-2 py-1.5 font-mono text-xs" title={practiceFile}>{rel(practiceFile)}</div>
              ) : (
                <p className="rounded-lg border border-dashed border-line p-3 text-[13px] text-muted">Open a file to practice on it.</p>
              )}
            </section>
            <section>
              <div className="label">Difficulty</div>
              <Segmented value={level} onChange={setLevel} options={LEVELS.map((l) => ({ ...l }))} />
              <p className="mt-2 text-xs text-muted">{LEVELS.find((l) => l.value === level)?.title}. The key lines are cut out of a copy; you write them back here, with hints if you need them. Your folder is not touched.</p>
            </section>
            <Button variant="primary" className="w-full" icon={<Hammer className="h-4 w-4" />} disabled={!practiceFile || job.busy} onClick={makePractice}>
              Make the practice
            </Button>
          </>
        )}

        {job.busy && job.job && <JobProgress kind={job.job.kind} elapsed={job.elapsed} />}
        {job.error && <ErrorNote error={job.error} onClose={job.clearError} />}
      </div>
      {picking && <ContextPicker current={files} onApply={setFiles} onClose={() => setPicking(false)} />}
    </div>
  );
}
