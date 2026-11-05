import { useEffect, useState } from "react";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Cpu } from "lucide-react";
import type { AgentInfo, Settings } from "@core/types";
import { get, put } from "@/lib/api";
import { Button, ErrorNote, Segmented } from "@/components/ui";
import { useTheme } from "@/lib/theme";

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
                        <span className={clsx("ml-auto shrink-0 whitespace-nowrap rounded-full px-1.5 text-[10px]", found ? "bg-good/12 text-good" : "bg-raised text-muted")}>
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
        </div>

        {save.error && <div className="mt-4"><ErrorNote error={(save.error as Error).message} /></div>}
        <div className="mt-5 flex items-center justify-end gap-2">
          {save.isSuccess && !dirty && <span className="flex items-center gap-1 text-sm text-good"><Check className="h-4 w-4" /> Saved</span>}
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(q.data.settings)}>Reset</Button>
          <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(draft)}>Save</Button>
        </div>
      </div>
    </div>
  );
}
