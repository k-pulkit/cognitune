import { spawn } from "node:child_process";
import type { Agent, AgentRequest } from "./index.js";

/** Runs `claude -p` headless with read-only tools. The prompt goes on stdin (no argv size limit). */
export class ClaudeCliAgent implements Agent {
  readonly name = "claude CLI";

  constructor(
    private readonly command: string,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  complete(req: AgentRequest): Promise<string> {
    const args = [
      "-p",
      "--model", this.model,
      "--output-format", "text",
      "--tools", "Read", "Grep", "Glob",
      "--append-system-prompt", req.system,
    ];
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, args, { cwd: req.cwd, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`model call timed out after ${Math.round(this.timeoutMs / 1000)}s`));
      }, this.timeoutMs);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out);
        else reject(new Error(`claude exited ${code}: ${(err || out).trim().slice(-600)}`));
      });
      child.stdin.end(req.prompt);
    });
  }
}
