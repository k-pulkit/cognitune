import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Compass, Hammer, ListChecks } from "lucide-react";
import { Link } from "react-router-dom";
import type { Lens, Practice, Quiz } from "@core/types";
import { get, relTime } from "@/lib/api";
import { useProject } from "@/lib/project";
import { shortPath } from "@/lib/path";
import { Badge, Empty, Score, Tabs } from "@/components/ui";

type Tab = "lenses" | "quizzes" | "practice";

/** Everything made for this project, newest first. */
export function LibraryPage() {
  const { project, rel } = useProject();
  const [tab, setTab] = useState<Tab>("lenses");
  const base = `/projects/${project.id}`;
  const lenses = useQuery({ queryKey: ["lenses", project.id], queryFn: () => get<Lens[]>(`${base}/lenses`) });
  const quizzes = useQuery({ queryKey: ["quizzes", project.id], queryFn: () => get<Quiz[]>(`${base}/quizzes`) });
  const practice = useQuery({ queryKey: ["practice-list", project.id], queryFn: () => get<Practice[]>(`${base}/practice`) });

  const files = (list: string[]) => (
    <div className="mt-2 truncate font-mono text-[11px] text-muted">
      {list.slice(0, 3).map((f) => shortPath(rel(f), 28)).join(" · ")}
      {list.length > 3 && ` +${list.length - 3}`}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-panel px-8 pt-6">
        <h1 className="text-xl font-semibold tracking-tight">Library</h1>
        <p className="text-sm text-muted">Lenses, quizzes and practice made in {project.name}.</p>
        <Tabs
          className="mt-3 -mx-2 border-b-0"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "lenses", label: "Lenses", icon: <Compass className="h-4 w-4" />, count: lenses.data?.length },
            { value: "quizzes", label: "Quizzes", icon: <ListChecks className="h-4 w-4" />, count: quizzes.data?.length },
            { value: "practice", label: "Practice", icon: <Hammer className="h-4 w-4" />, count: practice.data?.length },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-8">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {tab === "lenses" &&
            lenses.data?.map((l) => (
              <Link key={l.id} to={`/p/${project.id}/lens/${l.id}`} className="card block p-4 transition hover:-translate-y-0.5 hover:border-accent/40">
                <div className="flex items-center gap-2">
                  <Badge tone="accent">{l.kind}</Badge>
                  {l.diff && <Badge tone="warn">change</Badge>}
                  <span className="ml-auto text-[11px] text-muted">{relTime(l.createdAt)}</span>
                </div>
                <div className="mt-2 font-medium leading-snug">{l.title}</div>
                <p className="mt-1 line-clamp-2 text-[13px] text-muted">{l.summary}</p>
                {files(l.files)}
              </Link>
            ))}
          {tab === "quizzes" &&
            quizzes.data?.map((q) => {
              const best = q.attempts.length ? Math.max(...q.attempts.map((a) => a.score)) : null;
              return (
                <Link key={q.id} to={`/p/${project.id}/quiz/${q.id}`} className="card block p-4 transition hover:-translate-y-0.5 hover:border-accent/40">
                  <div className="flex items-center gap-2">
                    <Badge>{q.questions.length} questions</Badge>
                    {best === null ? <Badge tone="warn">not taken</Badge> : <span className="text-xs text-muted">best <Score score={best} size="sm" /> · {q.attempts.length} tries</span>}
                    <span className="ml-auto text-[11px] text-muted">{relTime(q.createdAt)}</span>
                  </div>
                  <div className="mt-2 font-medium leading-snug">{q.title}</div>
                  {files(q.files)}
                </Link>
              );
            })}
          {tab === "practice" &&
            practice.data?.map((p) => {
              const right = p.review?.holes.filter((h) => h.verdict === "right").length;
              return (
                <Link key={p.id} to={`/p/${project.id}/practice/${p.id}`} className="card block p-4 transition hover:-translate-y-0.5 hover:border-accent/40">
                  <div className="flex items-center gap-2">
                    <Badge tone="accent">level {p.level}</Badge>
                    <Badge>{p.holes.length} holes</Badge>
                    {p.review ? <Badge tone={right === p.holes.length ? "good" : "warn"}>{right}/{p.holes.length} right</Badge> : <Badge tone="warn">open</Badge>}
                    <span className="ml-auto text-[11px] text-muted">{relTime(p.createdAt)}</span>
                  </div>
                  <div className="mt-2 truncate font-mono text-sm">{rel(p.file)}</div>
                </Link>
              );
            })}
        </div>
        {tab === "lenses" && lenses.data?.length === 0 && <Empty icon={<Compass className="h-6 w-6" />} title="No lenses yet">Open Explore, pick files, choose a lens.</Empty>}
        {tab === "quizzes" && quizzes.data?.length === 0 && <Empty icon={<ListChecks className="h-6 w-6" />} title="No quizzes yet">Quiz yourself from Explore, Changes, or the end of a lens.</Empty>}
        {tab === "practice" && practice.data?.length === 0 && <Empty icon={<Hammer className="h-6 w-6" />} title="No practice yet">Open a file in Explore and pick the Practice tab.</Empty>}
      </div>
    </div>
  );
}
