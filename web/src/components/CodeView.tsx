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
  text, lang, focusLine, marks, className, onLineClick,
}: {
  text: string;
  lang: string;
  focusLine?: number | null;
  marks?: { from: number; to: number; cls: string }[];
  className?: string;
  onLineClick?: (line: number) => void;
}) {
  const [html, setHtml] = useState<string>("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    const mark = (n: number) => {
      const m = marks?.find((x) => n >= x.from && n <= x.to);
      return clsx(m?.cls, n === focusLine && "hl");
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
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
          transformers: [{ line(node, n) { node.properties["data-line"] = n; const c = mark(n); if (c) this.addClassToHast(node, c); } }],
        });
        if (live) setHtml(out);
      })
      .catch(() => live && setHtml(plainHtml(text, mark)));
    return () => {
      live = false;
    };
  }, [text, lang, focusLine, marks]);

  useEffect(() => {
    if (!focusLine || !box.current) return;
    const el = box.current.querySelector<HTMLElement>(`[data-line="${focusLine}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [html, focusLine]);

  return (
    <div
      ref={box}
      className={clsx("code-view font-mono", className)}
      onClick={(e) => {
        const line = (e.target as HTMLElement).closest<HTMLElement>("[data-line]")?.dataset.line;
        if (line && onLineClick) onLineClick(Number(line));
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
