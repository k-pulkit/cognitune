import { useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useIsDark } from "@/lib/theme";

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
      m.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", securityLevel: "strict", fontFamily: "Inter Variable, sans-serif" });
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
  if (bad) return <pre>{code}</pre>;
  return <div className="my-2 flex justify-center overflow-auto rounded-lg border border-line bg-panel p-4" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function Markdown({ children }: { children: string }) {
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
