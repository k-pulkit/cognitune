import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { BundledLanguage } from "shiki";

/** Plain-text fallback above this size; shiki gets slow on huge files. */
const MAX_HIGHLIGHT_LINES = 4000;

let shikiPromise: Promise<typeof import("shiki")> | null = null;
const shiki = () => (shikiPromise ??= import("shiki"));

const ALIAS: Record<string, string> = { docker: "dockerfile", make: "makefile", text: "text" };

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plainHtml(text: string, mark: (n: number) => string) {
  return `<pre><code>${text
    .split("\n")
    .map((l, i) => `<span class="line ${mark(i + 1)}" data-line="${i + 1}">${escapeHtml(l)}</span>`)
    .join("\n")}</code></pre>`;
}

/**
 * Read-only code with line numbers. `focusLine` scrolls to and marks a line;
 * `marks` adds a class to ranges (e.g. practice holes).
 */
export function CodeView({
  text, lang, focusLine, marks, className, onLineClick, firstLine = 1,
}: {
  /** Number the first line as this (a snippet from the middle of a file). Marks and focus use file numbers too. */
  firstLine?: number;
  text: string;
  lang: string;
  focusLine?: number | null;
  marks?: { from: number; to: number; cls: string }[];
  className?: string;
  onLineClick?: (line: number) => void;
}) {
  const [html, setHtml] = useState<string>("");
  const box = useRef<HTMLDivElement>(null);
  /** A line the user clicked is already in view; do not scroll to it. */
  const clicked = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    const mark = (local: number) => {
      const n = local + firstLine - 1;
      const cls = (marks ?? []).filter((x) => n >= x.from && n <= x.to).map((x) => x.cls);
      return clsx(cls, n === focusLine && "hl");
    };
    const lines = text.split("\n").length;
    if (lines > MAX_HIGHLIGHT_LINES || lang === "text") {
      setHtml(plainHtml(text, mark));
      return;
    }
    setHtml((h) => h || plainHtml(text, mark));
    shiki()
      .then(async (s) => {
        const language = (ALIAS[lang] ?? lang) as BundledLanguage;
        const out = await s.codeToHtml(text, {
          lang: language in s.bundledLanguages ? language : "text",
          themes: { light: "solarized-light", dark: "dark-plus" },
          defaultColor: false,
          transformers: [{ line(node, n) { node.properties["data-line"] = n; const c = mark(n); if (c) this.addClassToHast(node, c); } }],
        });
        if (live) setHtml(out);
      })
      .catch(() => live && setHtml(plainHtml(text, mark)));
    return () => {
      live = false;
    };
  }, [text, lang, focusLine, marks, firstLine]);

  useEffect(() => {
    // The highlighter re-renders after a click too, so keep the guard until another line is focused.
    if (!focusLine || !box.current || clicked.current === focusLine) return;
    const el = box.current.querySelector<HTMLElement>(`[data-line="${focusLine - firstLine + 1}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [html, focusLine]);

  return (
    <div
      ref={box}
      className={clsx("code-view font-mono", onLineClick && "clickable", className)}
      style={firstLine > 1 ? ({ "--line-start": firstLine - 1 } as React.CSSProperties) : undefined}
      onClick={(e) => {
        if (window.getSelection()?.toString()) return; // selecting text is not a click on a line
        const line = (e.target as HTMLElement).closest<HTMLElement>("[data-line]")?.dataset.line;
        if (line && onLineClick) {
          const n = Number(line) + firstLine - 1;
          clicked.current = n;
          onLineClick(n);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
