import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { FileCode2, Lightbulb, Send, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import type { Thread } from "@core/types";
import { get, useJob } from "@/lib/api";
import { shortPath } from "@/lib/path";
import { useProject } from "@/lib/project";
import { BackLink, useArchive } from "@/components/BackLink";
import { CodePane } from "@/components/CodePane";
import { Markdown } from "@/components/Markdown";
import { linkifyLines } from "@/lib/lines";
import { Split } from "@/components/Split";
import { Button, Empty, ErrorNote, JobProgress, Spinner } from "@/components/ui";

const LEVEL = ["", "nudge", "hint", "walk-through", "answer"];

/** A Socratic chat: the tutor asks before it tells, and gives a bit more each turn. */
export function TutorPage() {
  const { id = "" } = useParams();
  const { project, rel } = useProject();
  const nav = useNavigate();
  const job = useJob();
  const archive = useArchive(`threads/${id}`);
  const [text, setText] = useState("");
  const [view, setView] = useState<{ file: string; line?: number; to?: number } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["thread", project.id, id], queryFn: () => get<Thread>(`/projects/${project.id}/threads/${id}`) });
  const t = q.data;
  // Block body: scrollIntoView returns a Promise in newer browsers, and an effect must not return one.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [t?.messages.length, job.busy]);
  useEffect(() => {
    if (t && !view) setView({ file: t.files[0] });
  }, [t, view]);
  if (q.isLoading) return <div className="p-8"><Spinner /></div>;
  if (!t) return <Empty title="Conversation not found" />;

  const send = (tell = false) =>
    job.run(`/projects/${project.id}/threads/${t.id}/messages`, { text, tell }, () => setText(""));

  const jump = (from: number, to: number) => setView((v) => ({ file: v?.file ?? t.files[0], line: from, to }));

  const chat = (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-panel px-4 py-1.5">
        <div className="flex items-center gap-2">
          <BackLink />
          <Button variant="ghost" size="sm" className="ml-auto" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => archive(nav)}>Archive</Button>
        </div>
        <div className="mt-0.5 truncate text-[13px] font-semibold">{t.title}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {t.files.slice(0, 6).map((f) => (
            <button key={f} onClick={() => setView({ file: f })} title={rel(f)} className="inline-flex max-w-full items-center gap-1 rounded-md bg-raised px-1.5 py-0.5 font-mono text-[11.5px] hover:text-accent">
              <FileCode2 className="h-3 w-3 shrink-0" /> <span className="truncate">{shortPath(rel(f), 64)}</span>
            </button>
          ))}
          {t.files.length > 6 && <span className="px-1 py-0.5 text-[11.5px] text-muted">+{t.files.length - 6} more</span>}
        </div>
      </div>
      <div className="chat-area min-h-0 flex-1 overflow-auto px-[6%] py-3 [scrollbar-gutter:stable]">
        {t.messages.map((m, i) => {
          const mine = m.role === "user";
          const first = i === 0 || t.messages[i - 1].role !== m.role;
          return (
            <div key={i} className={clsx("flex", mine ? "justify-end" : "justify-start", i > 0 && (first ? "mt-3" : "mt-0.5"))}>
              <div className={clsx("chat-bubble", mine ? "chat-me" : "chat-them", first && "chat-first")}>
                {!mine && m.hintLevel && (
                  <div className={clsx("chat-label", m.hintLevel >= 4 ? "text-warn" : "text-accent")}>
                    <Lightbulb className="h-3 w-3" /> Tutor · {LEVEL[m.hintLevel]}
                  </div>
                )}
                {mine ? (
                  <div className="whitespace-pre-wrap">{m.text}<span className="chat-spacer" /></div>
                ) : (
                  <Markdown className="chat-msg" onLineClick={jump}>{linkifyLines(m.text)}</Markdown>
                )}
                <span className="chat-time">{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>
          );
        })}
        {job.busy && job.job && <div className="mt-3"><JobProgress kind="tutor" elapsed={job.elapsed} /></div>}
        {job.error && <div className="mt-3"><ErrorNote error={job.error} onClose={job.clearError} /></div>}
        <div ref={end} />
      </div>
      <div className="flex items-end gap-2 border-t border-line bg-panel px-3 py-2">
        <textarea
          rows={1}
          className="max-h-40 min-h-[36px] flex-1 resize-none rounded-lg bg-raised px-3 py-2 text-[14px] leading-[1.4] text-ink outline-none [field-sizing:content] placeholder:text-muted/70 focus:ring-1 focus:ring-accent/50"
          placeholder="Your answer or next question — try first, each reply gives a bit more. Ctrl+Enter to send."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim() && !job.busy) send();
          }}
        />
        <Button variant="ghost" size="md" className="mb-[5px]" disabled={job.busy} onClick={() => send(true)}>Just tell me</Button>
        <button
          className="mb-[2px] grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition hover:brightness-110 disabled:opacity-40"
          disabled={job.busy || !text.trim()}
          onClick={() => send()}
          title="Send (Ctrl+Enter)"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
  const marks = view?.to && view.to !== view.line ? [{ from: view.line!, to: view.to, cls: "hl" }] : undefined;
  return <Split id="tutor-code" collapsible side="right" initial={520} min={300} max={900} className="h-full" left={chat} right={<CodePane file={view?.file} line={view?.line} marks={marks} />} />;
}
