import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ChevronsUpDown, Search } from "lucide-react";

export interface ComboOption {
  value: string;
  label: string;
  /** Second line or right-hand note, e.g. a branch or a commit date. */
  hint?: string;
  group?: string;
}

/**
 * A themed select you can type into. The list opens under the button at the button's width,
 * filters on every word typed (label, hint and group), and works with the keyboard:
 * up / down to move, Enter to pick, Escape to close.
 */
export function Combobox({
  value, options, onChange, placeholder = "Pick one", className,
}: { value: string; options: ComboOption[]; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return options;
    return options.filter((o) => {
      const hay = `${o.label} ${o.hint ?? ""} ${o.group ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [options, q]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => setAt(0), [q, open]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQ("");
  };

  return (
    <div ref={box} className={clsx("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx("input flex h-8 items-center gap-2 py-0 text-left text-xs", open && "border-accent ring-2 ring-accent/20")}
        title={current ? `${current.label}${current.hint ? ` · ${current.hint}` : ""}` : undefined}
      >
        <span className="min-w-0 flex-1 truncate">{current ? current.label : <span className="text-muted">{placeholder}</span>}</span>
        {current?.hint && <span className="max-w-[40%] shrink-0 truncate text-[12px] text-muted">{current.hint}</span>}
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-line bg-panel shadow-xl">
          <div className="relative border-b border-line">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Type to filter"
              className="w-full bg-transparent py-2 pl-8 pr-3 text-xs text-ink outline-none placeholder:text-muted/70"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setAt((i) => Math.min(shown.length - 1, i + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setAt((i) => Math.max(0, i - 1));
                } else if (e.key === "Enter" && shown[at]) {
                  e.preventDefault();
                  pick(shown[at].value);
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
            />
          </div>
          <div ref={list} className="max-h-72 overflow-auto py-1">
            {shown.map((o, i) => (
              <div key={o.value}>
                {o.group && o.group !== shown[i - 1]?.group && (
                  <div className="px-3 pb-1 pt-2 text-[11.5px] font-medium uppercase tracking-wide text-muted">{o.group}</div>
                )}
                <button
                  type="button"
                  data-i={i}
                  onMouseEnter={() => setAt(i)}
                  onClick={() => pick(o.value)}
                  className={clsx("flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs", i === at ? "bg-accent/10 text-ink" : "text-ink/90")}
                >
                  <Check className={clsx("h-3.5 w-3.5 shrink-0 text-accent", o.value !== value && "invisible")} />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="max-w-[45%] shrink-0 truncate text-[12px] text-muted">{o.hint}</span>}
                </button>
              </div>
            ))}
            {!shown.length && <div className="px-3 py-4 text-center text-xs text-muted">No match</div>}
          </div>
        </div>
      )}
    </div>
  );
}
