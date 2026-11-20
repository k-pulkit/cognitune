import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

let shikiPromise: Promise<typeof import("shiki")> | null = null;
const shiki = () => (shikiPromise ??= import("shiki"));
/** Plain-text fallback above this size; shiki gets slow on huge diffs. */
const MAX_HIGHLIGHT_LINES = 4000;

interface Row {
  kind: "ctx" | "add" | "del" | "hunk";
  left?: number;
  right?: number;
  text: string;
}

/** Parse a unified diff into rows with old/new line numbers. File headers are dropped. */
export function parsePatch(patch: string): Row[] {
  const rows: Row[] = [];
  let l = 0;
  let r = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (h) {
      l = Number(h[1]);
      r = Number(h[2]);
      inHunk = true;
      rows.push({ kind: "hunk", text: line });
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) rows.push({ kind: "add", right: r++, text: line.slice(1) });
    else if (line.startsWith("-")) rows.push({ kind: "del", left: l++, text: line.slice(1) });
    else if (line.startsWith("\\")) continue;
    else if (line.startsWith(" ") || line === "") rows.push({ kind: "ctx", left: l++, right: r++, text: line.slice(1) });
  }
  // A trailing "" from the split is not a real context line.
  if (rows.length && rows[rows.length - 1].kind === "ctx" && rows[rows.length - 1].text === "") rows.pop();
  return rows;
}

/** Pair deletes with following adds so a changed line shows left and right on one row. */
function splitRows(rows: Row[]): { left?: Row; right?: Row; hunk?: string }[] {
  const out: { left?: Row; right?: Row; hunk?: string }[] = [];
  for (let i = 0; i < rows.length; ) {
    const row = rows[i];
    if (row.kind === "hunk") {
      out.push({ hunk: row.text });
      i++;
    } else if (row.kind === "ctx") {
      out.push({ left: row, right: row });
      i++;
    } else {
      const dels: Row[] = [];
      const adds: Row[] = [];
      while (i < rows.length && rows[i].kind === "del") dels.push(rows[i++]);
      while (i < rows.length && rows[i].kind === "add") adds.push(rows[i++]);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push({ left: dels[k], right: adds[k] });
    }
  }
  return out;
}

const num = "w-12 shrink-0 select-none pr-3 text-right text-muted/60";
/** Long lines wrap instead of running off the side; the wrap is marked by the row height only. */
const TEXT = "min-w-0 flex-1 whitespace-pre-wrap break-all pr-4";

/**
 * Syntax-colours every content row's text, keyed by row identity (shared by the unified and
 * split renderers since splitRows() re-groups the same row objects rather than copying them).
 * One shiki call for the whole diff keeps line continuity close to right across hunks, the same
 * tradeoff any diff highlighter makes without the full original file on both sides.
 */
function useHighlightedRows(rows: Row[], lang: string) {
  const [html, setHtml] = useState<Map<Row, string>>(new Map());
  useEffect(() => {
    const content = rows.filter((r) => r.kind !== "hunk");
    if (!content.length || lang === "text" || content.length > MAX_HIGHLIGHT_LINES) {
      setHtml(new Map());
      return;
    }
    let live = true;
    shiki()
      .then(async (s) => {
        if (!(lang in s.bundledLanguages)) return;
        const out = await s.codeToHtml(content.map((r) => r.text).join("\n"), {
          lang, themes: { light: "solarized-light", dark: "dark-plus" }, defaultColor: false,
        });
        const lines = new DOMParser().parseFromString(out, "text/html").querySelectorAll(".line");
        const next = new Map<Row, string>();
        content.forEach((r, i) => lines[i] && next.set(r, lines[i].innerHTML));
        if (live) setHtml(next);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [rows, lang]);
  return html;
}

/** GitHub-style diff: split (before | after) for changes, one column for new or deleted files. */
export function DiffView({ patch, mode, lang = "text" }: { patch: string; mode: "split" | "unified"; lang?: string }) {
  const rows = useMemo(() => parsePatch(patch), [patch]);
  const hl = useHighlightedRows(rows, lang);
  // shiki's defaultColor:false output needs a ".shiki" ancestor for its light/dark CSS vars to
  // turn into an actual text color (see index.css); extracting just a line's innerHTML drops the
  // <pre class="shiki"> wrapper that would normally provide it, so put the class back here.
  const rowText = (r: Row) => (hl.has(r) ? <span className="shiki" dangerouslySetInnerHTML={{ __html: hl.get(r)! }} /> : r.text);
  // New or deleted file: only one side has lines, so a split view would be half empty.
  const allOneSide = !rows.some((r) => r.kind === "ctx") && (!rows.some((r) => r.kind === "add") || !rows.some((r) => r.kind === "del"));

  if (!rows.length) return <div className="p-6 text-sm text-muted">No text changes (binary file or mode change).</div>;

  if (mode === "unified" || allOneSide) {
    return (
      <div className="code-text min-h-full py-1">
        {rows.map((r, i) =>
          r.kind === "hunk" ? (
            <div key={i} className="diff-hunk px-4">{r.text}</div>
          ) : (
            <div key={i} className={clsx("flex", r.kind === "add" && "diff-add", r.kind === "del" && "diff-del")}>
              <span className={num}>{r.left ?? ""}</span>
              <span className={num}>{r.right ?? ""}</span>
              <span className="w-4 shrink-0 select-none text-muted">{r.kind === "add" ? "+" : r.kind === "del" ? "-" : ""}</span>
              <span className={TEXT}>{rowText(r)}</span>
            </div>
          ),
        )}
      </div>
    );
  }

  return <SplitDiff rows={splitRows(rows)} hl={hl} />;
}

type Pair = { left?: Row; right?: Row; hunk?: string };

/**
 * Before | after as one grid: each row holds both sides, so a wrapped long line makes the whole
 * row taller and the two sides stay lined up. The divider spans the full height and drags
 * (double-click centres it).
 */
function SplitDiff({ rows, hl }: { rows: Pair[]; hl: Map<Row, string> }) {
  const box = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(() => {
    try {
      return Number(localStorage.getItem("cognitune.diff.split")) || 50;
    } catch {
      return 50;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("cognitune.diff.split", String(pct));
    } catch {
      /* ignore */
    }
  }, [pct]);

  const startDrag = (e: React.PointerEvent) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    const move = (ev: PointerEvent) => setPct(Math.min(85, Math.max(15, ((ev.clientX - rect.left) / rect.width) * 100)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const cell = (r: Row | undefined, side: 0 | 1, key: string) => (
    <div key={key} className={clsx("flex min-w-0", r?.kind === "del" && "diff-del", r?.kind === "add" && "diff-add", !r && "bg-raised/60")}>
      <span className={num}>{r ? (side === 0 ? r.left : r.right) : ""}</span>
      <span className={TEXT}>{r ? (hl.has(r) ? <span className="shiki" dangerouslySetInnerHTML={{ __html: hl.get(r)! }} /> : r.text) : ""}</span>
    </div>
  );

  return (
    <div ref={box} className="code-text relative min-h-full">
      <div className="grid py-1" style={{ gridTemplateColumns: `${pct}% ${100 - pct}%` }}>
        {rows.map((s, i) =>
          s.hunk ? (
            <div key={i} className="diff-hunk diff-hunk-solid relative z-20 col-span-2 whitespace-pre-wrap [overflow-wrap:anywhere] px-4">{s.hunk}</div>
          ) : (
            [cell(s.left, 0, `${i}l`), cell(s.right, 1, `${i}r`)]
          ),
        )}
      </div>
      <div
        className="group absolute inset-y-0 z-10 w-px cursor-col-resize bg-line"
        style={{ left: `${pct}%` }}
        onPointerDown={startDrag}
        onDoubleClick={() => setPct(50)}
        title="Drag to move, double-click to centre"
      >
        <div className="absolute inset-y-0 -left-1.5 -right-1.5 transition group-hover:bg-accent/30" />
      </div>
    </div>
  );
}
