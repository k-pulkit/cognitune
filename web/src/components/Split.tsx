import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";

function stored<T>(key: string, fallback: T, parse: (v: string) => T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : parse(v);
  } catch {
    return fallback;
  }
}

function keep(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private mode */
  }
}

/**
 * Two panes with a drag handle. `side` says which pane has the fixed width. With `collapsible`,
 * the fixed pane can fold into a thin rail; hovering the rail slides the pane in over the
 * page, and it slides away when the mouse leaves. Size and folded state are kept per `id` in
 * localStorage (a per-browser convenience).
 */
export function Split({
  id, left, right, initial = 280, min = 180, max = 640, side = "left", className, collapsible = false,
  startCollapsed = false, openSignal,
}: {
  /** Folded on first visit (before the user has chosen). */
  startCollapsed?: boolean;
  /** Change this value to unfold the pane (e.g. when the page wants to show something in it). */
  openSignal?: unknown;
  id: string;
  left: ReactNode;
  right: ReactNode;
  initial?: number;
  min?: number;
  max?: number;
  side?: "left" | "right";
  className?: string;
  collapsible?: boolean;
}) {
  const key = `groklab.split.${id}`;
  const [size, setSize] = useState(() => stored(key, initial, Number) || initial);
  const [collapsed, setCollapsed] = useState(() => collapsible && stored(`${key}.collapsed`, startCollapsed, (v) => v === "1"));
  const firstSignal = useRef(true);
  useEffect(() => {
    if (firstSignal.current) {
      firstSignal.current = false;
      return;
    }
    if (openSignal !== undefined && openSignal !== null) setCollapsed(false);
  }, [openSignal]);
  const [peek, setPeek] = useState(false);
  const drag = useRef<{ x: number; size: number } | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => keep(key, String(size)), [key, size]);
  useEffect(() => keep(`${key}.collapsed`, collapsed ? "1" : "0"), [key, collapsed]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      const dx = e.clientX - drag.current.x;
      setSize(Math.min(max, Math.max(min, drag.current.size + (side === "left" ? dx : -dx))));
    };
    const up = () => {
      drag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [min, max, side]);

  // A short delay before hiding, so moving across the pane edge does not flicker it shut.
  const openPeek = () => {
    clearTimeout(leaveTimer.current);
    setPeek(true);
  };
  const closePeek = () => {
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setPeek(false), 250);
  };
  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  const fixedLeft = side === "left";

  // "[" folds or pins the left pane, "]" the right one (not while typing).
  useEffect(() => {
    if (!collapsible) return;
    const key = fixedLeft ? "[" : "]";
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== key || e.ctrlKey || e.metaKey || e.altKey || t.closest("input, textarea, select, [contenteditable=true], .cm-editor")) return;
      setCollapsed((c) => !c);
      setPeek(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [collapsible, fixedLeft]);
  const Fold = fixedLeft ? ChevronLeft : ChevronRight;
  const Unfold = fixedLeft ? ChevronRight : ChevronLeft;

  const handle = (
    <div
      className="group relative w-px shrink-0 cursor-col-resize bg-line"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        drag.current = { x: e.clientX, size };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onDoubleClick={() => setSize(initial)}
      title="Drag to resize, double-click to reset"
    >
      <div className="absolute inset-y-0 -left-1.5 -right-1.5 transition group-hover:bg-accent/30" />
      {collapsible && (
        <button
          onClick={() => {
            setCollapsed(true);
            setPeek(false);
          }}
          title={`Fold this pane away (key ${fixedLeft ? "[" : "]"}); hover the edge to see it again`}
          className="absolute top-1/2 z-20 -mt-5 grid h-10 w-5 -translate-x-1/2 place-items-center rounded-full border border-line bg-panel text-muted shadow-sm transition hover:border-accent/50 hover:text-accent"
        >
          <Fold className="h-3 w-3" />
        </button>
      )}
    </div>
  );

  const rail = (
    <div
      onMouseEnter={openPeek}
      onMouseLeave={closePeek}
      className={clsx(
        "group flex w-3 shrink-0 cursor-pointer flex-col items-center justify-center bg-panel transition hover:bg-accent/10",
        fixedLeft ? "border-r border-line" : "border-l border-line",
      )}
      onClick={() => {
        setCollapsed(false);
        setPeek(false);
      }}
      title={`Hover to peek, click to pin open (key ${fixedLeft ? "[" : "]"})`}
    >
      <Unfold className="h-3 w-3 text-muted group-hover:text-accent" />
    </div>
  );

  // One element for the fixed pane in every state, so its React state survives folding.
  const fixedPane = (
    <div
      style={{ width: size }}
      onMouseEnter={collapsed ? openPeek : undefined}
      onMouseLeave={collapsed ? closePeek : undefined}
      className={clsx(
        "min-h-0 shrink-0 overflow-hidden",
        collapsed && !peek && "hidden",
        collapsed && peek && clsx("absolute inset-y-0 z-30 shadow-2xl ring-1 ring-line", fixedLeft ? "left-3" : "right-3"),
      )}
    >
      {fixedLeft ? left : right}
    </div>
  );
  const flexPane = <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{fixedLeft ? right : left}</div>;

  return (
    <div className={clsx("relative flex h-full min-h-0 min-w-0", className)}>
      {fixedLeft ? (
        <>
          {collapsed && rail}
          {fixedPane}
          {!collapsed && handle}
          {flexPane}
        </>
      ) : (
        <>
          {flexPane}
          {!collapsed && handle}
          {fixedPane}
          {collapsed && rail}
        </>
      )}
    </div>
  );
}
