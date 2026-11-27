import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bug, Compass, Footprints, GraduationCap, Hammer, Layers, Library, ListChecks, MessageCircleQuestion, StickyNote } from "lucide-react";
import type { RelatedItem } from "@core/types";
import { get, relTime } from "@/lib/api";
import { useProject } from "@/lib/project";

const ICON: Record<RelatedItem["kind"], typeof Compass> = {
  lens: Compass, quiz: ListChecks, walk: Footprints, practice: Hammer, hunt: Bug, teachback: GraduationCap,
  tutor: MessageCircleQuestion, card: Layers, note: StickyNote,
};
const PAGE: Partial<Record<RelatedItem["kind"], string>> = {
  lens: "lens", quiz: "quiz", walk: "walk", practice: "practice", hunt: "hunt", teachback: "teach", tutor: "tutor",
};
const TAB: Record<RelatedItem["kind"], string> = {
  lens: "lenses", quiz: "quizzes", walk: "walks", practice: "practice", hunt: "hunts", teachback: "teachbacks", tutor: "threads", card: "cards", note: "notes",
};

/** The Library, showing only what was made for this file. */
export function libraryFor(pid: string, file: string, tab = "lenses"): string {
  return `/p/${pid}/library?tab=${tab}&file=${encodeURIComponent(file)}`;
}

/**
 * Beside an open file: "Related N" opens the newest things made for it (lenses, quizzes, walks...), and the
 * Library icon opens all of them in the Library.
 */
export function RelatedButton({ file }: { file: string }) {
  const { project } = useProject();
  const q = useQuery({
    queryKey: ["related", project.id, file],
    queryFn: () => get<RelatedItem[]>(`/projects/${project.id}/related?file=${encodeURIComponent(file)}`),
    staleTime: 15_000,
  });
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const items = q.data ?? [];

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const r = btn.current?.getBoundingClientRect();
  const href = (it: RelatedItem) => (PAGE[it.kind] ? `/p/${project.id}/${PAGE[it.kind]}/${it.id}` : libraryFor(project.id, file, TAB[it.kind]));
  return (
    <>
      <button
        ref={btn}
        className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted hover:bg-raised hover:text-ink disabled:opacity-50"
        title={items.length ? "What you made for this file: lenses, quizzes, walks…" : "Nothing made for this file yet"}
        disabled={!items.length}
        onClick={() => setOpen(!open)}
      >
        Related <span className="rounded bg-ink/5 px-1 tabular-nums">{items.length}</span>
      </button>
      <Link to={libraryFor(project.id, file)} title="See everything made for this file in the Library" aria-label="See everything made for this file in the Library"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-ink">
        <Library className="h-3.5 w-3.5" />
      </Link>
      {open && r && createPortal(
        <div ref={box} className="fixed z-50 w-[380px] overflow-hidden rounded-md border border-line bg-panel shadow-soft"
          style={{ top: r.bottom + 6, left: Math.max(12, Math.min(window.innerWidth - 392, r.right - 380)) }}>
          <div className="max-h-[360px] overflow-auto py-1">
            {items.slice(0, 10).map((it) => {
              const Icon = ICON[it.kind];
              return (
                <Link key={`${it.kind}:${it.id}`} to={href(it)} onClick={() => setOpen(false)} className="flex items-start gap-2.5 px-3 py-2 hover:bg-raised">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[13.5px] leading-snug">{it.title}</span>
                    <span className="text-[12px] text-muted">{it.kind}{it.note ? ` · ${it.note}` : ""} · {relTime(it.createdAt)}</span>
                  </span>
                </Link>
              );
            })}
          </div>
          <Link to={libraryFor(project.id, file)} onClick={() => setOpen(false)} className="flex items-center gap-2 border-t border-line px-3 py-2 text-[13px] text-accent hover:bg-raised">
            <Library className="h-3.5 w-3.5" /> See all {items.length} in the Library
          </Link>
        </div>,
        document.body,
      )}
    </>
  );
}
