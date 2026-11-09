import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { languages } from "@codemirror/language-data";
import { LanguageDescription } from "@codemirror/language";
import { EditorState, RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { ArrowLeft, Check, Eye, EyeOff, FileCode2, Folder, Lightbulb, Lock, RotateCcw, Send, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Hole, Practice, PracticeFile } from "@core/types";
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
    setExt([]);
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

// ---- editor helpers --------------------------------------------------------

const HOLE_LINE = /\bHOLE \d+\b/;
const holeMark = Decoration.line({ class: "cm-hole-line" });

/** Tints every line that still has a HOLE marker, so open holes stand out while scrolling. */
const holeLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      if (HOLE_LINE.test(line.text)) b.add(line.from, line.from, holeMark);
      pos = line.to + 1;
    }
  }
  return b.finish();
}

/** Puts the cursor on a hole's marker line and centres it. Falls back to the hole's original line once filled. */
function reveal(view: EditorView, h: Hole) {
  const doc = view.state.doc;
  const re = new RegExp(`\\bHOLE ${h.id}\\b`);
  let at = -1;
  for (let i = 1; i <= doc.lines; i++) {
    if (re.test(doc.line(i).text)) {
      at = doc.line(i).from;
      break;
    }
  }
  if (at < 0) at = doc.line(Math.min(Math.max(1, h.startLine), doc.lines)).from;
  view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
  view.focus();
}

// ---- file tree -------------------------------------------------------------

type TNode = { name: string; path?: string; kids: Map<string, TNode> };

/** A small tree of just the practice's files, with single-child folders folded into one row ("src/core"). */
function buildTree(files: PracticeFile[], rel: (p: string) => string): TNode {
  const root: TNode = { name: "", kids: new Map() };
  for (const f of files) {
    const parts = rel(f.path).split("/");
    let n = root;
    parts.forEach((part, i) => {
      if (!n.kids.has(part)) n.kids.set(part, { name: part, kids: new Map() });
      n = n.kids.get(part)!;
      if (i === parts.length - 1) n.path = f.path;
    });
  }
  const fold = (n: TNode): TNode => {
    for (const [k, c] of n.kids) n.kids.set(k, fold(c));
    if (!n.path && n.kids.size === 1 && n.name) {
      const only = [...n.kids.values()][0];
      if (!only.path) return { ...only, name: `${n.name}/${only.name}` };
    }
    return n;
  };
  return fold(root);
}

/**
 * Multi-file practice around one concept. Left: the files involved. Middle: your version of the open
 * file (edits autosave). Right: the holes; click one to jump to it. The original stays hidden until you ask.
 */
export function PracticePage() {
  const { id = "" } = useParams();
  const { project, rel } = useProject();
  const qc = useQueryClient();
  const nav = useNavigate();
  const dark = useIsDark();
  const job = useJob();
  const pr = useQuery({ queryKey: ["practice", project.id, id], queryFn: () => get<Practice>(`/projects/${project.id}/practice/${id}`) });
  const p = pr.data;
  const files = useMemo(() => p?.files ?? (p ? [{ path: p.file, original: p.original, holed: p.holed, attempt: p.attempt }] : []), [p]);
  const holes = useMemo(() => (p ? p.holes.map((h) => ({ ...h, file: h.file ?? p.file })) : []), [p]);

  const [cur, setCur] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState(true);
  const [hintsShown, setHintsShown] = useState<Record<number, number>>({});
  const [active, setActive] = useState<number | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef<{ file: string; text: string } | null>(null);
  const view = useRef<EditorView | null>(null);
  const jump = useRef<Hole | null>(null);
  const lang = useLanguage(cur ?? undefined);

  useEffect(() => {
    if (!p || texts) return;
    setTexts(Object.fromEntries(files.map((f) => [f.path, f.attempt])));
    setCur(files[0]?.path ?? null);
  }, [p, files, texts]);

  const flush = async () => {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    await put(`/projects/${project.id}/practice/${id}/attempt`, next);
    setSaved(true);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const holesIn = (file: string) => holes.filter((h) => h.file === file);
  const editable = !!cur && holesIn(cur).length > 0;
  const extensions = useMemo(
    () => [...lang, holeLines, ...(editable ? [] : [EditorState.readOnly.of(true), EditorView.editable.of(false)])],
    [lang, editable],
  );

  if (pr.isLoading) return <div className="p-8"><Spinner /></div>;
  if (!p) return <Empty title="Practice not found" />;
  if (!texts || !cur) return <div className="p-8"><Spinner /></div>;

  const reviewOf = (hid: number) => p.review?.holes.find((r) => r.id === hid);
  const curFile = files.find((f) => f.path === cur)!;

  const onChange = (v: string) => {
    setTexts((t) => ({ ...t!, [cur]: v }));
    setSaved(false);
    pending.current = { file: cur, text: v };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 800);
  };

  const open = (file: string) => {
    if (file === cur) return;
    void flush();
    setCur(file);
  };

  const goto = (h: Hole) => {
    setActive(h.id);
    if (h.file && h.file !== cur) {
      jump.current = h;
      open(h.file);
    } else if (view.current) reveal(view.current, h);
  };

  const check = async () => {
    await flush();
    job.run(`/projects/${project.id}/practice/${id}/review`, {}, () => qc.invalidateQueries({ queryKey: ["practice", project.id, id] }));
  };

  const startOver = async () => {
    if (!window.confirm("Put every hole back? Your answers in all files are cleared.")) return;
    clearTimeout(timer.current);
    pending.current = null;
    setTexts(Object.fromEntries(files.map((f) => [f.path, f.holed])));
    await Promise.all(files.filter((f) => holesIn(f.path).length).map((f) => put(`/projects/${project.id}/practice/${id}/attempt`, { file: f.path, text: f.holed })));
    setSaved(true);
  };

  // -- left: the files of this practice
  const tree = buildTree(files, rel);
  const fileRow = (n: TNode, depth: number): React.ReactNode => {
    if (!n.path) {
      return (
        <div key={`d:${n.name}:${depth}`}>
          <div className="flex h-[22px] items-center gap-1 pr-2 text-[13px] text-muted" style={{ paddingLeft: depth * 12 + 8 }}>
            <Folder className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{n.name}</span>
          </div>
          {[...n.kids.values()].map((k) => fileRow(k, depth + 1))}
        </div>
      );
    }
    const mine = holesIn(n.path);
    const done = mine.filter((h) => reviewOf(h.id)?.verdict === "right").length;
    return (
      <button
        key={n.path}
        onClick={() => open(n.path!)}
        title={rel(n.path)}
        className={clsx(
          "flex h-[22px] w-full items-center gap-1 pr-2 text-left text-[13px]",
          n.path === cur ? "bg-sel text-ink dark:text-white" : "hover:bg-raised",
          !mine.length && "text-muted",
        )}
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate">{n.name}</span>
        {mine.length ? (
          <span className={clsx("rounded-sm px-1 text-[11px] font-semibold", p.review && done === mine.length ? "bg-good/15 text-good" : "bg-warn/15 text-warn")} title={`${mine.length} hole${mine.length > 1 ? "s" : ""}`}>
            {p.review ? `${done}/${mine.length}` : mine.length}
          </span>
        ) : (
          <Lock className="h-3 w-3 shrink-0" aria-label="read only" />
        )}
      </button>
    );
  };
  const left = (
    <div className="flex h-full flex-col bg-side">
      <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Files · {files.length}</div>
      <div className="min-h-0 flex-1 overflow-auto pb-3">{[...tree.kids.values()].map((k) => fileRow(k, 0))}</div>
      <p className="border-t border-line px-3 py-2 text-[11px] text-muted">Numbers are holes to fill. <Lock className="inline h-3 w-3" /> files are context, read only.</p>
    </div>
  );

  // -- middle: your version of the open file
  const editor = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-xs text-muted">
        <span className="truncate font-mono text-[12.5px] text-ink" title={rel(cur)}>{rel(cur)}</span>
        {editable ? (
          <span className="flex shrink-0 items-center gap-1">{saved ? <><Check className="h-3.5 w-3.5 text-good" /> saved</> : "saving..."}</span>
        ) : (
          <span className="flex shrink-0 items-center gap-1"><Lock className="h-3 w-3" /> context, read only</span>
        )}
        <span className="ml-auto hidden shrink-0 lg:inline">A copy in groklab; your folder is not touched</span>
      </div>
      <div className="relative min-h-0 flex-1 bg-panel">
        <div className="absolute inset-0">
          <CodeMirror
            key={cur}
            value={texts[cur] ?? curFile.attempt}
            onChange={onChange}
            theme={dark ? oneDark : "light"}
            extensions={extensions}
            height="100%"
            onCreateEditor={(v) => {
              view.current = v;
              const h = jump.current;
              if (h && h.file === cur) {
                jump.current = null;
                setTimeout(() => reveal(v, h), 0);
              }
            }}
          />
        </div>
      </div>
    </div>
  );

  const original = (
    <div className="flex h-full flex-col bg-panel">
      <div className="border-b border-line px-3 py-1.5 text-xs font-medium">Original (holes marked)</div>
      <div className="min-h-0 flex-1 overflow-auto">
        <CodeView text={curFile.original} lang={guessLang(cur)} marks={holesIn(cur).map((h) => ({ from: h.startLine, to: h.endLine, cls: "hole" }))} />
      </div>
    </div>
  );

  // -- right: the concept and the holes
  const right = (
    <div className="flex h-full flex-col bg-panel">
      <div className="border-b border-line p-4">
        <Link to={`/p/${project.id}/library`} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> Library
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <Badge tone="accent">practice · level {p.level}</Badge>
          <span className="text-xs text-muted">{holes.length} hole{holes.length > 1 ? "s" : ""} · {relTime(p.createdAt)}</span>
        </div>
        {p.concept && <div className="read-sm mt-2 font-medium">{p.concept}</div>}
        <p className="mt-2 text-xs text-muted">Click a hole to jump to it. Write the code it needs; pseudo-code is fine if the logic is right.</p>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
        {p.review?.summary && <div className="rounded border border-accent/25 bg-accent/5 p-3 text-sm">{p.review.summary}</div>}
        {holes.map((h) => {
          const n = hintsShown[h.id] ?? 0;
          const r = reviewOf(h.id);
          return (
            <div
              key={h.id}
              role="button"
              tabIndex={0}
              onClick={() => goto(h)}
              onKeyDown={(e) => e.key === "Enter" && goto(h)}
              className={clsx(
                "card cursor-pointer p-3 transition hover:border-accent/50",
                active === h.id && "border-accent ring-1 ring-accent/40",
                r && (r.verdict === "right" ? "border-good/40" : r.verdict === "partial" ? "border-warn/40" : "border-bad/40"),
              )}
            >
              <div className="flex items-center gap-2">
                <span className="rounded-sm bg-warn/15 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-warn">HOLE {h.id}</span>
                <span className="min-w-0 truncate font-mono text-[11.5px] text-muted" title={rel(h.file!)}>{rel(h.file!).split("/").pop()}:{h.startLine}</span>
                {r && <span className="ml-auto"><VerdictBadge v={r.verdict} /></span>}
              </div>
              <p className="read-sm mt-2">{h.intent}</p>
              {h.hints.slice(0, n).map((hint, i) => (
                <div key={i} className="mt-2 flex gap-2 rounded bg-raised px-2.5 py-1.5 text-[13px]">
                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" /> {hint}
                </div>
              ))}
              {n < h.hints.length && (
                <button
                  className="mt-2 text-xs font-medium text-accent hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setHintsShown((s) => ({ ...s, [h.id]: n + 1 }));
                  }}
                >
                  {n === 0 ? "Show a hint" : "Another hint"} ({n}/{h.hints.length})
                </button>
              )}
              {r?.feedback && <p className="mt-2 border-t border-line pt-2 text-[13px] text-muted">{r.feedback}</p>}
            </div>
          );
        })}
      </div>
      <div className="space-y-2 border-t border-line p-3">
        {job.busy && job.job && <JobProgress kind="review" elapsed={job.elapsed} />}
        {job.error && <ErrorNote error={job.error} onClose={job.clearError} />}
        <Button variant="primary" size="lg" className="w-full" icon={<Send className="h-4 w-4" />} loading={job.busy} onClick={check}>
          Check my work
        </Button>
        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2 [&>button]:whitespace-nowrap">
          <Button size="sm" icon={showOriginal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} onClick={() => setShowOriginal((s) => !s)}>
            {showOriginal ? "Hide original" : "Show original"}
          </Button>
          <Button size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} title="Put every hole back" onClick={startOver}>
            Start over
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            title="Move this practice to the archive"
            onClick={async () => {
              await del(`/projects/${project.id}/practice/${p.id}`);
              nav(`/p/${project.id}/library`);
            }}
          >
            Archive
          </Button>
        </div>
      </div>
    </div>
  );

  const center = showOriginal ? <Split id="practice-orig" side="right" initial={520} min={300} max={1000} left={editor} right={original} /> : editor;
  return (
    <Split
      id="practice-holes"
      side="right"
      collapsible
      initial={380}
      min={300}
      max={560}
      className="h-full"
      left={<Split id="practice-files" collapsible initial={230} min={170} max={420} left={left} right={center} />}
      right={right}
    />
  );
}

function guessLang(file: string): string {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = { ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", py: "python", go: "go", rs: "rust", java: "java", rb: "ruby", sh: "bash", sql: "sql", yml: "yaml", yaml: "yaml", json: "json", md: "markdown", cs: "csharp", kt: "kotlin" };
  return map[ext] ?? "text";
}
