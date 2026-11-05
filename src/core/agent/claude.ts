import type { Agent, AgentRequest } from "./index.js";
import { runCli } from "./cli.js";

/** Claude Code: `claude -p` headless with read-only tools. Uses the user's Claude Code login. */
export class ClaudeCliAgent implements Agent {
  readonly name = "Claude Code CLI";

  constructor(
    private readonly command: string,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  complete(req: AgentRequest): Promise<string> {
    const args = ["-p", "--output-format", "text", "--tools", "Read", "Grep", "Glob", "--append-system-prompt", req.system];
    if (this.model) args.push("--model", this.model);
    return runCli(this.command, args, { cwd: req.cwd, stdin: req.prompt, timeoutMs: this.timeoutMs });
  }
}
