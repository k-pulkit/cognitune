import clsx from "clsx";
import { AlertTriangle, Loader2, X } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Verdict } from "@core/types";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary", size = "md", icon, className, children, loading, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; icon?: ReactNode; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        "inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium transition active:scale-[0.98]",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        size === "sm" && "h-7 px-2.5 text-xs",
        size === "md" && "h-9 px-3.5 text-sm",
        size === "lg" && "h-11 px-5 text-[16px]",
        variant === "primary" && "bg-accent text-accent-ink shadow-sm hover:brightness-110",
        variant === "secondary" && "border border-line bg-panel text-ink hover:bg-raised",
        variant === "ghost" && "text-muted hover:bg-raised hover:text-ink",
        variant === "danger" && "border border-bad/30 bg-bad/10 text-bad hover:bg-bad/15",
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Badge({ tone = "muted", children, className }: { tone?: "muted" | "accent" | "good" | "warn" | "bad"; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium",
        tone === "muted" && "bg-raised text-muted",
        tone === "accent" && "bg-accent/12 text-accent",
        tone === "good" && "bg-good/12 text-good",
        tone === "warn" && "bg-warn/15 text-warn",
        tone === "bad" && "bg-bad/12 text-bad",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function VerdictBadge({ v }: { v: Verdict }) {
  return <Badge tone={v === "right" ? "good" : v === "partial" ? "warn" : "bad"}>{v}</Badge>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("h-4 w-4 animate-spin text-muted", className)} />;
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-accent/10 text-accent">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <div className="mt-1.5 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error, onClose }: { error: string; onClose?: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-bad/30 bg-bad/8 px-3 py-2 text-sm text-bad">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{error}</div>
      {onClose && (
        <button onClick={onClose} className="opacity-60 hover:opacity-100" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

const STEPS: Record<string, string[]> = {
  lens: ["Reading the files", "Finding the core idea", "Writing the lesson"],
  quiz: ["Reading the files", "Choosing what matters", "Writing questions"],
  grade: ["Reading your answers", "Checking against the code", "Writing feedback"],
  practice: ["Reading the file", "Choosing the key logic", "Cutting the holes"],
  review: ["Reading your code", "Comparing with the original", "Writing feedback"],
  teachback: ["Reading your explanation", "Checking it against the code", "Writing feedback"],
  tutor: ["Reading the conversation", "Thinking of a good question", "Writing"],
  walk: ["Reading the file", "Finding the reading order", "Writing check questions"],
  walkcheck: ["Reading your answer", "Checking the block"],
  hunt: ["Reading the file", "Choosing where to break it", "Planting the bugs"],
  huntgrade: ["Matching your marks", "Checking your reasons", "Writing feedback"],
  path: ["Reading the repo layout", "Ordering the stops", "Writing the path"],
};

/** Progress card for a running model job. The steps are a guide to the wait, not real stages. */
export function JobProgress({ kind, elapsed }: { kind: string; elapsed: number }) {
  const steps = STEPS[kind] ?? ["Working"];
  const at = Math.min(steps.length - 1, Math.floor(elapsed / 12));
  return (
    <div className="shimmer card p-4">
      <div className="flex items-center gap-3">
        <Spinner className="text-accent" />
        <div className="text-sm font-medium">{steps[at]}...</div>
        <div className="ml-auto font-mono text-xs text-muted">{elapsed}s</div>
      </div>
      <div className="mt-3 flex gap-1.5">
        {steps.map((s, i) => (
          <div key={s} className={clsx("h-1 flex-1 rounded-full transition-colors", i <= at ? "bg-accent" : "bg-line")} />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">Model calls take 20 seconds to 2 minutes. You can keep reading code meanwhile.</p>
    </div>
  );
}

export function Segmented<T extends string | number>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-raised p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={clsx(
            "rounded-md px-2.5 py-1 text-xs font-medium transition",
            o.value === value ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  value, onChange, tabs, className,
}: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; icon?: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div className={clsx("flex gap-1 border-b border-line px-2", className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            "relative flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition",
            t.value === value ? "text-ink" : "text-muted hover:text-ink",
          )}
        >
          {t.icon}
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="rounded-full bg-raised px-1.5 text-[11.5px] text-muted">{t.count}</span>}
          {t.value === value && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
        </button>
      ))}
    </div>
  );
}

export function Score({ score, size = "md" }: { score: number; size?: "sm" | "md" }) {
  const pct = Math.round(score * 100);
  const tone = score >= 0.67 ? "text-good" : score >= 0.4 ? "text-warn" : "text-bad";
  return <span className={clsx("font-semibold tabular-nums", tone, size === "sm" ? "text-xs" : "text-sm")}>{pct}%</span>;
}

/** A centred dialog over a dimmed page. Escape or a click outside closes it. */
export function Modal({
  title, onClose, children, footer, wide,
}: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className={clsx("card flex max-h-[85vh] w-full flex-col overflow-hidden", wide ? "max-w-2xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="ml-auto text-muted hover:text-ink" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Small page header used by the activity pages. */
export function PageHead({ back, badges, title, sub, actions }: { back?: ReactNode; badges?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div>
      {back}
      {badges && <div className="mt-3 flex flex-wrap items-center gap-2">{badges}</div>}
      <div className="mt-2 flex items-start gap-3">
        <h1 className="min-w-0 flex-1 text-[26px] font-semibold leading-tight tracking-tight">{title}</h1>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
      {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
    </div>
  );
}

/** "in 3 d" / "in 10 min" for a future time. */
export function untilText(iso: string): string {
  const s = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 1000));
  if (s < 90) return "now";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  if (s < 86400 * 60) return `${Math.round(s / 86400)} d`;
  return `${Math.round(s / (86400 * 30))} mo`;
}
