import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BookOpen, Compass, FolderOpen, Hammer, ListChecks, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Project } from "@core/types";
import { del, get, post, relTime } from "@/lib/api";
import { FolderPicker } from "@/components/FolderPicker";
import { Logo } from "@/components/Shell";
import { Button, ErrorNote } from "@/components/ui";

const PILLARS = [
  { icon: Compass, title: "Lenses", text: "See code through one question: data flow, state, failure modes, contracts." },
  { icon: ListChecks, title: "Quizzes", text: "Questions about behaviour, not names. Graded with feedback that names the line." },
  { icon: Hammer, title: "Practice", text: "Key logic cut out of your own code. Write it back, with hints when stuck." },
  { icon: BookOpen, title: "Progress", text: "What you understand, per file. A pass goes stale when the code changes." },
];

export function ProjectsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => get<Project[]>("/projects") });
  const open = useMutation({
    mutationFn: (root: string) => post<Project>("/projects", { root }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      nav(`/p/${p.id}/today`);
    },
  });
  const forget = useMutation({
    mutationFn: (id: string) => del(`/projects/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  const list = projects.data ?? [];

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex items-center gap-3">
          <Logo className="h-11 w-11" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">groklab</h1>
            <p className="text-sm text-muted">Understand any codebase. Prove it to yourself.</p>
          </div>
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map(({ icon: Icon, title, text }) => (
            <div key={title} className="card p-4">
              <div className="mb-3 grid h-9 w-9 place-items-center rounded-lg bg-accent/10 text-accent">
                <Icon className="h-[18px] w-[18px]" />
              </div>
              <div className="text-sm font-semibold">{title}</div>
              <p className="mt-1 text-[14px] leading-snug text-muted">{text}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Projects</h2>
            <p className="text-sm text-muted">A project is a folder of code. Nothing in it is written.</p>
          </div>
          <Button variant="primary" size="lg" icon={<FolderOpen className="h-4 w-4" />} onClick={() => setPicking(true)}>
            Open a folder
          </Button>
        </div>

        {open.error && <div className="mt-4"><ErrorNote error={(open.error as Error).message} /></div>}

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {list.map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => open.mutate(p.root)}
              onKeyDown={(e) => e.key === "Enter" && open.mutate(p.root)}
              className="card group flex cursor-pointer items-center gap-4 p-4 transition hover:-translate-y-0.5 hover:border-accent/40"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent/20 to-fuchsia-500/20 text-sm font-bold uppercase text-accent">
                {p.name.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}</div>
                <div className="truncate font-mono text-xs text-muted" title={p.root}>{p.root}</div>
                <div className="mt-1 text-[12px] text-muted">
                  opened {relTime(p.openedAt)}
                  {p.contexts.length > 0 && ` · ${p.contexts.length} context folder${p.contexts.length > 1 ? "s" : ""}`}
                </div>
              </div>
              <button
                className="rounded-md p-1.5 text-muted opacity-0 transition hover:bg-raised hover:text-bad group-hover:opacity-100"
                title="Remove from the list (your lenses and quizzes stay on disk)"
                onClick={(e) => {
                  e.stopPropagation();
                  forget.mutate(p.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <ArrowRight className="h-4 w-4 text-muted transition group-hover:translate-x-0.5 group-hover:text-accent" />
            </div>
          ))}
          {!projects.isLoading && !list.length && (
            <div className="card col-span-full border-dashed p-10 text-center text-sm text-muted">
              No projects yet. Open a folder, or start from a terminal: <span className="kbd">npx groklab ./my-repo</span>
            </div>
          )}
        </div>
      </div>
      {picking && (
        <FolderPicker
          title="Open a folder"
          start={list[0]?.root.split("/").slice(0, -1).join("/") || undefined}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            setPicking(false);
            open.mutate(p);
          }}
        />
      )}
    </div>
  );
}
