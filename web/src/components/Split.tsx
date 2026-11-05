import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";

/**
 * Two panes with a drag handle. The size of the fixed pane is kept per `id` in localStorage
 * (a per-browser convenience). `side` says which pane has the fixed width.
 */
export function Split({
  id, left, right, initial = 280, min = 180, max = 640, side = "left", className,
}: {
  id: string;
  left: ReactNode;
  right: ReactNode;
  initial?: number;
  min?: number;
  max?: number;
  side?: "left" | "right";
  className?: string;
}) {
  const key = `groklab.split.${id}`;
  const [size, setSize] = useState(() => {
    try {
      return Number(localStorage.getItem(key)) || initial;
    } catch {
      return initial;
    }
  });
  const drag = useRef<{ x: number; size: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(key, String(size));
    } catch {
      /* ignore */
    }
  }, [key, size]);

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

  const handle = (
    <div
      className="group relative w-px shrink-0 cursor-col-resize bg-line"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, size };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onDoubleClick={() => setSize(initial)}
      title="Drag to resize, double-click to reset"
    >
      <div className="absolute inset-y-0 -left-1.5 -right-1.5 transition group-hover:bg-accent/30" />
    </div>
  );

  return (
    <div className={clsx("flex h-full min-h-0 min-w-0", className)}>
      {side === "left" ? (
        <>
          <div style={{ width: size }} className="min-h-0 shrink-0 overflow-hidden">{left}</div>
          {handle}
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{right}</div>
        </>
      ) : (
        <>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{left}</div>
          {handle}
          <div style={{ width: size }} className="min-h-0 shrink-0 overflow-hidden">{right}</div>
        </>
      )}
    </div>
  );
}
