import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentRequest } from "./index.js";
import { agentHome, runCli } from "./cli.js";

/**
 * OpenAI Codex CLI: `codex exec -` reads the prompt from stdin, runs in the read-only sandbox,
 * and `-o` writes only the final message to a file (progress goes to stderr). Uses the
 * login saved by `codex login`. Codex has no system-prompt flag, so the system text leads the prompt.
 * It runs from the cognitune agent folder, not the repo, so its sessions don't land in the repo's
 * `codex resume` list; the read-only sandbox can still read the repo.
 */
export class CodexCliAgent implements Agent {
  readonly name = "Codex CLI";

  constructor(
    private readonly command: string,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  async complete(req: AgentRequest): Promise<string> {
    const out = join(mkdtempSync(join(tmpdir(), "cognitune-codex-")), "last.md");
    const args = ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--cd", agentHome(), "--output-last-message", out];
    if (this.model) args.push("--model", this.model);
    args.push("-");
    const stdout = await runCli(this.command, args, { cwd: agentHome(), stdin: `${req.system}\n\nThe project folder is ${req.cwd}. File paths in this task are relative to it.\n\n---\n\n${req.prompt}`, timeoutMs: this.timeoutMs });
    try {
      return readFileSync(out, "utf8");
    } catch {
      return stdout;
    }
  }
}
