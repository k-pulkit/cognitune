import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { PenLine, Undo2, X } from "lucide-react";
import { Button, Spinner } from "@/components/ui";

/** A selection inside one revisable block (an element with `data-block`). */
export interface Picked {
  block: string;
  text: string;
  /** Where to show the button: just under the selection, in viewport pixels. */
  x: number;
  y: number;
}

/** The block under a DOM node, if the node sits inside one. */
function blockOf(n: Node | null): HTMLElement | null {
  const el = n instanceof HTMLElement ? n : n?.parentElement;
  return el?.closest<HTMLElement>("[data-block]") ?? null;
}

/**
 * Select text inside a block of `root`, and a small "Revise" button appears under it. Clicking it opens a box
 * for an instruction. Only the block that holds the selection is rewritten; a selection that spans two blocks,
 * or sits in a text box, is ignored.
 */
export function ReviseOnSelect({ root, label, busy, onRevise }: {
  root: RefObject<HTMLElement>;
  /** A block id as the reader would say it ("Step 3", "The answer"). */
  label: (block: string) => string;
  busy: boolean;
  onRevise: (block: string, selection: string, instruction: string) => void;
}) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const read = () => {
      if (open) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return setPicked(null);
      const words = sel.toString().trim();
      const a = blockOf(sel.anchorNode);
      if (words.length < 3 || !a || a !== blockOf(sel.focusNode) || !el.contains(a)) return setPicked(null);
      if ((sel.anchorNode?.parentElement)?.closest("textarea, input")) return setPicked(null);
      const r = sel.getRangeAt(0).getBoundingClientRect();
      setPicked({ block: a.dataset.block!, text: words, x: Math.min(window.innerWidth - 380, Math.max(12, r.left)), y: Math.min(window.innerHeight - 60, r.bottom + 8) });
    };
    // After the mouse or keyboard finishes the selection, not on every change while dragging.
    const later = () => setTimeout(read, 0);
    el.addEventListener("mouseup", later);
    el.addEventListener("keyup", later);
    // The button is fixed on screen: on scroll, move it with the selection (the open box stays put).
    const scroller = el.closest(".overflow-auto") ?? window;
    scroller.addEventListener("scroll", read, { passive: true });
    return () => {
      el.removeEventListener("mouseup", later);
      el.removeEventListener("keyup", later);
      scroller.removeEventListener("scroll", read);
    };
  }, [root, open]);

  // A click outside the open box closes it.
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setPicked(null);
    setText("");
  };
  const send = () => {
    if (!picked || !text.trim() || busy) return;
    onRevise(picked.block, picked.text, text.trim());
    close();
    window.getSelection()?.removeAllRanges();
  };

  if (!picked) return null;
  // Portalled to <body>: the lens column is a CSS container, which would make "fixed" relative to it.
  if (!open) {
    return createPortal(
      <button
        className="fixed z-40 inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1 text-[13px] shadow-soft hover:border-accent/50 hover:text-accent"
        style={{ left: picked.x, top: picked.y }}
        // Keep the selection: a mousedown on the button would clear it before the click lands.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(true)}
        disabled={busy}
        title={busy ? "Wait for the current rewrite to finish" : `Rewrite ${label(picked.block)} with an instruction`}
      >
        <PenLine className="h-3.5 w-3.5" /> Revise {label(picked.block).toLowerCase()}
      </button>,
      document.body,
    );
  }
  return createPortal(
    <div ref={box} className="fixed z-40 w-[360px] rounded-md border border-line bg-panel p-3 shadow-soft"
      style={{ left: picked.x, top: Math.min(picked.y, window.innerHeight - 260) }}>
      <div className="flex items-center gap-2 text-[13.5px] font-semibold">
        <PenLine className="h-3.5 w-3.5 text-accent" /> Revise {label(picked.block).toLowerCase()}
        <button className="ml-auto text-muted hover:text-ink" onClick={close} aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      <p className="mt-2 line-clamp-3 border-l-2 border-line pl-2 text-[12.5px] italic text-muted">{picked.text}</p>
      <textarea
        className="input mt-2 min-h-[72px] resize-y text-[13.5px]"
        placeholder="e.g. Show this with real numbers. Shorter. Explain the term first.  Ctrl+Enter to send."
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="primary" icon={<PenLine className="h-3.5 w-3.5" />} disabled={!text.trim() || busy} onClick={send}>Rewrite</Button>
        <span className="text-[12px] text-muted">Only this part changes; you can undo it.</span>
      </div>
    </div>,
    document.body,
  );
}

/** Bottom-right note while a rewrite runs, then what changed, with Undo. */
export function ReviseToast({ busy, elapsed, what, done, error, onUndo, onClose }: {
  busy: boolean;
  elapsed: number;
  what?: string;
  done?: string;
  error?: string | null;
  onUndo?: () => void;
  onClose: () => void;
}) {
  if (!busy && !done && !error) return null;
  return createPortal(
    <div className="fixed bottom-4 right-4 z-40 flex max-w-[420px] items-center gap-3 rounded-md border border-line bg-panel px-4 py-2.5 text-[13.5px] shadow-soft">
      {busy ? (
        <>
          <Spinner />
          <span>Rewriting {what?.toLowerCase()}… <span className="tabular-nums text-muted">{elapsed}s</span></span>
        </>
      ) : error ? (
        <span className="text-bad">{error}</span>
      ) : (
        <>
          <span>{done}</span>
          {onUndo && (
            <button className="inline-flex items-center gap-1 text-accent hover:underline" onClick={onUndo}><Undo2 className="h-3.5 w-3.5" /> Undo</button>
          )}
        </>
      )}
      {!busy && <button className="ml-1 text-muted hover:text-ink" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>}
    </div>,
    document.body,
  );
}
