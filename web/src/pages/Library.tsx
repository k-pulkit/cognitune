import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookA, Bug, Compass, Download, Footprints, GraduationCap, Hammer, Layers, ListChecks, MessageCircleQuestion, PauseCircle, PlayCircle, Search, StickyNote, Trash2,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import type { Card, GlossaryTerm, Hunt, Lens, Note, Practice, Quiz, Teachback, Thread, Walk } from "@core/types";
import { del, get, patch, relTime } from "@/lib/api";
import { useProject } from "@/lib/project";
import { shortPath } from "@/lib/path";
import { CardDialog } from "@/components/CardDialog";
import { Badge, Empty, Score, Tabs, untilText } from "@/components/ui";

type Tab = "lenses" | "quizzes" | "practice" | "teachbacks" | "walks" | "hunts" | "threads" | "cards" | "glossary" | "notes";
const TABS: Tab[] = ["lenses", "quizzes", "practice", "teachbacks", "walks", "hunts", "threads", "cards", "glossary", "notes"];

/** Everything made for this project, newest first, plus the glossary and your notes. */
export function LibraryPage() {
  const { project, rel, setOpenFile } = useProject();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as Tab) ? params.get("tab") : "lenses") as Tab;
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
  const [q, setQ] = useState("");
  const [card, setCard] = useState<Partial<Card> | null>(null);
  const base = `/projects/${project.id}`;
  const p = `/p/${project.id}`;
  const list = <T,>(name: string) => useQuery({ queryKey: [name, project.id], queryFn: () => get<T[]>(`${base}/${name}`) }); // eslint-disable-line react-hooks/rules-of-hooks
  const lenses = list<Lens>("lenses");
  const quizzes = list<Quiz>("quizzes");
  const practice = list<Practice>("practice");
  const teach = list<Teachback>("teachbacks");
  const walks = list<Walk>("walks");
  const hunts = list<Hunt>("hunts");
  const threads = list<Thread>("threads");
  const cards = list<Card>("cards");
  const notes = list<Note>("notes");
  const glossary = useQuery({ queryKey: ["glossary", project.id], queryFn: () => get<GlossaryTerm[]>(`${base}/glossary`), enabled: tab === "glossary" });

  const match = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (...hay: (string | undefined)[]) => {
      const h = hay.join(" ").toLowerCase();
      return words.every((w) => h.includes(w));
    };
  }, [q]);

  const files = (list: string[]) => (
    <div className="mt-2 truncate font-mono text-[12px] text-muted">
      {list.slice(0, 3).map((f) => shortPath(rel(f), 28)).join(" · ")}
      {list.length > 3 && ` +${list.length - 3}`}
    </div>
  );
  const tile = "card block p-4 transition hover:-translate-y-0.5 hover:border-accent/40";
  const when = (iso: string) => <span className="ml-auto text-[12px] text-muted">{relTime(iso)}</span>;

  const empty = (icon: React.ReactNode, title: string, text: string) => <Empty icon={icon} title={title}>{text}</Empty>;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-panel px-8 pt-6">
        <div className="mx-auto max-w-[72rem]">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <h1 className="text-xl font-semibold tracking-tight">Library</h1>
            <p className="text-sm text-muted">Everything made in {project.name}.</p>
          </div>
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
            <input className="input h-8 pl-8 text-[14px]" placeholder="Search this tab" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <a href={`/api${base}/export`} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted hover:bg-raised hover:text-ink" title="Everything for this project as one JSON file">
            <Download className="h-3.5 w-3.5" /> Export all
          </a>
        </div>
        <Tabs
          className="-mx-2 mt-3 overflow-x-auto border-b-0"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "lenses", label: "Lenses", icon: <Compass className="h-4 w-4" />, count: lenses.data?.length },
            { value: "quizzes", label: "Quizzes", icon: <ListChecks className="h-4 w-4" />, count: quizzes.data?.length },
            { value: "teachbacks", label: "Teach-backs", icon: <GraduationCap className="h-4 w-4" />, count: teach.data?.length },
            { value: "walks", label: "Walks", icon: <Footprints className="h-4 w-4" />, count: walks.data?.length },
            { value: "practice", label: "Practice", icon: <Hammer className="h-4 w-4" />, count: practice.data?.length },
            { value: "hunts", label: "Bug hunts", icon: <Bug className="h-4 w-4" />, count: hunts.data?.length },
            { value: "threads", label: "Tutor", icon: <MessageCircleQuestion className="h-4 w-4" />, count: threads.data?.length },
            { value: "cards", label: "Cards", icon: <Layers className="h-4 w-4" />, count: cards.data?.length },
            { value: "glossary", label: "Glossary", icon: <BookA className="h-4 w-4" /> },
            { value: "notes", label: "Notes", icon: <StickyNote className="h-4 w-4" />, count: notes.data?.length },
          ]}
        />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-8">
        <div className="mx-auto max-w-[72rem]">
        <div className="grid gap-3 md:grid-cols-2">
          {tab === "lenses" && lenses.data?.filter((l) => match(l.title, l.summary, l.kind, ...l.files)).map((l) => (
            <Link key={l.id} to={`${p}/lens/${l.id}`} className={tile}>
              <div className="flex items-center gap-2">
                <Badge tone="accent">{l.kind}</Badge>
                {l.diff && <Badge tone="warn">change</Badge>}
                {l.sketch && <Badge>your take first</Badge>}
                {when(l.createdAt)}
              </div>
              <div className="mt-2 font-medium leading-snug">{l.title}</div>
              <p className="mt-1 line-clamp-2 text-[14px] text-muted">{l.summary}</p>
              {files(l.files)}
            </Link>
          ))}
          {tab === "quizzes" && quizzes.data?.filter((x) => match(x.title, ...x.files)).map((x) => {
            const best = x.attempts.length ? Math.max(...x.attempts.map((a) => a.score)) : null;
            return (
              <Link key={x.id} to={`${p}/quiz/${x.id}`} className={tile}>
                <div className="flex items-center gap-2">
                  <Badge>{x.questions.length} questions</Badge>
                  {best === null ? <Badge tone="warn">not taken</Badge> : <span className="text-xs text-muted">best <Score score={best} size="sm" /> · {x.attempts.length} tries</span>}
                  {when(x.createdAt)}
                </div>
                <div className="mt-2 font-medium leading-snug">{x.title}</div>
                {files(x.files)}
              </Link>
            );
          })}
          {tab === "teachbacks" && teach.data?.filter((t) => match(t.text, ...t.files)).map((t) => (
            <Link key={t.id} to={`${p}/teach/${t.id}`} className={tile}>
              <div className="flex items-center gap-2">
                {t.grade && <Badge tone={t.grade.score >= 4 ? "good" : t.grade.score >= 3 ? "warn" : "bad"}>{t.grade.score}/5</Badge>}
                {when(t.createdAt)}
              </div>
              <p className="mt-2 line-clamp-3 text-[14px]">{t.text}</p>
              {files(t.files)}
            </Link>
          ))}
          {tab === "walks" && walks.data?.filter((w) => match(w.file, ...w.blocks.map((b) => b.title))).map((w) => {
            const done = w.blocks.filter((b) => b.verdict).length;
            return (
              <Link key={w.id} to={`${p}/walk/${w.id}`} className={tile}>
                <div className="flex items-center gap-2">
                  <Badge tone={done === w.blocks.length ? "good" : "warn"}>{done}/{w.blocks.length} checked</Badge>
                  {when(w.createdAt)}
                </div>
                <div className="mt-2 truncate font-mono text-sm">{rel(w.file)}</div>
              </Link>
            );
          })}
          {tab === "practice" && practice.data?.filter((x) => match(x.file)).map((x) => {
            const right = x.review?.holes.filter((h) => h.verdict === "right").length;
            return (
              <Link key={x.id} to={`${p}/practice/${x.id}`} className={tile}>
                <div className="flex items-center gap-2">
                  <Badge tone="accent">level {x.level}</Badge>
                  <Badge>{x.holes.length} holes</Badge>
                  {x.review ? <Badge tone={right === x.holes.length ? "good" : "warn"}>{right}/{x.holes.length} right</Badge> : <Badge tone="warn">open</Badge>}
                  {when(x.createdAt)}
                </div>
                <div className="mt-2 truncate font-mono text-sm">{rel(x.file)}</div>
              </Link>
            );
          })}
          {tab === "hunts" && hunts.data?.filter((h) => match(h.file)).map((h) => (
            <Link key={h.id} to={`${p}/hunt/${h.id}`} className={tile}>
              <div className="flex items-center gap-2">
                <Badge tone="bad">{["", "easy", "medium", "hard"][h.level]}</Badge>
                {h.grade ? <span className="text-xs text-muted"><Score score={h.grade.score} size="sm" /></span> : <Badge tone="warn">open</Badge>}
                {when(h.createdAt)}
              </div>
              <div className="mt-2 truncate font-mono text-sm">{rel(h.file)}</div>
            </Link>
          ))}
          {tab === "threads" && threads.data?.filter((t) => match(t.title, ...t.messages.map((m) => m.text))).map((t) => (
            <Link key={t.id} to={`${p}/tutor/${t.id}`} className={tile}>
              <div className="flex items-center gap-2"><Badge>{t.messages.length} messages</Badge>{when(t.createdAt)}</div>
              <div className="mt-2 line-clamp-2 font-medium leading-snug">{t.title}</div>
              {files(t.files)}
            </Link>
          ))}
          {tab === "cards" && cards.data?.filter((c) => match(c.front, c.back, c.file)).map((c) => (
            <div key={c.id} className="card group p-4">
              <div className="flex items-center gap-2">
                <Badge tone={c.kind === "miss" ? "bad" : c.kind === "concept" ? "accent" : "muted"}>{c.kind}</Badge>
                {c.suspended ? <Badge>paused</Badge> : <span className="text-[12px] text-muted">due in {untilText(c.fsrs.due)}</span>}
                <span className="ml-auto flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <button className="text-muted hover:text-ink" title={c.suspended ? "Resume" : "Pause"}
                    onClick={async () => { await patch(`${base}/cards/${c.id}`, { suspended: !c.suspended }); qc.invalidateQueries({ queryKey: ["cards", project.id] }); }}>
                    {c.suspended ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                  </button>
                  <button className="text-muted hover:text-bad" title="Archive"
                    onClick={async () => { await del(`${base}/cards/${c.id}`); qc.invalidateQueries({ queryKey: ["cards", project.id] }); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
              <div className="mt-2 text-[14.5px] font-medium leading-snug">{c.front}</div>
              <p className="mt-1 line-clamp-2 text-[14px] text-muted">{c.back}</p>
              {c.file && <div className="mt-2 truncate font-mono text-[12px] text-muted">{rel(c.file)}{c.line ? `:${c.line}` : ""}</div>}
            </div>
          ))}
          {tab === "notes" && notes.data?.filter((n) => match(n.text, n.file)).map((n) => (
            <Link key={n.id} to={`${p}/explore`} onClick={() => n.file && setOpenFile(n.file, n.line)} className={tile}>
              <div className="flex items-center gap-2">
                {n.file && <span className="truncate font-mono text-[12px] text-accent">{rel(n.file)}{n.line ? `:${n.line}` : ""}</span>}
                {when(n.createdAt)}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[14.5px]">{n.text}</p>
            </Link>
          ))}
        </div>

        {tab === "glossary" && (
          <div className="divide-y divide-line">
            {glossary.data?.filter((t) => match(t.term, ...t.explains.map((e) => e.text))).map((t) => (
              <div key={t.term} className="group py-3">
                <div className="flex items-center gap-2">
                  <div className="text-[16px] font-semibold">{t.term}</div>
                  <span className="text-[12px] text-muted">{t.files.slice(0, 3).map((f) => shortPath(rel(f), 24)).join(" · ")}</span>
                  <button className="ml-auto text-muted opacity-0 transition hover:text-accent group-hover:opacity-100" title="Make a review card"
                    onClick={() => setCard({ kind: "concept", front: `What is "${t.term}" here, and why does it matter?`, back: t.explains[0]?.text ?? "", file: t.files[0] })}>
                    <Layers className="h-3.5 w-3.5" />
                  </button>
                </div>
                {t.explains.map((e, i) => (
                  <p key={i} className="mt-1 text-[14.5px] text-ink/85">
                    {e.text} <Link to={`${p}/lens/${e.lensId}`} className="text-[12px] text-muted hover:text-accent">({e.lensTitle})</Link>
                  </p>
                ))}
              </div>
            ))}
            {glossary.data?.length === 0 && empty(<BookA className="h-6 w-6" />, "No terms yet", "Every lens adds the concepts it explains here.")}
          </div>
        )}

        {tab === "lenses" && lenses.data?.length === 0 && empty(<Compass className="h-6 w-6" />, "No lenses yet", "Open Explore, pick files, choose a lens.")}
        {tab === "quizzes" && quizzes.data?.length === 0 && empty(<ListChecks className="h-6 w-6" />, "No quizzes yet", "Quiz yourself from Explore, Changes, or the end of a lens.")}
        {tab === "teachbacks" && teach.data?.length === 0 && empty(<GraduationCap className="h-6 w-6" />, "No teach-backs yet", "In Explore, pick Teach and explain the code in your own words.")}
        {tab === "walks" && walks.data?.length === 0 && empty(<Footprints className="h-6 w-6" />, "No walkthroughs yet", "Open a file in Explore and pick Walk.")}
        {tab === "practice" && practice.data?.length === 0 && empty(<Hammer className="h-6 w-6" />, "No practice yet", "Open a file in Explore and pick Practice.")}
        {tab === "hunts" && hunts.data?.length === 0 && empty(<Bug className="h-6 w-6" />, "No bug hunts yet", "Open a file in Explore and pick Bug hunt.")}
        {tab === "threads" && threads.data?.length === 0 && empty(<MessageCircleQuestion className="h-6 w-6" />, "No tutor chats yet", "Ask the tutor from Explore or from a missed quiz question.")}
        {tab === "cards" && cards.data?.length === 0 && empty(<Layers className="h-6 w-6" />, "No cards yet", "Quiz misses become cards on their own. You can also make one from a lens concept or a code line.")}
        {tab === "notes" && notes.data?.length === 0 && empty(<StickyNote className="h-6 w-6" />, "No notes yet", "In Explore, click a line and add a note from the Notes tab.")}
        </div>
      </div>
      {card && <CardDialog initial={card} onClose={() => setCard(null)} />}
    </div>
  );
}
