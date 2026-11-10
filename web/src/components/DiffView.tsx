import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

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

/** GitHub-style diff: split (before | after) for changes, one column for new or deleted files. */
export function DiffView({ patch, mode }: { patch: string; mode: "split" | "unified" }) {
  const rows = useMemo(() => parsePatch(patch), [patch]);
  // New or deleted file: only one side has lines, so a split view would be half empty.
  const allOneSide = !rows.some((r) => r.kind === "ctx") && (!rows.some((r) => r.kind === "add") || !rows.some((r) => r.kind === "del"));

  if (!rows.length) return <div className="p-6 text-sm text-muted">No text changes (binary file or mode change).</div>;

  if (mode === "unified" || allOneSide) {
    return (
      <div className="min-h-full py-1 font-mono text-[13.5px] leading-6">
        {rows.map((r, i) =>
          r.kind === "hunk" ? (
            <div key={i} className="diff-hunk px-4">{r.text}</div>
          ) : (
            <div key={i} className={clsx("flex", r.kind === "add" && "diff-add", r.kind === "del" && "diff-del")}>
              <span className={num}>{r.left ?? ""}</span>
              <span className={num}>{r.right ?? ""}</span>
              <span className="w-4 shrink-0 select-none text-muted">{r.kind === "add" ? "+" : r.kind === "del" ? "-" : ""}</span>
              <span className={TEXT}>{r.text}</span>
            </div>
          ),
        )}
      </div>
    );
  }

  return <SplitDiff rows={splitRows(rows)} />;
}

type Pair = { left?: Row; right?: Row; hunk?: string };

/**
 * Before | after as one grid: each row holds both sides, so a wrapped long line makes the whole
 * row taller and the two sides stay lined up. The divider spans the full height and drags
 * (double-click centres it).
 */
function SplitDiff({ rows }: { rows: Pair[] }) {
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
      <span className={TEXT}>{r?.text ?? ""}</span>
    </div>
  );

  return (
    <div ref={box} className="relative min-h-full font-mono text-[13.5px] leading-6">
      <div className="grid py-1" style={{ gridTemplateColumns: `${pct}% ${100 - pct}%` }}>
        {rows.map((s, i) =>
          s.hunk ? (
            <div key={i} className="diff-hunk col-span-2 whitespace-pre-wrap break-all px-4">{s.hunk}</div>
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
