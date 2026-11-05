import { useEffect, useState } from "react";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Cpu, HardDrive, History } from "lucide-react";
import type { AgentInfo, Job, Settings, StorageUsage } from "@core/types";
import { get, post, put, relTime } from "@/lib/api";
import { Button, ErrorNote, Segmented } from "@/components/ui";
import { useReadingFont, useTheme } from "@/lib/theme";

interface Resp {
  settings: Settings;
  agent: AgentInfo;
  home: string;
}

const PROVIDERS: { id: Settings["agent.mode"]; label: string; text: string }[] = [
  { id: "auto", label: "Auto", text: "Claude Code, then Codex, then Copilot, then API key." },
  { id: "claude", label: "Claude Code CLI", text: "claude -p with read-only tools. Default." },
  { id: "codex", label: "Codex CLI", text: "codex exec in the read-only sandbox." },
  { id: "copilot", label: "GitHub Copilot CLI", text: "copilot -p with only the read tool." },
  { id: "sdk", label: "Anthropic API key", text: "ANTHROPIC_API_KEY from the environment." },
  { id: "fake", label: "Demo", text: "Canned answers, no model." },
];

const mb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

/** What groklab keeps on disk, and a button to apply the limits now. */
function StorageCard() {
  const qc = useQueryClient();
  const u = useQuery({ queryKey: ["storage"], queryFn: () => get<StorageUsage>("/storage") });
  const clean = useMutation({
    mutationFn: () => post<{ removed: number; freedBytes: number; usage: StorageUsage }>("/storage/prune"),
    onSuccess: (r) => qc.setQueryData(["storage"], r.usage),
  });
  if (!u.data) return null;
  const max = Math.max(1, ...u.data.parts.map((x) => x.bytes));
  return (
    <div className="card mt-6 p-5">
      <div className="flex items-center gap-2">
        <HardDrive className="h-4 w-4 text-accent" />
        <div className="text-sm font-semibold">Storage</div>
        <span className="text-sm text-muted">{mb(u.data.totalBytes)}</span>
        <Button size="sm" className="ml-auto shrink-0 whitespace-nowrap" loading={clean.isPending} onClick={() => clean.mutate()}>Clean up now</Button>
      </div>
      <div className="mt-0.5 break-all font-mono text-[12px] text-muted">{u.data.home}</div>
      <p className="mt-1 text-xs text-muted">
        Plain JSON files, one per item. Archived items and forgotten projects are removed after the keep time below, the reply cache keeps
        to its size, and long lists (quiz attempts, card history, tutor chats, jobs) are capped. Cleanup runs at start and every 6 hours.
      </p>
      <div className="mt-3 space-y-1.5">
        {u.data.parts.map((x) => (
          <div key={x.name} className="flex items-center gap-3 text-xs">
            <span className="w-32 shrink-0 capitalize text-muted">{x.name}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised"><div className="h-full bg-accent/60" style={{ width: `${(x.bytes / max) * 100}%` }} /></div>
            <span className="w-28 shrink-0 text-right tabular-nums text-muted">{mb(x.bytes)} · {x.files} file{x.files === 1 ? "" : "s"}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 text-[12px] text-muted">
        {clean.data ? `Removed ${clean.data.removed} item${clean.data.removed === 1 ? "" : "s"}, freed ${mb(clean.data.freedBytes)}.` : u.data.lastPrune ? `Last cleanup ${relTime(u.data.lastPrune.at)}: removed ${u.data.lastPrune.removed}.` : ""}
      </div>
    </div>
  );
}

function JobsCard() {
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => get<Job[]>("/jobs") });
  const list = (jobs.data ?? []).slice(0, 12);
  if (!list.length) return null;
  const secs = (j: Job) => (j.endedAt ? Math.round((Date.parse(j.endedAt) - Date.parse(j.startedAt)) / 1000) : null);
  return (
    <div className="card mt-6 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-accent" /> Recent model calls</div>
      <table className="mt-3 w-full text-xs">
        <tbody>
          {list.map((j) => (
            <tr key={j.id} className="border-b border-line/60 last:border-0">
              <td className="py-1.5 pr-3 font-medium">{j.kind}</td>
              <td className={clsx("py-1.5 pr-3", j.status === "failed" ? "text-bad" : j.status === "running" ? "text-accent" : "text-good")}>{j.status}</td>
              <td className="py-1.5 pr-3 tabular-nums text-muted">{secs(j) !== null ? `${secs(j)} s` : ""}</td>
              <td className="max-w-[320px] truncate py-1.5 pr-3 text-muted" title={j.error}>{j.error ?? ""}</td>
              <td className="py-1.5 text-right text-muted">{relTime(j.startedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 py-4 sm:grid-cols-[220px_1fr] sm:gap-6">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: () => get<Resp>("/settings") });
  const [draft, setDraft] = useState<Settings | null>(null);
  const { pref, setPref } = useTheme();
  const { font, setFont } = useReadingFont();
  useEffect(() => {
    if (q.data && !draft) setDraft(q.data.settings);
  }, [q.data, draft]);
  const save = useMutation({
    mutationFn: (s: Settings) => put<Resp>("/settings", s),
    onSuccess: (r) => {
      qc.setQueryData(["settings"], r);
      qc.invalidateQueries({ queryKey: ["health"] });
      setDraft(r.settings);
    },
  });
  if (!q.data || !draft) return null;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft({ ...draft, [k]: v });
  const dirty = JSON.stringify(draft) !== JSON.stringify(q.data.settings);
  const agent = save.data?.agent ?? q.data.agent;

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Saved in <span className="font-mono">{q.data.home}/settings.json</span>
        </p>

        <div className={clsx("card mt-6 flex items-start gap-3 p-4", agent.ready ? "border-good/30" : "border-bad/30")}>
          <div className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-lg", agent.ready ? "bg-good/12 text-good" : "bg-bad/12 text-bad")}>
            <Cpu className="h-[18px] w-[18px]" />
          </div>
          <div>
            <div className="text-sm font-semibold">{agent.ready ? `Model ready: ${agent.name}` : "No model available"}</div>
            <div className="text-sm text-muted">{agent.detail}</div>
          </div>
        </div>

        <div className="card mt-6 divide-y divide-line px-5">
          <Field label="Theme">
            <Segmented value={pref} onChange={setPref} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
          </Field>
          <Field label="Reading font" hint="For lessons, feedback and tutor replies. Buttons and labels stay in Inter.">
            <div className="flex items-center gap-4">
              <Segmented value={font} onChange={setFont} options={[{ value: "serif", label: "Serif" }, { value: "sans", label: "Sans" }]} />
              <span className="reading text-muted">Read the code, then explain it.</span>
            </div>
          </Field>
          <Field label="Model access" hint="CLIs use their own saved login, so groklab never needs or stores a key. Auto picks the first one found.">
            <div className="grid gap-2 sm:grid-cols-2">
              {PROVIDERS.map((p) => {
                const found = agent.available?.[p.id];
                const on = draft["agent.mode"] === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => set("agent.mode", p.id)}
                    className={clsx(
                      "rounded-lg border px-3 py-2 text-left transition",
                      on ? "border-accent/60 bg-accent/8 ring-1 ring-accent/30" : "border-line hover:bg-raised",
                    )}
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {p.label}
                      {p.id !== "auto" && p.id !== "fake" && (
                        <span className={clsx("ml-auto shrink-0 whitespace-nowrap rounded-full px-1.5 text-[11.5px]", found ? "bg-good/12 text-good" : "bg-raised text-muted")}>
                          {found ? "found" : "not found"}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted">{p.text}</div>
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Claude" hint="Command and model for the Claude Code CLI (model also used by the API key mode).">
            <div className="flex gap-2">
              <input className="input w-36 font-mono" value={draft["agent.claudeCommand"]} onChange={(e) => set("agent.claudeCommand", e.target.value)} />
              <input className="input font-mono" placeholder="CLI default" value={draft["agent.model"]} onChange={(e) => set("agent.model", e.target.value)} />
            </div>
          </Field>
          <Field label="Codex" hint="Command and model for the OpenAI Codex CLI. Empty model = its default.">
            <div className="flex gap-2">
              <input className="input w-36 font-mono" value={draft["agent.codexCommand"]} onChange={(e) => set("agent.codexCommand", e.target.value)} />
              <input className="input font-mono" placeholder="CLI default" value={draft["agent.codexModel"]} onChange={(e) => set("agent.codexModel", e.target.value)} />
            </div>
          </Field>
          <Field label="Copilot" hint="Command and model for the GitHub Copilot CLI. Empty model = its default.">
            <div className="flex gap-2">
              <input className="input w-36 font-mono" value={draft["agent.copilotCommand"]} onChange={(e) => set("agent.copilotCommand", e.target.value)} />
              <input className="input font-mono" placeholder="CLI default" value={draft["agent.copilotModel"]} onChange={(e) => set("agent.copilotModel", e.target.value)} />
            </div>
          </Field>
          <Field label="Timeout" hint="Seconds per model call.">
            <input type="number" min={30} className="input w-32" value={draft["agent.timeoutSec"]} onChange={(e) => set("agent.timeoutSec", Number(e.target.value))} />
          </Field>
          <Field label="Questions per quiz">
            <input type="number" min={1} max={10} className="input w-32" value={draft["quiz.questions"]} onChange={(e) => set("quiz.questions", Number(e.target.value))} />
          </Field>
          <Field label="Pass mark" hint="Share of points to count a file as understood (partial = half).">
            <input type="number" min={0.1} max={1} step={0.01} className="input w-32" value={draft["quiz.passMark"]} onChange={(e) => set("quiz.passMark", Number(e.target.value))} />
          </Field>
          <Field label="Context size" hint="Most bytes of code sent in one prompt.">
            <input type="number" min={10000} step={10000} className="input w-40" value={draft["context.maxBytes"]} onChange={(e) => set("context.maxBytes", Number(e.target.value))} />
          </Field>
          <Field label="Cards from misses" hint="Each wrong or partial quiz answer becomes a review card.">
            <Segmented value={draft["cards.fromMisses"] ? "on" : "off"} onChange={(v) => set("cards.fromMisses", v === "on")} options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]} />
          </Field>
          <Field label="Fade after" hint="Days without recall before an understood file shows as fading. 0 = never.">
            <input type="number" min={0} className="input w-32" value={draft["progress.fadeDays"]} onChange={(e) => set("progress.fadeDays", Number(e.target.value))} />
          </Field>
          <Field label="Notes in prompts" hint="Send your margin notes on a file with its code, so lenses and the tutor can use them.">
            <Segmented value={draft["notes.inPrompts"] ? "on" : "off"} onChange={(v) => set("notes.inPrompts", v === "on")} options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]} />
          </Field>
          <Field label="Keep archive" hint="Days an archived item or forgotten project is kept before it is removed for good. 0 = forever.">
            <input type="number" min={0} className="input w-32" value={draft["storage.archiveDays"]} onChange={(e) => set("storage.archiveDays", Number(e.target.value))} />
          </Field>
          <Field label="Reply cache" hint="Most MB of saved model replies (the same lens twice is free). Oldest go first.">
            <input type="number" min={0} className="input w-32" value={draft["storage.cacheMB"]} onChange={(e) => set("storage.cacheMB", Number(e.target.value))} />
          </Field>
          <Field label="Attempts per quiz" hint="Older graded attempts are dropped; the best one is always kept.">
            <input type="number" min={1} className="input w-32" value={draft["storage.maxAttempts"]} onChange={(e) => set("storage.maxAttempts", Number(e.target.value))} />
          </Field>
        </div>

        {save.error && <div className="mt-4"><ErrorNote error={(save.error as Error).message} /></div>}
        <div className="mt-5 flex items-center justify-end gap-2">
          {save.isSuccess && !dirty && <span className="flex items-center gap-1 text-sm text-good"><Check className="h-4 w-4" /> Saved</span>}
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(q.data.settings)}>Reset</Button>
          <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(draft)}>Save</Button>
        </div>
        <StorageCard />
        <JobsCard />
      </div>
    </div>
  );
}
