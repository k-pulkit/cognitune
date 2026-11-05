import { useEffect, useState } from "react";
import clsx from "clsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bug, Compass, Footprints, GraduationCap, Hammer, ListChecks, MessageCircleQuestion, PenLine, Plus, Sparkles, StickyNote, Target, Trash2, X,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { DiffSpec, LensKind, Misconception, Note } from "@core/types";
import { del, get, post, useJob } from "@/lib/api";
import { useProject } from "@/lib/project";
import { shortPath } from "@/lib/path";
import { ContextPicker } from "./ContextPicker";
import { Button, ErrorNote, JobProgress, Segmented } from "./ui";

/** Chips shown before "+N more". */
const FEW = 5;

export type Activity = "lens" | "quiz" | "practice" | "teach" | "walk" | "hunt" | "tutor" | "notes";

const ACTIVITIES: { id: Activity; label: string; icon: typeof Compass; hint: string }[] = [
  { id: "lens", label: "Lens", icon: Compass, hint: "Read an explanation through one question" },
  { id: "quiz", label: "Quiz", icon: ListChecks, hint: "Answer questions in your own words" },
  { id: "teach", label: "Teach", icon: GraduationCap, hint: "Explain it yourself; get graded" },
  { id: "tutor", label: "Tutor", icon: MessageCircleQuestion, hint: "Ask; get questions and hints back" },
  { id: "walk", label: "Walk", icon: Footprints, hint: "One block at a time, with a check each" },
  { id: "practice", label: "Practice", icon: Hammer, hint: "Write the key lines back" },
  { id: "hunt", label: "Bug hunt", icon: Bug, hint: "Find the bugs planted in a copy" },
  { id: "notes", label: "Notes", icon: StickyNote, hint: "Your notes on this file" },
];

/** Activities that work on one open file rather than on the context. */
const ONE_FILE: Activity[] = ["practice", "walk", "hunt", "notes"];

const PRACTICE_LEVELS = [
  { value: 1, label: "1", title: "One short hole" },
  { value: 2, label: "2", title: "A condition and a computation" },
  { value: 3, label: "3", title: "Core logic" },
  { value: 4, label: "4", title: "Whole function bodies" },
] as const;

const HUNT_LEVELS = [
  { value: 1, label: "Easy", title: "One bug, fairly visible" },
  { value: 2, label: "Medium", title: "Two bugs, one needs the logic" },
  { value: 3, label: "Hard", title: "Two or three subtle bugs" },
] as const;

/**
 * The "do something with these files" panel. `files` is the context; `diff` makes the lens and
 * quiz about a change; `practiceFile` is the open file for the one-file activities.
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
  const { project, rel, toggle, setSelected, focusLine } = useProject();
  const remove = onRemove ?? ((f: string) => toggle(f, false));
  const setFiles = onSetFiles ?? setSelected;
  const [params, setParams] = useSearchParams();
  const [picking, setPicking] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const nav = useNavigate();
  const [tab, setTab] = useState<Activity>(() => (ACTIVITIES.some((a) => a.id === params.get("do")) ? (params.get("do") as Activity) : "lens"));
  const [kind, setKind] = useState(diff ? "change" : "explain");
  const [question, setQuestion] = useState("");
  const [sketchFirst, setSketchFirst] = useState(false);
  const [sketch, setSketch] = useState("");
  const [traceInput, setTraceInput] = useState("");
  const [depth, setDepth] = useState<"overview" | "standard" | "deep">("standard");
  const [count, setCount] = useState<number | null>(null);
  const [level, setLevel] = useState(2);
  const [huntLevel, setHuntLevel] = useState(1);
  const [text, setText] = useState("");
  const job = useJob();
  const kinds = useQuery({ queryKey: ["lens-kinds"], queryFn: () => get<LensKind[]>("/lens-kinds"), staleTime: Infinity });
  const weak = useQuery({ queryKey: ["misconceptions", project.id], queryFn: () => get<Misconception[]>(`/projects/${project.id}/misconceptions`) });

  // A link like ?do=walk (from a path stop) opens that activity once.
  useEffect(() => {
    if (!params.get("do")) return;
    const next = new URLSearchParams(params);
    next.delete("do");
    setParams(next, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const base = `/projects/${project.id}`;
  const p = `/p/${project.id}`;
  const noFiles = files.length === 0;
  const oneFile = ONE_FILE.includes(tab);
  const est = useQuery({
    queryKey: ["estimate", project.id, files],
    queryFn: () => post<{ tokens: number; cut: boolean }>(`${base}/estimate`, { files }),
    enabled: !noFiles && !oneFile,
    staleTime: 30_000,
  });

  const makeLens = () =>
    job.run(
      `${base}/lenses`,
      {
        files, kind: question.trim() ? "custom" : kind, question: question.trim() || undefined, diff,
        sketch: sketchFirst ? sketch.trim() || undefined : undefined,
        traceInput: kind === "trace" ? traceInput : undefined,
        depth,
      },
      (j) => nav(`${p}/lens/${j.resultId}`),
    );
  const makeQuiz = (weakOnly = false) =>
    job.run(`${base}/quizzes`, weakOnly ? { files: [], weak: true } : { files, diff, count: count ?? undefined }, (j) => nav(`${p}/quiz/${j.resultId}`));
  const one = (path: string, body: object, to: string) => job.run(`${base}/${path}`, body, (j) => nav(`${p}/${to}/${j.resultId}`));

  const tile = ACTIVITIES.find((a) => a.id === tab)!;
  const openWeak = weak.data?.length ?? 0;

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="grid grid-cols-4 gap-1 border-b border-line p-2">
        {ACTIVITIES.map((a) => (
          <button
            key={a.id}
            onClick={() => setTab(a.id)}
            title={a.hint}
            className={clsx(
              "flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] font-medium transition",
              tab === a.id ? "bg-accent/12 text-accent" : "text-muted hover:bg-raised hover:text-ink",
            )}
          >
            <a.icon className="h-4 w-4" />
            {a.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <p className="-mb-1 text-xs text-muted">{tile.hint}.</p>

        {!oneFile && (
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
            {est.data && (
              <div className={clsx("mt-1.5 text-[11px]", est.data.cut ? "text-warn" : "text-muted")}>
                ~{est.data.tokens.toLocaleString()} tokens{est.data.cut && " · some files do not fit and will be left out"}
              </div>
            )}
          </section>
        )}

        {oneFile && (
          <section>
            <div className="label">File</div>
            {practiceFile ? (
              <div className="truncate rounded-md bg-raised px-2 py-1.5 font-mono text-xs" title={practiceFile}>{rel(practiceFile)}</div>
            ) : (
              <p className="rounded-lg border border-dashed border-line p-3 text-[13px] text-muted">Open a file first.</p>
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
            {kind === "trace" && !question.trim() && (
              <section>
                <div className="label">Input to trace</div>
                <input className="input" placeholder="e.g. add(3)  (empty = the model picks one)" value={traceInput} onChange={(e) => setTraceInput(e.target.value)} />
              </section>
            )}
            <section>
              <div className="label">Depth</div>
              <Segmented
                value={depth}
                onChange={setDepth}
                options={[
                  { value: "overview", label: "Overview", title: "3-4 steps: the big picture in a few minutes" },
                  { value: "standard", label: "Standard", title: "4-7 steps: enough to change it safely" },
                  { value: "deep", label: "Deep", title: "6-10 steps: edge cases, ordering, failure paths" },
                ]}
              />
            </section>
            <section>
              <div className="label">Or ask your own question</div>
              <textarea
                className="input min-h-[64px] resize-y"
                placeholder="e.g. Why is the retry here and not in the caller?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </section>
            <section className="rounded-lg border border-line p-3">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium">
                <input type="checkbox" className="accent-[rgb(var(--accent))]" checked={sketchFirst} onChange={(e) => setSketchFirst(e.target.checked)} />
                <PenLine className="h-3.5 w-3.5 text-accent" />
                {diff ? "Predict first" : "My take first"}
              </label>
              {sketchFirst && (
                <>
                  <textarea
                    className="input mt-2 min-h-[72px] resize-y"
                    placeholder={diff ? "What behaviour changes, and what test or caller would break?" : "In 2-3 lines: what does it do, and how? Where is the risk?"}
                    value={sketch}
                    onChange={(e) => setSketch(e.target.value)}
                  />
                  <p className="mt-1 text-[11px] text-muted">The lens opens with where your take differs. That gap is where the learning is.</p>
                </>
              )}
            </section>
            <Button
              variant="primary"
              className="w-full"
              icon={<Sparkles className="h-4 w-4" />}
              disabled={noFiles || job.busy || (sketchFirst && !sketch.trim())}
              onClick={makeLens}
            >
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
            <Button variant="primary" className="w-full" icon={<ListChecks className="h-4 w-4" />} disabled={noFiles || job.busy} onClick={() => makeQuiz()}>
              Quiz me on {files.length || ""} file{files.length === 1 ? "" : "s"}
            </Button>
            <div className="rounded-lg border border-line p-3">
              <div className="flex items-center gap-2 text-[13px] font-medium"><Target className="h-3.5 w-3.5 text-bad" /> Weak spots · {openWeak}</div>
              <p className="mt-1 text-xs text-muted">New questions aimed at what you got wrong before, from any file. A right answer clears the weak spot.</p>
              <Button className="mt-2 w-full" size="sm" disabled={!openWeak || job.busy} onClick={() => makeQuiz(true)}>Quiz my weak spots</Button>
            </div>
          </>
        )}

        {tab === "teach" && (
          <>
            <section>
              <div className="label">Explain it to a new teammate</div>
              <textarea
                className="input min-h-[180px] resize-y"
                placeholder="What does this code do, how, and why this way? What would surprise someone? Write it before you look anything up."
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted">Graded 1-5 against the code: what you got right, what you missed, what is wrong. 4+ counts as understood.</p>
            </section>
            <Button variant="primary" className="w-full" icon={<GraduationCap className="h-4 w-4" />} disabled={noFiles || job.busy || text.trim().length < 20} onClick={() => one("teachbacks", { files, text }, "teach")}>
              Grade my explanation
            </Button>
          </>
        )}

        {tab === "tutor" && (
          <>
            <section>
              <div className="label">Your question</div>
              <textarea
                className="input min-h-[100px] resize-y"
                placeholder="e.g. Why does this return early here?"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted">The tutor answers with a question or a hint first, and gives more each turn. Ask it to just tell you any time.</p>
            </section>
            <Button variant="primary" className="w-full" icon={<MessageCircleQuestion className="h-4 w-4" />} disabled={noFiles || job.busy || !text.trim()} onClick={() => one("threads", { files, text }, "tutor")}>
              Ask the tutor
            </Button>
          </>
        )}

        {tab === "walk" && (
          <>
            <p className="text-xs text-muted">The file in reading order, one block at a time. Answer a short check on each block before the next.</p>
            <Button variant="primary" className="w-full" icon={<Footprints className="h-4 w-4" />} disabled={!practiceFile || job.busy} onClick={() => one("walks", { file: practiceFile }, "walk")}>
              Walk me through it
            </Button>
          </>
        )}

        {tab === "practice" && (
          <>
            <section>
              <div className="label">Difficulty</div>
              <Segmented value={level} onChange={setLevel} options={PRACTICE_LEVELS.map((l) => ({ ...l }))} />
              <p className="mt-2 text-xs text-muted">{PRACTICE_LEVELS.find((l) => l.value === level)?.title}. The key lines are cut out of a copy; you write them back here, with hints if you need them. Your folder is not touched.</p>
            </section>
            <Button variant="primary" className="w-full" icon={<Hammer className="h-4 w-4" />} disabled={!practiceFile || job.busy} onClick={() => one("practice", { file: practiceFile, level }, "practice")}>
              Make the practice
            </Button>
          </>
        )}

        {tab === "hunt" && (
          <>
            <section>
              <div className="label">Difficulty</div>
              <Segmented value={huntLevel} onChange={setHuntLevel} options={HUNT_LEVELS.map((l) => ({ ...l }))} />
              <p className="mt-2 text-xs text-muted">{HUNT_LEVELS.find((l) => l.value === huntLevel)?.title}. Bugs go into a copy of the file. Click the lines you think are wrong and say why.</p>
            </section>
            <Button variant="primary" className="w-full" icon={<Bug className="h-4 w-4" />} disabled={!practiceFile || job.busy} onClick={() => one("hunts", { file: practiceFile, level: huntLevel }, "hunt")}>
              Start the hunt
            </Button>
          </>
        )}

        {tab === "notes" && practiceFile && <NotesPanel file={practiceFile} line={focusLine} />}

        {job.busy && job.job && <JobProgress kind={job.job.kind} elapsed={job.elapsed} />}
        {job.error && <ErrorNote error={job.error} onClose={job.clearError} />}
      </div>
      {picking && <ContextPicker current={files} onApply={setFiles} onClose={() => setPicking(false)} />}
    </div>
  );
}

/** Notes on one file. A click on a code line picks the line a new note goes on. */
function NotesPanel({ file, line }: { file: string; line: number | null }) {
  const { project, setOpenFile } = useProject();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const notes = useQuery({
    queryKey: ["notes", project.id, file],
    queryFn: () => get<Note[]>(`/projects/${project.id}/notes?file=${encodeURIComponent(file)}`),
  });
  const add = async () => {
    await post(`/projects/${project.id}/notes`, { file, line: line ?? undefined, text });
    setText("");
    qc.invalidateQueries({ queryKey: ["notes", project.id] });
  };
  const list = [...(notes.data ?? [])].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return (
    <>
      <section>
        <div className="label">New note {line ? `on line ${line}` : "on the file"}</div>
        <textarea className="input min-h-[72px] resize-y" placeholder="Click a line in the code to pin the note there." value={text} onChange={(e) => setText(e.target.value)} />
        <Button className="mt-2 w-full" size="sm" disabled={!text.trim()} onClick={add}>Add note</Button>
      </section>
      <section className="space-y-2">
        {list.map((n) => (
          <div key={n.id} className="group rounded-lg border border-line p-2.5 text-[13px]">
            <div className="flex items-center gap-2">
              {n.line ? (
                <button className="font-mono text-[11px] text-accent hover:underline" onClick={() => setOpenFile(file, n.line)}>line {n.line}</button>
              ) : (
                <span className="text-[11px] text-muted">file</span>
              )}
              <button
                className="ml-auto text-muted opacity-0 transition hover:text-bad group-hover:opacity-100"
                onClick={async () => {
                  await del(`/projects/${project.id}/notes/${n.id}`);
                  qc.invalidateQueries({ queryKey: ["notes", project.id] });
                }}
                aria-label="Delete note"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-1 whitespace-pre-wrap">{n.text}</div>
          </div>
        ))}
        {!list.length && <p className="text-xs text-muted">No notes on this file yet.</p>}
      </section>
    </>
  );
}
