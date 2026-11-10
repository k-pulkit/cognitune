import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeAgent } from "../src/core/agent/index.js";
import { DEFAULT_SETTINGS } from "../src/core/store.js";

/**
 * Stub CLIs: each writes its argv (one per line) and stdin to files, then prints a reply.
 * The codex stub also writes the reply to the -o / --output-last-message path, like the real one.
 */
function stub(dir: string, name: string, extra = ""): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo 1.0; exit 0; fi
printf '%s\\n' "$@" > "${dir}/${name}.args"
cat > "${dir}/${name}.stdin"
${extra}
echo "reply from ${name}"
`,
  );
  chmodSync(path, 0o755);
  return path;
}

const dir = mkdtempSync(join(tmpdir(), "cognitune-stubs-"));
const settings = {
  ...DEFAULT_SETTINGS,
  "agent.claudeCommand": stub(dir, "claude"),
  "agent.codexCommand": stub(dir, "codex", `prev=""; for a in "$@"; do [ "$prev" = "--output-last-message" ] && echo "last message" > "$a"; prev="$a"; done`),
  "agent.copilotCommand": stub(dir, "copilot"),
  "agent.codexModel": "gpt-x",
};
const req = { system: "TASK: lens\nsys", prompt: "the prompt", cwd: dir };
const args = (name: string) => readFileSync(join(dir, `${name}.args`), "utf8").trim().split("\n");

describe("agent adapters", () => {
  it("auto prefers Claude Code and reports what it found", () => {
    const { info } = makeAgent({ ...settings, "agent.mode": "auto" });
    expect(info.name).toBe("Claude Code CLI");
    expect(info.available).toMatchObject({ claude: true, codex: true, copilot: true });
  });

  it("claude: prompt on stdin, system prompt and read-only tools as flags", async () => {
    const { agent } = makeAgent({ ...settings, "agent.mode": "claude" });
    expect(await agent!.complete(req)).toContain("reply from claude");
    const a = args("claude");
    expect(a.slice(0, 1)).toEqual(["-p"]);
    expect(a).toEqual(expect.arrayContaining(["--tools", "Read", "Grep", "Glob", "--append-system-prompt", "--model", "claude-sonnet-5-5"]));
    expect(readFileSync(join(dir, "claude.stdin"), "utf8")).toBe("the prompt");
  });

  it("codex: exec in the read-only sandbox, reads stdin, answer from the last-message file", async () => {
    const { agent } = makeAgent({ ...settings, "agent.mode": "codex" });
    expect((await agent!.complete(req)).trim()).toBe("last message");
    const a = args("codex");
    expect(a[0]).toBe("exec");
    expect(a).toEqual(expect.arrayContaining(["--sandbox", "read-only", "--skip-git-repo-check", "--cd", dir, "--model", "gpt-x"]));
    expect(a[a.length - 1]).toBe("-");
    expect(readFileSync(join(dir, "codex.stdin"), "utf8")).toContain("TASK: lens");
  });

  it("copilot: -p points at a task file holding system + prompt; shell and write denied", async () => {
    const { agent } = makeAgent({ ...settings, "agent.mode": "copilot" });
    expect(await agent!.complete(req)).toContain("reply from copilot");
    const a = args("copilot");
    expect(a).toEqual(expect.arrayContaining(["-s", "--no-ask-user", "--allow-tool=read", "--deny-tool=shell", "--deny-tool=write"]));
    expect(a.some((x) => x.startsWith("--model"))).toBe(false); // empty model = CLI default
    const task = /Read the file (\S+) and/.exec(a[1])![1];
    expect(readFileSync(task, "utf8")).toBe("TASK: lens\nsys\n\n---\n\nthe prompt");
  });

  it("a chosen CLI that is missing gives an install hint, no agent", () => {
    const { agent, info } = makeAgent({ ...settings, "agent.mode": "codex", "agent.codexCommand": "/nope/codex" });
    expect(agent).toBeNull();
    expect(info.detail).toContain("codex login");
  });
});
