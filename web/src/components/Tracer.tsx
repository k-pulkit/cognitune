import { useEffect, useState } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import type { Trace } from "@core/types";
import { useProject } from "@/lib/project";

/** Step through a trace like a debugger: the line on the right, the state here, changes marked. */
export function Tracer({ trace, onStep }: { trace: Trace; onStep: (file?: string, line?: number) => void }) {
  const { rel } = useProject();
  const [i, setI] = useState(0);
  const step = trace.steps[i];
  const prev = i > 0 ? trace.steps[i - 1].state : {};
  useEffect(() => {
    onStep(step.file, step.line);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  const vars = [...new Set([...Object.keys(prev), ...Object.keys(step.state)])];
  return (
    <div
      className="card overflow-hidden"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") setI((x) => Math.min(trace.steps.length - 1, x + 1));
        if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
      }}
    >
      <div className="flex items-center gap-2 border-b border-line bg-raised/60 px-4 py-2 text-xs">
        <Play className="h-3.5 w-3.5 text-accent" />
        <span className="text-muted">Input</span>
        <code className="font-mono">{trace.input}</code>
      </div>
      <div className="flex items-center gap-2 px-4 py-3">
        <button className="rounded-md border border-line p-1 hover:bg-raised disabled:opacity-40" disabled={i === 0} onClick={() => setI(i - 1)} aria-label="Previous step"><ChevronLeft className="h-4 w-4" /></button>
        <input type="range" min={0} max={trace.steps.length - 1} value={i} onChange={(e) => setI(Number(e.target.value))} className="flex-1 accent-[rgb(var(--accent))]" />
        <button className="rounded-md border border-line p-1 hover:bg-raised disabled:opacity-40" disabled={i === trace.steps.length - 1} onClick={() => setI(i + 1)} aria-label="Next step"><ChevronRight className="h-4 w-4" /></button>
        <span className="w-16 text-right font-mono text-xs text-muted">{i + 1}/{trace.steps.length}</span>
      </div>
      <div className="px-4 pb-1 text-[13.5px]">
        {step.file && <span className="mr-2 font-mono text-[11px] text-accent">{rel(step.file)}{step.line ? `:${step.line}` : ""}</span>}
        {step.note}
      </div>
      <table className="m-4 mt-2 w-[calc(100%-2rem)] text-[12.5px]">
        <tbody>
          {vars.map((v) => {
            const was = prev[v];
            const now = step.state[v];
            const changed = was !== now;
            return (
              <tr key={v} className="border-b border-line/60 last:border-0">
                <td className="py-1 pr-3 font-mono text-muted">{v}</td>
                <td className={clsx("py-1 font-mono", changed && i > 0 && "text-accent")}>
                  {now ?? <span className="text-muted line-through">{was}</span>}
                  {changed && i > 0 && was !== undefined && now !== undefined && <span className="ml-2 text-[11px] text-muted">was {was}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-line px-4 py-1.5 text-[11px] text-muted">Arrow keys step when this box has focus. Changed values are coloured.</div>
    </div>
  );
}
