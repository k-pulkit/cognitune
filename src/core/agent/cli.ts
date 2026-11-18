import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The folder every model CLI runs from (~/.cognitune/agent). A CLI started inside the repo saves
 * its session under that repo, so every lens, quiz and tutor turn would show up in the user's
 * own `claude --resume` (or codex / copilot) list for that folder. Started here, they collect in
 * one place instead; the repo is passed as a readable dir.
 */
export function agentHome(): string {
  const dir = join(process.env.COGNITUNE_HOME || join(homedir(), ".cognitune"), "agent");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Run a CLI to completion and return stdout. The prompt goes on stdin when given (no argv size
 * limit). Rejects on a non-zero exit, with the tail of stderr, or on timeout.
 */
export function runCli(
  command: string,
  args: string[],
  opts: { cwd: string; stdin?: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`model call timed out after ${Math.round(opts.timeoutMs / 1000)}s`));
    }, opts.timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${command} exited ${code}: ${(err || out).trim().slice(-600)}`));
    });
    child.stdin.end(opts.stdin ?? "");
  });
}
