import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { FileCode2, Lightbulb, Send, Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import type { Thread } from "@core/types";
import { get, useJob } from "@/lib/api";
import { useProject } from "@/lib/project";
import { BackLink, useArchive } from "@/components/BackLink";
import { CodePane } from "@/components/CodePane";
import { Markdown } from "@/components/Markdown";
import { Split } from "@/components/Split";
import { Badge, Button, Empty, ErrorNote, JobProgress, Spinner } from "@/components/ui";

const LEVEL = ["", "nudge", "hint", "walk-through", "answer"];

/** A Socratic chat: the tutor asks before it tells, and gives a bit more each turn. */
export function TutorPage() {
  const { id = "" } = useParams();
  const { project, rel } = useProject();
  const nav = useNavigate();
  const job = useJob();
  const archive = useArchive(`threads/${id}`);
  const [text, setText] = useState("");
  const [view, setView] = useState<{ file: string; line?: number } | null>(null);
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

  const chat = (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-panel px-6 py-3">
        <div className="flex items-center gap-2">
          <BackLink />
          <Button variant="ghost" size="sm" className="ml-auto" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => archive(nav)}>Archive</Button>
        </div>
        <div className="mt-1 truncate text-base font-semibold">{t.title}</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {t.files.map((f) => (
            <button key={f} onClick={() => setView({ file: f })} className="inline-flex items-center gap-1 rounded-md bg-raised px-2 py-0.5 font-mono text-[11px] hover:text-accent">
              <FileCode2 className="h-3 w-3" /> {rel(f)}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-6 py-5">
        {t.messages.map((m, i) => (
          <div key={i} className={clsx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={clsx("max-w-[85%] rounded-2xl px-4 py-3", m.role === "user" ? "bg-accent text-accent-ink" : "card")}>
              {m.role === "tutor" && m.hintLevel && (
                <Badge tone={m.hintLevel >= 4 ? "warn" : "accent"} className="mb-1.5"><Lightbulb className="h-3 w-3" /> {LEVEL[m.hintLevel]}</Badge>
              )}
              {m.role === "user" ? <div className="whitespace-pre-wrap text-[14px]">{m.text}</div> : <Markdown>{m.text}</Markdown>}
            </div>
          </div>
        ))}
        {job.busy && job.job && <JobProgress kind="tutor" elapsed={job.elapsed} />}
        {job.error && <ErrorNote error={job.error} onClose={job.clearError} />}
        <div ref={end} />
      </div>
      <div className="border-t border-line bg-panel p-3">
        <textarea
          className="input min-h-[64px] resize-y"
          placeholder="Your answer or next question. Ctrl+Enter to send."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim() && !job.busy) send();
          }}
        />
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-muted">Try first. Each reply gives a bit more.</span>
          <Button variant="ghost" size="sm" className="ml-auto" disabled={job.busy} onClick={() => send(true)}>Just tell me</Button>
          <Button variant="primary" size="sm" icon={<Send className="h-3.5 w-3.5" />} disabled={job.busy || !text.trim()} onClick={() => send()}>Send</Button>
        </div>
      </div>
    </div>
  );
  return <Split id="tutor-code" collapsible side="right" initial={520} min={300} max={900} className="h-full" left={chat} right={<CodePane file={view?.file} line={view?.line} />} />;
}
