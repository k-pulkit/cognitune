import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { languages } from "@codemirror/language-data";
import { LanguageDescription } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { ArrowLeft, Check, Eye, EyeOff, Lightbulb, RotateCcw, Send, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Practice } from "@core/types";
import { del, get, put, relTime, useJob } from "@/lib/api";
import { useProject } from "@/lib/project";
import { useIsDark } from "@/lib/theme";
import { CodeView } from "@/components/CodeView";
import { Split } from "@/components/Split";
import { Badge, Button, Empty, ErrorNote, JobProgress, Spinner, VerdictBadge } from "@/components/ui";

/** CodeMirror language for a file name, loaded on demand. */
function useLanguage(file: string | undefined): Extension[] {
  const [ext, setExt] = useState<Extension[]>([]);
  useEffect(() => {
    if (!file) return;
    const desc = LanguageDescription.matchFilename(languages, file.split("/").pop() ?? "");
    if (!desc) return;
    let live = true;
    desc.load().then((support) => live && setExt([support]));
    return () => {
      live = false;
    };
  }, [file]);
  return ext;
}

/**
 * Write the missing code back. Edits autosave (debounced). Hints open one at a time.
 * "Check my work" sends the file to the model; the original stays hidden until you ask.
 */
export function PracticePage() {
  const { id = "" } = useParams();
  const { project, rel } = useProject();
  const qc = useQueryClient();
  const nav = useNavigate();
  const dark = useIsDark();
  const job = useJob();
  const pr = useQuery({ queryKey: ["practice", project.id, id], queryFn: () => get<Practice>(`/projects/${project.id}/practice/${id}`) });
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const [hintsShown, setHintsShown] = useState<Record<number, number>>({});
  const [showOriginal, setShowOriginal] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const lang = useLanguage(pr.data?.file);

  useEffect(() => {
    if (pr.data && text === null) setText(pr.data.attempt);
  }, [pr.data, text]);

  const save = async (value: string) => {
    await put(`/projects/${project.id}/practice/${id}/attempt`, { text: value });
    setSaved(true);
  };
  const onChange = (v: string) => {
    setText(v);
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(v), 800);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const extensions = useMemo(() => [...lang], [lang]);
  const p = pr.data;
  if (pr.isLoading) return <div className="p-8"><Spinner /></div>;
  if (!p) return <Empty title="Practice not found" />;

  const marks = p.holes.map((h) => ({ from: h.startLine, to: h.endLine, cls: "hole" }));
  const reviewOf = (hid: number) => p.review?.holes.find((r) => r.id === hid);

  const check = async () => {
    clearTimeout(timer.current);
    if (text !== null) await save(text);
    job.run(`/projects/${project.id}/practice/${id}/review`, {}, () => qc.invalidateQueries({ queryKey: ["practice", project.id, id] }));
  };

  const side = (
    <div className="flex h-full flex-col bg-panel">
      <div className="border-b border-line p-4">
        <Link to={`/p/${project.id}/library`} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Library
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <Badge tone="accent">practice · level {p.level}</Badge>
          <span className="text-xs text-muted">{relTime(p.createdAt)}</span>
        </div>
        <div className="mt-1.5 truncate font-mono text-[14px]" title={p.file}>{rel(p.file)}</div>
        <p className="mt-2 text-xs text-muted">
          Find each <span className="font-mono">HOLE</span> line in the editor and write the code it needs. Pseudo-code is fine if the logic is right.
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
        {p.review?.summary && <div className="rounded-lg border border-accent/25 bg-accent/5 p-3 text-sm">{p.review.summary}</div>}
        {p.holes.map((h) => {
          const n = hintsShown[h.id] ?? 0;
          const r = reviewOf(h.id);
          return (
            <div key={h.id} className={clsx("card p-3", r && (r.verdict === "right" ? "border-good/30" : r.verdict === "partial" ? "border-warn/30" : "border-bad/30"))}>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-warn/15 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-warn">HOLE {h.id}</span>
                <span className="text-[12px] text-muted">{h.endLine - h.startLine + 1} line{h.endLine > h.startLine ? "s" : ""} cut</span>
                {r && <span className="ml-auto"><VerdictBadge v={r.verdict} /></span>}
              </div>
              <p className="mt-2 text-sm">{h.intent}</p>
              {h.hints.slice(0, n).map((hint, i) => (
                <div key={i} className="mt-2 flex gap-2 rounded-md bg-raised px-2.5 py-1.5 text-[14px]">
                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" /> {hint}
                </div>
              ))}
              {n < h.hints.length && (
                <button className="mt-2 text-xs font-medium text-accent hover:underline" onClick={() => setHintsShown((s) => ({ ...s, [h.id]: n + 1 }))}>
                  {n === 0 ? "Show a hint" : "Another hint"} ({n}/{h.hints.length})
                </button>
              )}
              {r?.feedback && <p className="mt-2 border-t border-line pt-2 text-[14px] text-muted">{r.feedback}</p>}
            </div>
          );
        })}
      </div>
      <div className="space-y-2 border-t border-line p-4">
        {job.busy && job.job && <JobProgress kind="review" elapsed={job.elapsed} />}
        {job.error && <ErrorNote error={job.error} onClose={job.clearError} />}
        <Button variant="primary" className="w-full" icon={<Send className="h-4 w-4" />} loading={job.busy} onClick={check}>
          Check my work
        </Button>
        <div className="flex gap-2">
          <Button className="flex-1" size="sm" icon={showOriginal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} onClick={() => setShowOriginal((s) => !s)}>
            {showOriginal ? "Hide original" : "Show original"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            title="Start over from the holes"
            onClick={() => {
              setText(p.holed);
              save(p.holed);
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            title="Archive"
            onClick={async () => {
              await del(`/projects/${project.id}/practice/${p.id}`);
              nav(`/p/${project.id}/library`);
            }}
          />
        </div>
      </div>
    </div>
  );

  const editor = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-4 py-2 text-xs text-muted">
        <span className="font-medium text-ink">Your version</span>
        <span className="flex items-center gap-1">{saved ? <><Check className="h-3.5 w-3.5 text-good" /> saved</> : "saving..."}</span>
        <span className="ml-auto">Stored in groklab, not in your folder</span>
      </div>
      <div className="relative min-h-0 flex-1 bg-panel">
        <div className="absolute inset-0">
          <CodeMirror value={text ?? ""} onChange={onChange} theme={dark ? oneDark : "light"} extensions={extensions} height="100%" />
        </div>
      </div>
    </div>
  );

  const original = (
    <div className="flex h-full flex-col bg-panel">
      <div className="border-b border-line px-4 py-2 text-xs font-medium">Original (holes marked)</div>
      <div className="min-h-0 flex-1 overflow-auto">
        <CodeView text={p.original} lang={guessLang(p.file)} marks={marks} />
      </div>
    </div>
  );

  return (
    <Split
      id="practice-side"
      collapsible
      initial={340}
      min={260}
      max={520}
      className="h-full"
      left={side}
      right={showOriginal ? <Split id="practice-orig" side="right" initial={560} min={300} max={1000} left={editor} right={original} /> : editor}
    />
  );
}

function guessLang(file: string): string {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = { ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", py: "python", go: "go", rs: "rust", java: "java", rb: "ruby", sh: "bash", sql: "sql", yml: "yaml", yaml: "yaml", json: "json", md: "markdown", cs: "csharp", kt: "kotlin" };
  return map[ext] ?? "text";
}
