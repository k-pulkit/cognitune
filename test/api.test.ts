import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/core/store.js";
import { createApi } from "../src/server/app.js";
import { applyHoles, cleanHoles, scoreOf } from "../src/core/services.js";
import { parseJson } from "../src/core/prompts.js";

process.env.GROKLAB_AGENT = "fake";

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "groklab-repo-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "add.py"), "def add(a, b):\n    total = a + b\n    return total\n");
  writeFileSync(join(dir, ".gitignore"), "ignored/\n");
  mkdirSync(join(dir, "ignored"));
  writeFileSync(join(dir, "ignored", "x.txt"), "x");
  g("add", ".");
  g("commit", "-q", "-m", "first");
  return dir;
}

async function waitJob(api: ReturnType<typeof createApi>, id: string) {
  for (let i = 0; i < 100; i++) {
    const j = await (await api.request(`/jobs/${id}`)).json();
    if (j.status !== "running") return j;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("job did not finish");
}

describe("api", () => {
  let api: ReturnType<typeof createApi>;
  let root: string;
  let pid: string;
  let home: string;
  const file = () => join(root, "src", "add.py");
  const post = (path: string, body: unknown, method = "POST") =>
    api.request(path, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "groklab-home-"));
    api = createApi(new Store(home));
    root = repo();
    pid = (await (await post("/projects", { root })).json()).id;
  });

  it("lists files with .gitignore applied", async () => {
    const tree = await (await api.request(`/projects/${pid}/tree`)).json();
    const names = JSON.stringify(tree);
    expect(names).toContain("add.py");
    expect(names).not.toContain("x.txt");
  });

  it("refuses files outside the project", async () => {
    const r = await api.request(`/projects/${pid}/file?path=/etc/passwd`);
    expect(r.status).toBe(400);
  });

  it("reads a context folder added to the project", async () => {
    const ctx = mkdtempSync(join(tmpdir(), "groklab-ctx-"));
    writeFileSync(join(ctx, "notes.md"), "# notes");
    expect((await post(`/projects/${pid}`, { contexts: [ctx] }, "PATCH")).status).toBe(200);
    const f = await (await api.request(`/projects/${pid}/file?path=${encodeURIComponent(join(ctx, "notes.md"))}`)).json();
    expect(f.text).toBe("# notes");
  });

  it("shows working-tree changes, untracked files included", async () => {
    writeFileSync(file(), "def add(a, b):\n    return a + b\n");
    writeFileSync(join(root, "new.py"), "x = 1\n");
    const diff = await (await api.request(`/projects/${pid}/diff?base=HEAD`)).json();
    const byName = Object.fromEntries(diff.map((d: { path: string; status: string }) => [d.path.split("/").pop(), d.status]));
    expect(byName).toEqual({ "add.py": "modified", "new.py": "added" });
  });

  it("a repo with no commits shows every file as added", async () => {
    const fresh = mkdtempSync(join(tmpdir(), "groklab-new-"));
    execFileSync("git", ["init", "-q"], { cwd: fresh });
    writeFileSync(join(fresh, "a.py"), "x = 1\n");
    const id = (await (await post("/projects", { root: fresh })).json()).id;
    const r = await api.request(`/projects/${id}/diff?base=HEAD`);
    expect(r.status).toBe(200);
    expect((await r.json()).map((d: { status: string }) => d.status)).toEqual(["added"]);
    expect((await api.request(`/projects/${id}/diff?base=nope`)).status).toBe(400);
  });

  it("makes a lens, keeps it, and maps file paths back", async () => {
    const job = await (await post(`/projects/${pid}/lenses`, { files: [file()], kind: "flow" })).json();
    const done = await waitJob(api, job.id);
    expect(done.status).toBe("done");
    const lens = await (await api.request(`/projects/${pid}/lenses/${done.resultId}`)).json();
    expect(lens.kind).toBe("flow");
    expect(lens.deepDives[0].file).toBe(file());
    expect(existsSync(join(home, "projects", pid, "lenses", `${lens.id}.json`))).toBe(true);
  });

  it("quiz -> grade -> progress: understood, then stale after the file changes", async () => {
    const qj = await waitJob(api, (await (await post(`/projects/${pid}/quizzes`, { files: [file()], count: 2 })).json()).id);
    const quiz = await (await api.request(`/projects/${pid}/quizzes/${qj.resultId}`)).json();
    expect(quiz.questions).toHaveLength(2);
    const answers = quiz.questions.map((q: { id: string }) => ({ qid: q.id, answer: "a long enough answer to be right", sure: true }));
    const gj = await waitJob(api, (await (await post(`/projects/${pid}/quizzes/${quiz.id}/attempts`, { answers })).json()).id);
    const graded = await (await api.request(`/projects/${pid}/quizzes/${gj.resultId}`)).json();
    expect(graded.attempts[0].score).toBe(1);
    let prog = await (await api.request(`/projects/${pid}/progress`)).json();
    expect(prog[0].level).toBe("understood");
    writeFileSync(file(), "def add(a, b):\n    return b + a\n");
    prog = await (await api.request(`/projects/${pid}/progress`)).json();
    expect(prog[0].level).toBe("stale");
  });

  it("empty answers are wrong whatever the model says", async () => {
    const qj = await waitJob(api, (await (await post(`/projects/${pid}/quizzes`, { files: [file()], count: 1 })).json()).id);
    const gj = await waitJob(api, (await (await post(`/projects/${pid}/quizzes/${qj.resultId}/attempts`, { answers: [] })).json()).id);
    const q = await (await api.request(`/projects/${pid}/quizzes/${gj.resultId}`)).json();
    expect(q.attempts[0].grades[0].verdict).toBe("wrong");
  });

  it("practice: holes, save attempt, review; the repo is not written", async () => {
    const before = readFileSync(file(), "utf8");
    const pj = await waitJob(api, (await (await post(`/projects/${pid}/practice`, { file: file(), level: 1 })).json()).id);
    const p = await (await api.request(`/projects/${pid}/practice/${pj.resultId}`)).json();
    expect(p.holed).toBe("def add(a, b):\n    # HOLE 1: Do the main step.\n");
    await post(`/projects/${pid}/practice/${p.id}/attempt`, { text: "def add(a, b):\n    return a + b\n" }, "PUT");
    const rj = await waitJob(api, (await (await post(`/projects/${pid}/practice/${p.id}/review`, {})).json()).id);
    const reviewed = await (await api.request(`/projects/${pid}/practice/${rj.resultId}`)).json();
    expect(reviewed.attempt).toContain("return a + b");
    expect(reviewed.review.holes[0].verdict).toBe("partial");
    expect(readFileSync(file(), "utf8")).toBe(before);
  });

  it("archive moves, never erases", async () => {
    const lj = await waitJob(api, (await (await post(`/projects/${pid}/lenses`, { files: [file()], kind: "explain" })).json()).id);
    await api.request(`/projects/${pid}/lenses/${lj.resultId}`, { method: "DELETE" });
    expect((await api.request(`/projects/${pid}/lenses/${lj.resultId}`)).status).toBe(404);
    expect(existsSync(join(home, "projects", pid, "archive", "lenses", `${lj.resultId}.json`))).toBe(true);
  });
});

describe("helpers", () => {
  it("parseJson takes the last json fence, or the outer braces", () => {
    expect(parseJson('x ```json\n{"a":1}\n``` y ```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseJson('sure: {"a": {"b": 3}} done')).toEqual({ a: { b: 3 } });
    expect(() => parseJson("no json")).toThrow();
  });

  it("cleanHoles drops overlaps and out-of-range holes, numbers in order", () => {
    const holes = cleanHoles(
      [
        { startLine: 5, endLine: 6, intent: "b" },
        { startLine: 1, endLine: 2, intent: "a" },
        { startLine: 2, endLine: 3, intent: "overlap" },
        { startLine: 9, endLine: 20, intent: "too far" },
      ],
      10,
    );
    expect(holes.map((h) => [h.id, h.intent])).toEqual([[1, "a"], [2, "b"]]);
  });

  it("applyHoles keeps indent and uses the language's comment", () => {
    const out = applyHoles("a\n  b\n  c\nd", [{ id: 1, startLine: 2, endLine: 3, intent: "x", hints: [] }], "typescript");
    expect(out).toBe("a\n  // HOLE 1: x\nd");
    expect(applyHoles("<p>\n</p>", [{ id: 1, startLine: 1, endLine: 1, intent: "y", hints: [] }], "html")).toBe("<!-- HOLE 1: y -->\n</p>");
  });

  it("scoreOf counts partial as half", () => {
    expect(scoreOf([
      { qid: "q1", verdict: "right", feedback: "", modelAnswer: "" },
      { qid: "q2", verdict: "partial", feedback: "", modelAnswer: "" },
    ])).toBe(0.75);
  });
});
