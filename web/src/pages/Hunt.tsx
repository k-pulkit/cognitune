import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug, CheckCircle2, CircleAlert, CircleDashed, Search, Trash2, X } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import type { Hunt, HuntMark } from "@core/types";
import { get, put, relTime, useJob } from "@/lib/api";
import { useProject } from "@/lib/project";
import { BackLink, useArchive } from "@/components/BackLink";
import { CodePane } from "@/components/CodePane";
import { Split } from "@/components/Split";
import { Badge, Button, Empty, ErrorNote, JobProgress, PageHead, Score, Spinner } from "@/components/ui";

const LEVEL = ["", "easy", "medium", "hard"];

/** Read a copy of the file with planted bugs, click the lines you suspect, say why. */
export function HuntPage() {
  const { id = "" } = useParams();
  const { project, rel } = useProject();
  const nav = useNavigate();
  const qc = useQueryClient();
  const job = useJob();
  const archive = useArchive(`hunts/${id}`);
  const q = useQuery({ queryKey: ["hunt", project.id, id], queryFn: () => get<Hunt>(`/projects/${project.id}/hunts/${id}`) });
  const h = q.data;
  const [marks, setMarks] = useState<HuntMark[] | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const saveT = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (h && marks === null) setMarks(h.marks);
  }, [h, marks]);
  const list = marks ?? [];
  const graded = !!h?.grade;

  const save = (next: HuntMark[]) => {
    setMarks(next);
    clearTimeout(saveT.current);
    saveT.current = setTimeout(() => put(`/projects/${project.id}/hunts/${id}/marks`, { marks: next }).catch(() => {}), 400);
  };
  const toggleLine = (line: number) => {
    if (graded) return setFocus(line);
    setFocus(line);
    if (!list.some((m) => m.line === line)) save([...list, { line, why: "" }].sort((a, b) => a.line - b.line));
  };

  const codeMarks = useMemo(() => {
    if (!h) return [];
    const out = list.map((m) => ({ from: m.line, to: m.line, cls: "marked" }));
    if (h.grade) for (const b of h.planted) if (b) out.push({ from: b.line, to: b.line, cls: "bug" });
    return out;
  }, [h, list]);

  if (q.isLoading) return <div className="p-8"><Spinner /></div>;
  if (!h) return <Empty title="Bug hunt not found" />;
  const g = h.grade;
  const bugCount = h.planted.length;

  const doc = (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <PageHead
          back={<BackLink />}
          badges={<><Badge tone="bad"><Bug className="h-3 w-3" /> bug hunt · {LEVEL[h.level]}</Badge><span className="text-xs text-muted">{bugCount} bug{bugCount === 1 ? "" : "s"} planted · {relTime(h.createdAt)}</span></>}
          title={<span className="font-mono text-[20px]">{rel(h.file)}</span>}
          actions={<Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => archive(nav)}>Archive</Button>}
        />
        {!g && (
          <p className="mt-3 text-sm text-muted">
            The code on the right is a copy with {bugCount} planted bug{bugCount === 1 ? "" : "s"}. Click a line you think is wrong, then say what it breaks. Your folder is not touched.
          </p>
        )}

        {g && (
          <div className="card mt-6 flex flex-wrap items-center gap-4 p-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">Score</div>
              <div className="text-3xl"><Score score={g.score} /></div>
            </div>
            <div className="text-sm text-muted">{g.found.length} found · {g.missed.length} missed · {g.falseAlarms.length} false alarm{g.falseAlarms.length === 1 ? "" : "s"}</div>
          </div>
        )}

        {!g && (
          <section className="mt-6 space-y-2">
            <div className="label">Your marks · {list.length}</div>
            {list.map((m, i) => (
              <div key={m.line} className="card p-3">
                <div className="flex items-center gap-2">
                  <button className="font-mono text-xs text-accent hover:underline" onClick={() => setFocus(m.line)}>line {m.line}</button>
                  <button className="ml-auto text-muted hover:text-bad" aria-label="Remove mark" onClick={() => save(list.filter((x) => x.line !== m.line))}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <input
                  className="input mt-2"
                  placeholder="What is wrong, and what does it break?"
                  value={m.why}
                  onChange={(e) => save(list.map((x, j) => (j === i ? { ...x, why: e.target.value } : x)))}
                />
              </div>
            ))}
            {!list.length && <p className="rounded-lg border border-dashed border-line p-3 text-[14px] text-muted">No marks yet. Click a line in the code.</p>}
            <Button
              variant="primary"
              className="mt-2"
              icon={<Search className="h-4 w-4" />}
              disabled={job.busy || !list.length}
              onClick={async () => {
                clearTimeout(saveT.current);
                await put(`/projects/${project.id}/hunts/${id}/marks`, { marks: list });
                job.run(`/projects/${project.id}/hunts/${id}/grade`, {}, () => qc.invalidateQueries({ queryKey: ["hunt", project.id, id] }));
              }}
            >
              Check my hunt
            </Button>
          </section>
        )}

        {g && (
          <>
            {g.found.length > 0 && (
              <section className="mt-6">
                <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-good"><CheckCircle2 className="h-4 w-4" /> Found</h2>
                {g.found.map((f) => <BugCard key={f.line} h={h} line={f.line} what={f.what} feedback={f.feedback} onShow={setFocus} />)}
              </section>
            )}
            {g.missed.length > 0 && (
              <section className="mt-6">
                <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-bad"><CircleDashed className="h-4 w-4" /> Missed</h2>
                {g.missed.map((f) => <BugCard key={f.line} h={h} line={f.line} what={f.what} onShow={setFocus} />)}
              </section>
            )}
            {g.falseAlarms.length > 0 && (
              <section className="mt-6">
                <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-warn"><CircleAlert className="h-4 w-4" /> False alarms</h2>
                {g.falseAlarms.map((f) => (
                  <div key={f.line} className="card mb-2 p-3 text-[14.5px]">
                    <button className="font-mono text-xs text-accent hover:underline" onClick={() => setFocus(f.line)}>line {f.line}</button>
                    <div className="mt-1">{f.feedback || "This line is fine."}</div>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
        {job.busy && job.job && <div className="mt-3"><JobProgress kind="huntgrade" elapsed={job.elapsed} /></div>}
        {job.error && <div className="mt-3"><ErrorNote error={job.error} onClose={job.clearError} /></div>}
      </div>
    </div>
  );
  return (
    <Split id="hunt-code" collapsible side="right" initial={600} min={320} max={1000} className="h-full" left={doc}
      right={<CodePane file={h.file} text={h.text} title={`${rel(h.file)} (copy with bugs)`} line={focus} marks={codeMarks} onLineClick={toggleLine} />} />
  );
}

function BugCard({ h, line, what, feedback, onShow }: { h: Hunt; line: number; what: string; feedback?: string; onShow: (n: number) => void }) {
  const b = h.planted.find((x) => x?.line === line);
  return (
    <div className="card mb-2 p-3 text-[14.5px]">
      <button className="font-mono text-xs text-accent hover:underline" onClick={() => onShow(line)}>line {line}</button>
      {b && (
        <div className="mt-2 overflow-x-auto rounded-md bg-raised font-mono text-[13px]">
          <div className="whitespace-pre px-2 py-1 text-bad">bug  {b.buggy.trim()}</div>
          <div className="whitespace-pre px-2 py-1 text-good">real {b.original.trim()}</div>
        </div>
      )}
      <div className="mt-2">{what}</div>
      {feedback && <div className="mt-1 text-muted">{feedback}</div>}
    </div>
  );
}
