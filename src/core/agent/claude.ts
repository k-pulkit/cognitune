import type { Agent, AgentRequest } from "./index.js";
import { agentHome, runCli } from "./cli.js";

/**
 * Claude Code: `claude -p` headless with read-only tools. Uses the user's Claude Code login.
 * It runs from a folder under the cognitune home, not from the repo, with the repo added as a
 * readable dir and session saving off: a call started in the repo would leave a transcript in
 * that repo's Claude Code session list for every lens, quiz and tutor turn.
 */
export class ClaudeCliAgent implements Agent {
  readonly name = "Claude Code CLI";

  constructor(
    private readonly command: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly planModel = "",
  ) {}

  complete(req: AgentRequest): Promise<string> {
    const system = `${req.system}\n\nThe project folder is ${req.cwd}. File paths in this task are relative to it.`;
    const args = ["-p", "--output-format", "text", "--no-session-persistence", "--tools", "Read", "Grep", "Glob",
      "--add-dir", req.cwd, "--append-system-prompt", system];
    const model = req.role === "plan" && this.planModel ? this.planModel : this.model;
    if (model) args.push("--model", model);
    return runCli(this.command, args, { cwd: agentHome(), stdin: req.prompt, timeoutMs: this.timeoutMs });
  }
}
