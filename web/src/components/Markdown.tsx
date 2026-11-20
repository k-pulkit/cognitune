import { type CSSProperties, createContext, memo, useContext, useEffect, useId, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { type CodeRef, linkifyCode, parseCodeHref } from "@/lib/lines";
import { useIsDark } from "@/lib/theme";

let shikiPromise: Promise<typeof import("shiki")> | null = null;
const shiki = () => (shikiPromise ??= import("shiki"));
const FENCE_ALIAS: Record<string, string> = { sh: "bash", yml: "yaml", ts: "typescript", js: "javascript", py: "python" };

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A fenced code block in lens/quiz/explainer prose, highlighted the same way as the main file viewer. */
function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [html, setHtml] = useState(`<pre><code>${escapeHtml(code)}</code></pre>`);
  useEffect(() => {
    let live = true;
    const language = FENCE_ALIAS[lang] ?? lang;
    shiki()
      .then(async (s) => {
        const out = await s.codeToHtml(code, {
          lang: language in s.bundledLanguages ? language : "text",
          themes: { light: "solarized-light", dark: "dark-plus" },
          defaultColor: false,
        });
        if (live) setHtml(out);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [lang, code]);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Mermaid colours from the app tokens (index.css), so diagrams match the page in both themes. */
const LIGHT_VARS = {
  background: "#fdf6e3", mainBkg: "#eee8d5", primaryColor: "#eee8d5", primaryTextColor: "#586e75", primaryBorderColor: "#268bd2",
  nodeBorder: "#268bd2", lineColor: "#839496", secondaryColor: "#eee8d5", tertiaryColor: "#eee8d5", textColor: "#586e75",
  edgeLabelBackground: "#fdf6e3", clusterBkg: "#eee8d5", clusterBorder: "#ddd6c1", fontSize: "14px",
};
const DARK_VARS = {
  background: "#1f1f1f", mainBkg: "#2a2d2e", primaryColor: "#2a2d2e", primaryTextColor: "#cccccc", primaryBorderColor: "#3794ff",
  nodeBorder: "#3794ff", lineColor: "#9d9d9d", secondaryColor: "#2a2d2e", tertiaryColor: "#2a2d2e", textColor: "#cccccc",
  edgeLabelBackground: "#1f1f1f", clusterBkg: "#2a2d2e", clusterBorder: "#2b2b2b", fontSize: "14px",
};

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
const loadMermaid = () => (mermaidPromise ??= import("mermaid").then((m) => m.default));

/** Renders a mermaid block to SVG; shows the source if it does not parse. */
export function Mermaid({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const dark = useIsDark();
  const [svg, setSvg] = useState("");
  const [bad, setBad] = useState(false);
  useEffect(() => {
    let live = true;
    loadMermaid().then(async (m) => {
      m.initialize({
        startOnLoad: false,
        theme: "base",
        securityLevel: "strict",
        fontFamily: "system-ui, -apple-system, Segoe UI, Ubuntu, sans-serif",
        themeVariables: dark ? DARK_VARS : LIGHT_VARS,
        flowchart: { useMaxWidth: true, curve: "basis", nodeSpacing: 30, rankSpacing: 40, padding: 8, htmlLabels: true },
      });
      try {
        const out = await m.render(`m${id}${dark ? "d" : "l"}`, code);
        if (live) {
          setSvg(out.svg);
          setBad(false);
        }
      } catch {
        if (live) setBad(true);
      }
    });
    return () => {
      live = false;
    };
  }, [code, dark, id]);
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setBig(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [big]);
  // The svg's own width is "100%", which is 0 inside the shrink-to-fit dialog. Size it from the
  // viewBox instead: 1.6x its drawn size, capped to fit the window (see .md-figure-big in index.css).
  const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  const bigStyle = box ? ({ "--fig-w": box[1], "--fig-ar": Number(box[1]) / Number(box[2]) } as CSSProperties) : undefined;
  if (bad) return <pre>{code}</pre>;
  return (
    <>
      <div className="relative my-6">
        <div
          className="md-figure flex cursor-zoom-in justify-center rounded-md border border-line bg-panel p-4"
          title="Click to enlarge"
          onClick={() => setBig(true)}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <span className="pointer-events-none absolute right-3 top-2 text-[11px] text-muted">click to enlarge</span>
      </div>
      {big && (
        <div className="fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-ink/40 p-6 backdrop-blur-sm" onClick={() => setBig(false)}>
          <div className="md-figure-big max-h-full max-w-full overflow-auto rounded-md border border-line bg-panel p-6" style={bigStyle} onClick={(e) => e.stopPropagation()} dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      )}
    </>
  );
}

/** " -> " in prose becomes " → ", but not inside `code` or fenced blocks. */
function arrows(md: string): string {
  return md
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 ? part : part.replace(/ -> /g, " → ")))
    .join("");
}

// Components live at module level: ReactMarkdown uses each one as an element type, so a fresh function
// per render makes React remount it, and every mermaid diagram and code block redraws from blank.
const PLUGINS = [remarkGfm];
const LineClick = createContext<((from: number, to: number) => void) | undefined>(undefined);

const BASE: Components = {
  code({ className, children: c, ...props }) {
    const lang = /language-(\w+)/.exec(className ?? "")?.[1];
    if (lang === "mermaid") return <Mermaid code={String(c).trim()} />;
    if (lang) return <CodeBlock lang={lang} code={String(c).replace(/\n$/, "")} />;
    return <code className={className} {...props}>{c}</code>;
  },
  pre({ children: c }) {
    // Mermaid and CodeBlock render their own box; keep <pre> for plain, language-less code only.
    const child = Array.isArray(c) ? c[0] : c;
    const cls = (child as { props?: { className?: string } })?.props?.className ?? "";
    if (cls.includes("language-")) return <>{c}</>;
    return <pre>{c}</pre>;
  },
  a: function Link({ href, children: c }) {
    const code = useContext(CodeClick);
    const target = code && parseCodeHref(href);
    if (target) return <CodeLink target={target} open={code!.open}>{c}</CodeLink>;
    const onLineClick = useContext(LineClick);
    const ref = onLineClick && /^codeline:(\d+)-(\d+)$/.exec(href ?? "");
    if (ref) return <button type="button" className="codeline" onClick={() => onLineClick(Number(ref[1]), Number(ref[2]))}>{c}</button>;
    return <a href={href} target="_blank" rel="noreferrer">{c}</a>;
  },
};

const keepUrl = (url: string) => url;

/**
 * Code citations in the text become links (see linkifyCode): `resolve` turns a cited path into a
 * real file, `current` is the file a bare line means, `open` handles a click (the event says if
 * Ctrl/Cmd was held).
 */
export interface CodeLinks {
  resolve: (path: string) => string | undefined;
  current?: string;
  open: (ref: CodeRef, e: React.MouseEvent) => void;
}
const CodeClick = createContext<CodeLinks | undefined>(undefined);

function CodeLink({ target, open, children: c }: { target: CodeRef; open: CodeLinks["open"]; children: React.ReactNode }) {
  const at = target.from === target.to ? `line ${target.from}` : `lines ${target.from}-${target.to}`;
  return (
    <button type="button" className="codeline" title={`${target.file}, ${at}`} onClick={(e) => open(target, e)}>
      {c}
    </button>
  );
}

export const Markdown = memo(function Markdown({
  children, className, onLineClick, code,
}: {
  children: string;
  className?: string;
  /** Jump the code pane to a line range named in the text (see linkifyLines). */
  onLineClick?: (from: number, to: number) => void;
  /** Turn code citations into links (lens pages). */
  code?: CodeLinks;
}) {
  const md = useMemo(
    () => (code ? linkifyCode(arrows(children), code.resolve, code.current) : arrows(children)),
    [children, code],
  );
  return (
    <div className={className ? `prose-g ${className}` : "prose-g"}>
      <LineClick.Provider value={onLineClick}>
        <CodeClick.Provider value={code}>
          <ReactMarkdown
            remarkPlugins={PLUGINS}
            // react-markdown's default urlTransform drops unknown schemes (it would silently empty
            // out our codeline: and code: links); only loosen it where those are actually in use.
            urlTransform={onLineClick || code ? keepUrl : undefined}
            components={BASE}
          >
            {md}
          </ReactMarkdown>
        </CodeClick.Provider>
      </LineClick.Provider>
    </div>
  );
});

const INLINE: Components = {
  p: ({ children: c }) => <>{c}{" "}</>,
  a: function InlineLink({ href, children: c }) {
    const code = useContext(CodeClick);
    const target = code && parseCodeHref(href);
    if (target) return <CodeLink target={target} open={code!.open}>{c}</CodeLink>;
    return <a href={href} target="_blank" rel="noreferrer">{c}</a>;
  },
};

/**
 * Markdown for one short field (a summary, a concept, a check question): `code`, **bold**,
 * *italic* and links render; paragraphs become plain text runs so it can sit inside a sentence.
 */
export const Inline = memo(function Inline({ children, className, code }: { children: string; className?: string; code?: CodeLinks }) {
  const md = useMemo(
    () => (code ? linkifyCode(arrows(children), code.resolve, code.current) : arrows(children)),
    [children, code],
  );
  return (
    <span className={className ? `md-inline ${className}` : "md-inline"}>
      <CodeClick.Provider value={code}>
        <ReactMarkdown remarkPlugins={PLUGINS} components={INLINE} urlTransform={code ? keepUrl : undefined}>{md}</ReactMarkdown>
      </CodeClick.Provider>
    </span>
  );
});
