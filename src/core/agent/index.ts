import { execFileSync } from "node:child_process";
import type { AgentInfo, Settings } from "../types.js";
import { ClaudeCliAgent } from "./claude.js";
import { CodexCliAgent } from "./codex.js";
import { CopilotCliAgent } from "./copilot.js";
import { FakeAgent } from "./fake.js";
import { SdkAgent } from "./sdk.js";

export interface AgentRequest {
  system: string;
  prompt: string;
  /** Folder the agent may read (claude CLI only; the SDK gets file text in the prompt). */
  cwd: string;
}

/** One model call, text in, text out. Adapters hide how the model is reached. */
export interface Agent {
  readonly name: string;
  complete(req: AgentRequest): Promise<string>;
}

function hasCommand(cmd: string): boolean {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

type Provider = "claude" | "codex" | "copilot" | "sdk";

/** What each provider needs, in the order `auto` tries them. */
function providers(s: Settings, timeoutMs: number) {
  return [
    {
      id: "claude" as Provider,
      label: "Claude Code CLI",
      available: () => hasCommand(s["agent.claudeCommand"]),
      make: () => new ClaudeCliAgent(s["agent.claudeCommand"], s["agent.model"], timeoutMs),
      detail: `${s["agent.claudeCommand"]} -p, model ${s["agent.model"] || "CLI default"}, read-only tools, your Claude Code login`,
      missing: `"${s["agent.claudeCommand"]}" not found. Install Claude Code and run it once to log in.`,
    },
    {
      id: "codex" as Provider,
      label: "Codex CLI",
      available: () => hasCommand(s["agent.codexCommand"]),
      make: () => new CodexCliAgent(s["agent.codexCommand"], s["agent.codexModel"], timeoutMs),
      detail: `${s["agent.codexCommand"]} exec, read-only sandbox, model ${s["agent.codexModel"] || "CLI default"}, your codex login`,
      missing: `"${s["agent.codexCommand"]}" not found. Install it (npm i -g @openai/codex) and run "codex login".`,
    },
    {
      id: "copilot" as Provider,
      label: "GitHub Copilot CLI",
      available: () => hasCommand(s["agent.copilotCommand"]),
      make: () => new CopilotCliAgent(s["agent.copilotCommand"], s["agent.copilotModel"], timeoutMs),
      detail: `${s["agent.copilotCommand"]} -p, read tool only, model ${s["agent.copilotModel"] || "CLI default"}, your GitHub login`,
      missing: `"${s["agent.copilotCommand"]}" not found. Install it (npm i -g @github/copilot) and log in once.`,
    },
    {
      id: "sdk" as Provider,
      label: "Anthropic API",
      available: () => !!process.env.ANTHROPIC_API_KEY,
      make: () => new SdkAgent(s["agent.model"], timeoutMs),
      detail: `model ${s["agent.model"]}, key from the ANTHROPIC_API_KEY environment variable`,
      missing: "Set ANTHROPIC_API_KEY in the environment, then restart groklab.",
    },
  ];
}

/**
 * Pick the adapter from settings. CLIs use their own saved login, so groklab never asks for or
 * stores a key. `auto` tries Claude Code, then Codex, then Copilot, then ANTHROPIC_API_KEY.
 */
export function makeAgent(s: Settings): { agent: Agent | null; info: AgentInfo } {
  const mode = process.env.GROKLAB_AGENT || s["agent.mode"];
  const timeoutMs = s["agent.timeoutSec"] * 1000;
  const all = providers(s, timeoutMs);
  const available = Object.fromEntries(all.map((p) => [p.id, p.available()]));
  if (mode === "fake") {
    return { agent: new FakeAgent(), info: { mode, name: "fake", ready: true, detail: "Canned answers for tests and demos.", available } };
  }
  const pick = mode === "auto" ? all.find((p) => available[p.id]) : all.find((p) => p.id === mode && available[p.id]);
  if (pick) return { agent: pick.make(), info: { mode, name: pick.label, ready: true, detail: pick.detail, available } };
  const wanted = all.find((p) => p.id === mode);
  const detail = wanted ? wanted.missing : "No model found. Install Claude Code, Codex or Copilot CLI, or set ANTHROPIC_API_KEY, then restart.";
  return { agent: null, info: { mode, name: "none", ready: false, detail, available } };
}
