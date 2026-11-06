import { useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useIsDark } from "@/lib/theme";

/** Mermaid colours from the app tokens (index.css), so diagrams match the page in both themes. */
const LIGHT_VARS = {
  background: "#ffffff", mainBkg: "#eeedfd", primaryColor: "#eeedfd", primaryTextColor: "#181822", primaryBorderColor: "#6354f0",
  nodeBorder: "#6354f0", lineColor: "#696a7a", secondaryColor: "#f3f3f8", tertiaryColor: "#f3f3f8", textColor: "#181822",
  edgeLabelBackground: "#ffffff", clusterBkg: "#f3f3f8", clusterBorder: "#e4e4ec", fontSize: "14px",
};
const DARK_VARS = {
  background: "#14141b", mainBkg: "#232040", primaryColor: "#232040", primaryTextColor: "#e8e8f0", primaryBorderColor: "#8c80ff",
  nodeBorder: "#8c80ff", lineColor: "#9192a5", secondaryColor: "#1d1d26", tertiaryColor: "#1d1d26", textColor: "#e8e8f0",
  edgeLabelBackground: "#14141b", clusterBkg: "#1d1d26", clusterBorder: "#2a2a36", fontSize: "14px",
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
        fontFamily: "Inter Variable, system-ui, sans-serif",
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
  if (bad) return <pre>{code}</pre>;
  return (
    <>
      <div className="relative my-6">
        <div
          className="md-figure flex cursor-zoom-in justify-center rounded-xl border border-line bg-panel p-4"
          title="Click to enlarge"
          onClick={() => setBig(true)}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <span className="pointer-events-none absolute right-3 top-2 text-[11px] text-muted">click to enlarge</span>
      </div>
      {big && (
        <div className="fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-ink/40 p-6 backdrop-blur-sm" onClick={() => setBig(false)}>
          <div className="md-figure-big max-h-full max-w-full overflow-auto rounded-xl border border-line bg-panel p-6 shadow-soft" onClick={(e) => e.stopPropagation()} dangerouslySetInnerHTML={{ __html: svg }} />
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

export function Markdown({ children }: { children: string }) {
  children = arrows(children);
  return (
    <div className="prose-g">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children: c, ...props }) {
            const lang = /language-(\w+)/.exec(className ?? "")?.[1];
            if (lang === "mermaid") return <Mermaid code={String(c).trim()} />;
            return <code className={className} {...props}>{c}</code>;
          },
          pre({ children: c }) {
            // A mermaid block renders its own box; keep <pre> for real code only.
            const child = Array.isArray(c) ? c[0] : c;
            const cls = (child as { props?: { className?: string } })?.props?.className ?? "";
            if (cls.includes("language-mermaid")) return <>{c}</>;
            return <pre>{c}</pre>;
          },
          a({ href, children: c }) {
            return <a href={href} target="_blank" rel="noreferrer">{c}</a>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Markdown for one short field (a summary, a concept, a check question): `code`, **bold**,
 * *italic* and links render; paragraphs become plain text runs so it can sit inside a sentence.
 */
export function Inline({ children, className }: { children: string; className?: string }) {
  children = arrows(children);
  return (
    <span className={className ? `md-inline ${className}` : "md-inline"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children: c }) => <>{c}{" "}</>,
          a: ({ href, children: c }) => <a href={href} target="_blank" rel="noreferrer">{c}</a>,
        }}
      >
        {children}
      </ReactMarkdown>
    </span>
  );
}
