import { execFileSync } from "node:child_process";
import type { AgentInfo, Settings } from "../types.js";
import { ClaudeCliAgent } from "./claude.js";
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

/**
 * Pick the adapter from settings. `auto`: the claude CLI when it is installed (uses the user's
 * Claude Code login, no key handling), else the SDK when ANTHROPIC_API_KEY is set.
 */
export function makeAgent(s: Settings): { agent: Agent | null; info: AgentInfo } {
  const mode = process.env.GROKLAB_AGENT || s["agent.mode"];
  const timeoutMs = s["agent.timeoutSec"] * 1000;
  if (mode === "fake") {
    return { agent: new FakeAgent(), info: { mode, name: "fake", ready: true, detail: "Canned answers for tests and demos." } };
  }
  const wantCli = mode === "claude" || mode === "auto";
  const wantSdk = mode === "sdk" || mode === "auto";
  if (wantCli && hasCommand(s["agent.claudeCommand"])) {
    return {
      agent: new ClaudeCliAgent(s["agent.claudeCommand"], s["agent.model"], timeoutMs),
      info: { mode, name: "claude CLI", ready: true, detail: `${s["agent.claudeCommand"]} -p, model ${s["agent.model"]}, read-only tools` },
    };
  }
  if (wantSdk && process.env.ANTHROPIC_API_KEY) {
    return {
      agent: new SdkAgent(s["agent.model"], timeoutMs),
      info: { mode, name: "Anthropic API", ready: true, detail: `model ${s["agent.model"]}, key from ANTHROPIC_API_KEY` },
    };
  }
  const detail =
    mode === "claude"
      ? `Command "${s["agent.claudeCommand"]}" not found. Install Claude Code or change the command in Settings.`
      : mode === "sdk"
        ? "Set ANTHROPIC_API_KEY in the environment, then restart groklab."
        : "No model found. Install Claude Code (claude) or set ANTHROPIC_API_KEY, then restart.";
  return { agent: null, info: { mode, name: "none", ready: false, detail } };
}
