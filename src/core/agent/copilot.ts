import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, AgentRequest } from "./index.js";
import { runCli } from "./cli.js";

/**
 * GitHub Copilot CLI: `copilot -p` runs one prompt and exits; `-s` drops the stats around the
 * answer. It has no stdin prompt, and a large prompt does not fit in one argument, so the full
 * prompt goes in a temp file the model is told to read. Only the read tool is allowed; shell and
 * write are denied. Uses the user's Copilot login (or COPILOT_GITHUB_TOKEN / GH_TOKEN).
 */
export class CopilotCliAgent implements Agent {
  readonly name = "GitHub Copilot CLI";

  constructor(
    private readonly command: string,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  async complete(req: AgentRequest): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "groklab-copilot-"));
    const file = join(dir, "task.md");
    writeFileSync(file, `${req.system}\n\n---\n\n${req.prompt}`);
    const prompt = `Read the file ${file} and do exactly what it says. Reply with the answer only.`;
    const args = ["-p", prompt, "-s", "--no-ask-user", "--allow-tool=read", "--deny-tool=shell", "--deny-tool=write", `--add-dir=${dir}`];
    if (this.model) args.push(`--model=${this.model}`);
    return runCli(this.command, args, { cwd: req.cwd, timeoutMs: this.timeoutMs });
  }
}
