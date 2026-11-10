import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { importGraph } from "../src/core/graph.js";
import { progress, rateCard, makeCard, streak } from "../src/core/insights.js";
import { Jobs } from "../src/core/jobs.js";
import { FakeAgent } from "../src/core/agent/fake.js";
import { Learn, matchMarks, plantBugs } from "../src/core/services.js";
import { prune, ReplyCache, usage } from "../src/core/storage.js";
import { Store } from "../src/core/store.js";
import { createApi } from "../src/server/app.js";

process.env.COGNITUNE_AGENT = "fake";

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "cognitune-repo-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "add.ts"), "import { two } from \"./two.js\";\nexport function add(a: number) {\n  const total = a + two();\n  return total;\n}\n");
  writeFileSync(join(dir, "src", "two.ts"), "export function two() {\n  return 2;\n}\n");
  writeFileSync(join(dir, "README.md"), "# demo\n");
  g("add", ".");
  g("commit", "-q", "-m", "first");
  return dir;
}

async function waitJob(api: ReturnType<typeof createApi>, id: string) {
  for (let i = 0; i < 200; i++) {
    const j = await (await api.request(`/jobs/${id}`)).json();
    if (j.status !== "running") return j;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("job did not finish");
}

describe("learning features", () => {
  let api: ReturnType<typeof createApi>;
  let store: Store;
  let root: string;
  let pid: string;
  const add = () => join(root, "src", "add.ts");
  const send = (path: string, body: unknown, method = "POST") =>
    api.request(`/projects/${pid}${path}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const get = async (path: string) => (await api.request(`/projects/${pid}${path}`)).json();
  /** Start a job and return its finished state. */
  const job = async (path: string, body: unknown) => {
    const r = await send(path, body);
    expect(r.status).toBe(202);
    const j = await waitJob(api, (await r.json()).id);
    expect(j.error ?? "").toBe("");
    return j;
  };

  beforeEach(async () => {
    store = new Store(mkdtempSync(join(tmpdir(), "cognitune-home-")));
    api = createApi(store);
    root = repo();
    pid = (await (await api.request("/projects", { method: "POST", body: JSON.stringify({ root }), headers: { "content-type": "application/json" } })).json()).id;
  });

  it("turns quiz misses into cards and misconceptions, and a weak-spot quiz resolves them", async () => {
    const q = await job("/quizzes", { files: [add()], count: 2 });
    await job(`/quizzes/${q.resultId}/attempts`, { answers: [{ qid: "q1", answer: "no", sure: true }, { qid: "q2", answer: "", sure: false }] });
    const cards = await get("/cards");
    expect(cards).toHaveLength(2);
    expect(cards[0].kind).toBe("miss");
    const mis = await get("/misconceptions");
    expect(mis.length).toBe(1); // the empty answer gets no misconception
    // Retaking does not duplicate cards.
    await job(`/quizzes/${q.resultId}/attempts`, { answers: [{ qid: "q1", answer: "no", sure: true }] });
    expect(await get("/cards")).toHaveLength(2);

    const weak = await job("/quizzes", { files: [], weak: true });
    const wq = await get(`/quizzes/${weak.resultId}`);
    expect(wq.questions[0].misconceptionId).toBe(mis[0].id);
    await job(`/quizzes/${weak.resultId}/attempts`, { answers: [{ qid: "q1", answer: "a long enough answer to count as right", sure: true }] });
    expect(await get("/misconceptions")).toHaveLength(0);
  });

  it("schedules cards: again comes back sooner than easy", async () => {
    const r = await send("/cards", { front: "What does add return?", back: "a + 2", file: add(), line: 4 });
    const card = await r.json();
    const due = await get("/cards/due");
    expect(due).toHaveLength(1);
    expect(Date.parse(due[0].next.again)).toBeLessThan(Date.parse(due[0].next.easy));
    const rated = await (await send(`/cards/${card.id}/review`, { rating: "easy" })).json();
    expect(Date.parse(rated.fsrs.due)).toBeGreaterThan(Date.now() + 86_400_000);
    expect(await get("/cards/due")).toHaveLength(0);
    expect((await send(`/cards/${card.id}/review`, { rating: "meh" })).status).toBe(400);
  });

  it("caps the card review log", () => {
    let c = makeCard("p", { kind: "own", front: "f", back: "b" });
    for (let i = 0; i < 70; i++) c = rateCard(c, "good", new Date(Date.now() + i * 1000));
    expect(c.reviews.length).toBe(50);
  });

  it("lens with a sketch lists differences; trace lens has steps; refresh replaces the lens", async () => {
    const j = await job("/lenses", { files: [add()], kind: "explain", sketch: "It adds two numbers." });
    const l = await get(`/lenses/${j.resultId}`);
    expect(l.sketch).toBe("It adds two numbers.");
    expect(l.differences.length).toBeGreaterThan(0);
    expect(l.tldr).toContain("one idea");
    expect(l.deepDives[0].check.q).toBeTruthy();
    expect(l.nextSteps[0].file).toBe(add());
    expect(l.fileHashes[add()]).toBeTruthy();

    const t = await job("/lenses", { files: [add()], kind: "trace", traceInput: "a = 1" });
    const tl = await get(`/lenses/${t.resultId}`);
    expect(tl.trace.input).toBe("a = 1");
    expect(tl.trace.steps.length).toBe(3);

    const r = await job(`/lenses/${t.resultId}/refresh`, {});
    expect(r.resultId).not.toBe(t.resultId);
    expect((await api.request(`/projects/${pid}/lenses/${t.resultId}`)).status).toBe(404);
    const md = await (await api.request(`/projects/${pid}/lenses/${r.resultId}/export`)).text();
    expect(md).toContain("## Trace");
    expect(md).toContain("Covers: src/add.ts");
  });

  it("history lens reads git log", async () => {
    const j = await job("/lenses", { files: [add()], kind: "history" });
    expect((await get(`/lenses/${j.resultId}`)).kind).toBe("history");
  });

  it("builds a lens in parts: planner outlines, writer fills the opening and the steps", async () => {
    const seen: { task: string; role?: string; prompt: string }[] = [];
    const fake = new FakeAgent();
    const learn = new Learn(store, { name: "spy", complete: async (r) => (seen.push({ task: /^TASK: (\w+)/m.exec(r.system)![1], role: r.role, prompt: r.prompt }), fake.complete(r)) });
    const l = await learn.lens(store.project(pid)!, { files: [add()], kind: "explain", depth: "deep" });
    const tasks = seen.map((x) => x.task);
    expect(tasks[0]).toBe("lensPlan");
    expect(seen[0].role).toBe("plan");
    expect(tasks).toContain("lensIntro");
    expect(tasks.filter((t) => t === "lensSteps")).toHaveLength(2); // 4 planned steps, 3 per call
    expect(seen.find((x) => x.task === "lensSteps")!.prompt).toContain("PLAN (from the planner");
    expect(l.deepDives).toHaveLength(4);
    expect(l.deepDives[3].body).toContain("Fake body for step 3");
    expect(l.deepDives[0].check?.q).toBeTruthy();
    expect(l.summary).toContain("fake lesson");
  });

  it("the short generators get a plan first when the setting is on", async () => {
    const roles: (string | undefined)[] = [];
    const tasks: string[] = [];
    const fake = new FakeAgent();
    const spy = { name: "spy", complete: async (r: Parameters<FakeAgent["complete"]>[0]) => (tasks.push(/^TASK: (\w+)/m.exec(r.system)![1]), roles.push(r.role), fake.complete(r)) };
    await new Learn(store, spy).quiz(store.project(pid)!, { files: [add()] });
    expect(tasks).toEqual(["plan", "quiz"]);
    expect(roles[0]).toBe("plan");
    store.saveSettings({ "generate.plan": false });
    tasks.length = 0;
    await new Learn(store, spy).quiz(store.project(pid)!, { files: [add()] });
    expect(tasks).toEqual(["quiz"]);
  });

  it("walk blocks come with an explanation and a worked example", async () => {
    const j = await job("/walks", { file: add() });
    const w = await get(`/walks/${j.resultId}`);
    expect(w.blocks[0].explain).toContain("Fake explanation");
    expect(w.blocks[0].example).toContain("```");
    expect(w.blocks[0].question).toContain("Fake question");
  });

  it("caches a lens reply: the same lens twice is one model call", async () => {
    store.saveSettings({ "generate.plan": false });
    let calls = 0;
    const learn = new Learn(store, { name: "count", complete: async () => (calls++, '```json\n{"title":"t","tldr":"the one idea here","summary":"s","deepDives":[{"title":"a","body":"b","line":2}]}\n```') });
    const p = store.project(pid)!;
    await learn.lens(p, { files: [add()], kind: "explain" });
    await learn.lens(p, { files: [add()], kind: "explain" });
    expect(calls).toBe(1);
  });

  it("retries once when the reply has the wrong shape", async () => {
    store.saveSettings({ "generate.plan": false });
    const replies = ['```json\n{"title":"t"}\n```', '```json\n{"title":"t","tldr":"the one idea here","summary":"s","deepDives":[{"title":"a","body":"b","line":2}]}\n```'];
    const prompts: string[] = [];
    const learn = new Learn(store, { name: "retry", complete: async (r) => (prompts.push(r.prompt), replies.shift()!) });
    const l = await learn.lens(store.project(pid)!, { files: [add()], kind: "flow" });
    expect(l.title).toBe("t");
    expect(l.tldr).toBe("the one idea here");
    // A step with only a key line gets a small window of lines to show.
    expect([l.deepDives[0].startLine, l.deepDives[0].endLine]).toEqual([1, 8]);
    expect(prompts[1]).toContain("COULD NOT BE USED");
    const bad = new Learn(store, { name: "bad", complete: async () => '```json\n{"nope":1}\n```' });
    await expect(bad.lens(store.project(pid)!, { files: [add()], kind: "state" })).rejects.toThrow(/expected shape/);
  });

  it("teach-back grades and marks the file understood at score 4+", async () => {
    const short = await job("/teachbacks", { files: [add()], text: "It adds a number to two and then returns it." });
    expect((await get(`/teachbacks/${short.resultId}`)).grade.score).toBe(3);
    expect((await get("/misconceptions")).length).toBe(1);
    await job("/teachbacks", { files: [add()], text: "x".repeat(130) });
    const prog = await get("/progress");
    expect(prog.find((p: { path: string }) => p.path === add()).level).toBe("understood");
    expect((await send("/teachbacks", { files: [add()], text: "short" })).status).toBe(202);
  });

  it("tutor climbs the hint ladder and tells on request", async () => {
    const j = await job("/threads", { files: [add()], text: "What does add do?" });
    await job(`/threads/${j.resultId}/messages`, { text: "It returns a number?" });
    await job(`/threads/${j.resultId}/messages`, { tell: true });
    const t = await get(`/threads/${j.resultId}`);
    expect(t.messages.map((m: { hintLevel?: number }) => m.hintLevel ?? 0)).toEqual([0, 1, 0, 2, 0, 4]);
    expect(t.messages[5].text).toContain("Here is the answer");
  });

  it("walkthrough grades each block", async () => {
    const j = await job("/walks", { file: add() });
    await job(`/walks/${j.resultId}/blocks/0`, { answer: "it imports the helper two from a sibling" });
    await job(`/walks/${j.resultId}/blocks/1`, { answer: "the sum" });
    const w = await get(`/walks/${j.resultId}`);
    expect(w.blocks.map((b: { verdict: string }) => b.verdict)).toEqual(["right", "partial"]);
  });

  it("bug hunt hides the bugs until graded", async () => {
    const j = await job("/hunts", { file: add(), level: 1 });
    const before = await get(`/hunts/${j.resultId}`);
    expect(before.planted).toEqual([null]);
    expect(before.text).toContain("// changed");
    await send(`/hunts/${j.resultId}/marks`, { marks: [{ line: 1, why: "the import changed" }, { line: 4, why: "maybe" }] }, "PUT");
    await job(`/hunts/${j.resultId}/grade`, {});
    const after = await get(`/hunts/${j.resultId}`);
    expect(after.planted[0].line).toBe(1);
    expect(after.grade.found).toHaveLength(1);
    expect(after.grade.falseAlarms).toHaveLength(1);
    expect(after.grade.score).toBe(0.5);
    expect((await send(`/hunts/${j.resultId}/marks`, { marks: [] }, "PUT")).status).toBe(400);
  });

  it("plants bugs by text when the line number is off, and matches marks within one line", () => {
    const { text, planted } = plantBugs("a\n  b = 1\nc", [{ line: 1, original: "b = 1", buggy: "b = 2", what: "w" }, { line: 3, original: "zzz", buggy: "y", what: "w" }]);
    expect(text).toBe("a\n  b = 2\nc");
    expect(planted).toHaveLength(1);
    const m = matchMarks(planted, [{ line: 3, why: "" }, { line: 1, why: "" }]);
    expect(m.found).toHaveLength(1);
    expect(m.falseAlarms).toHaveLength(1);
  });

  it("builds an import graph and a path whose stops tick off", async () => {
    const g = await get("/graph");
    expect(g.edges).toEqual([{ from: add(), to: join(root, "src", "two.ts") }]);
    const j = await job("/paths", { goal: "learn add" });
    const path = await get(`/paths/${j.resultId}`);
    expect(path.stops.length).toBeGreaterThan(1);
    expect(path.done.every((d: boolean) => !d)).toBe(true);
    const first = path.stops[0];
    await job("/lenses", { files: first.files, kind: "explain" });
    expect((await get(`/paths/${j.resultId}`)).done[0]).toBe(true);
    const today = await get("/today");
    expect(today.nextStop.index).toBe(1);
  });

  it("import graph handles python relative and absolute imports", () => {
    const d = mkdtempSync(join(tmpdir(), "cognitune-py-"));
    mkdirSync(join(d, "pkg"));
    writeFileSync(join(d, "pkg", "__init__.py"), "");
    writeFileSync(join(d, "pkg", "a.py"), "from .b import f\nimport pkg.c\n");
    writeFileSync(join(d, "pkg", "b.py"), "def f(): pass\n");
    writeFileSync(join(d, "pkg", "c.py"), "from pkg import b\n");
    const files = ["pkg/__init__.py", "pkg/a.py", "pkg/b.py", "pkg/c.py"].map((f) => join(d, f));
    const g = importGraph(d, files);
    const e = g.edges.map((x) => `${x.from.slice(d.length + 1)}>${x.to.slice(d.length + 1)}`).sort();
    expect(e).toContain("pkg/a.py>pkg/b.py");
    expect(e).toContain("pkg/a.py>pkg/c.py");
    expect(e).toContain("pkg/c.py>pkg/b.py");
  });

  it("import graph follows tsconfig path aliases", () => {
    const d = mkdtempSync(join(tmpdir(), "cognitune-alias-"));
    mkdirSync(join(d, "web", "src", "lib"), { recursive: true });
    writeFileSync(join(d, "web", "tsconfig.json"), '{ // comment\n "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], } } }');
    writeFileSync(join(d, "web", "src", "main.tsx"), 'import { a } from "@/lib/a";\nimport x from "react";\n');
    writeFileSync(join(d, "web", "src", "lib", "a.ts"), "export const a = 1;\n");
    const files = ["web/tsconfig.json", "web/src/main.tsx", "web/src/lib/a.ts"].map((f) => join(d, f));
    const g = importGraph(d, files);
    expect(g.edges).toEqual([{ from: join(d, "web", "src", "main.tsx"), to: join(d, "web", "src", "lib", "a.ts") }]);
  });

  it("glossary merges lens concepts; notes attach to lines", async () => {
    await job("/lenses", { files: [add()], kind: "explain" });
    await job("/lenses", { files: [add()], kind: "concepts" });
    const terms = await get("/glossary");
    expect(terms.map((t: { term: string }) => t.term)).toEqual(["Entry point", "Side effect"]);
    const n = await (await send("/notes", { file: add(), line: 3, text: "two() is the helper" })).json();
    expect(await get(`/notes?file=${encodeURIComponent(add())}`)).toHaveLength(1);
    await send(`/notes/${n.id}`, {}, "DELETE");
    expect(await get("/notes")).toHaveLength(0);
  });

  it("progress fades after the fade window and goes stale when the file changes", async () => {
    const q = await job("/quizzes", { files: [add()], count: 1 });
    await job(`/quizzes/${q.resultId}/attempts`, { answers: [{ qid: "q1", answer: "a long enough answer to count as right", sure: true }] });
    const p = store.project(pid)!;
    expect(progress(store, p).find((x) => x.path === add())!.level).toBe("understood");
    expect(progress(store, p, Date.now() + 30 * 86_400_000).find((x) => x.path === add())!.level).toBe("fading");
    writeFileSync(add(), "export const changed = 1;\n");
    expect(progress(store, p).find((x) => x.path === add())!.level).toBe("stale");
    expect(streak(store, pid)).toBe(1);
  });

  it("today suggests the most depended-on file on a fresh project, then due cards", async () => {
    const t = await get("/today");
    expect(t.suggestion.files).toEqual([join(root, "src", "two.ts")]);
    await send("/cards", { front: "f", back: "b" });
    expect((await get("/today")).suggestion.activity).toBe("review");
  });

  it("estimates prompt size", async () => {
    const e = await (await send("/estimate", { files: [add()] })).json();
    expect(e.tokens).toBeGreaterThan(10);
    expect(e.cut).toBe(false);
  });
});

describe("storage stays bounded", () => {
  it("removes old archive, trims the cache and quiz attempts, keeps the best attempt", () => {
    const home = mkdtempSync(join(tmpdir(), "cognitune-home-"));
    const store = new Store(home);
    store.saveSettings({ "storage.archiveDays": 10, "storage.cacheMB": 0, "storage.maxAttempts": 3 });
    const p = store.openProject(mkdtempSync(join(tmpdir(), "cognitune-x-")));
    const card = store.put(p.id, "cards", makeCard(p.id, { kind: "own", front: "f", back: "b" }));
    store.archive(p.id, "cards", card.id);
    const archived = join(home, "projects", p.id, "archive", "cards", `${card.id}.json`);
    const old = new Date(Date.now() - 11 * 86_400_000);
    utimesSync(archived, old, old);
    const fresh = store.put(p.id, "cards", makeCard(p.id, { kind: "own", front: "f2", back: "b" }));
    store.archive(p.id, "cards", fresh.id);

    const cache = new ReplyCache(store);
    cache.set(cache.key("a"), "x".repeat(1000));

    const scores = [0.1, 0.9, 0.2, 0.3, 0.4, 0.5];
    store.put(p.id, "quizzes", {
      id: "q1", projectId: p.id, createdAt: new Date().toISOString(), title: "q", files: [], fileHashes: {}, questions: [],
      attempts: scores.map((score, i) => ({ at: new Date(Date.now() + i).toISOString(), answers: [], grades: [], score })),
    });
    writeFileSync(join(home, "leftover.json.123.tmp"), "x");
    utimesSync(join(home, "leftover.json.123.tmp"), old, old);

    const r = prune(store);
    expect(existsSync(archived)).toBe(false);
    expect(existsSync(join(home, "projects", p.id, "archive", "cards", `${fresh.id}.json`))).toBe(true);
    expect(readdirSync(join(home, "cache"))).toHaveLength(0);
    expect(store.get(p.id, "quizzes", "q1")!.attempts.map((a) => a.score)).toEqual([0.9, 0.4, 0.5]);
    expect(existsSync(join(home, "leftover.json.123.tmp"))).toBe(false);
    expect(r.removed).toBeGreaterThanOrEqual(5);
    expect(usage(store).lastPrune?.removed).toBe(r.removed);
  });

  it("forgetting a project archives its data; reopening brings it back", () => {
    const home = mkdtempSync(join(tmpdir(), "cognitune-home-"));
    const store = new Store(home);
    const root = mkdtempSync(join(tmpdir(), "cognitune-x-"));
    const p = store.openProject(root);
    store.put(p.id, "cards", makeCard(p.id, { kind: "own", front: "f", back: "b" }));
    store.forgetProject(p.id);
    expect(existsSync(join(home, "projects", p.id))).toBe(false);
    expect(existsSync(join(home, "archive", "projects", p.id))).toBe(true);
    store.openProject(root);
    expect(store.list(p.id, "cards")).toHaveLength(1);
  });

  it("jobs persist with a cap and a restart marks running ones failed", async () => {
    const home = mkdtempSync(join(tmpdir(), "cognitune-home-"));
    const store = new Store(home);
    const jobs = new Jobs(store);
    for (let i = 0; i < 105; i++) jobs.start("lens", "p", async () => ({ id: String(i) }));
    jobs.start("lens", "p", () => new Promise(() => {}));
    await new Promise((r) => setTimeout(r, 20));
    const again = new Jobs(store);
    const all = again.history(500);
    expect(all.length).toBeLessThanOrEqual(100);
    expect(all[0].status).toBe("failed");
    expect(all[0].error).toMatch(/stopped/);
  });

  it("reports usage by part", async () => {
    const home = mkdtempSync(join(tmpdir(), "cognitune-home-"));
    const store = new Store(home);
    const p = store.openProject(mkdtempSync(join(tmpdir(), "cognitune-x-")));
    store.put(p.id, "notes", { id: "n1", projectId: p.id, createdAt: new Date().toISOString(), text: "hello" });
    const api = createApi(store);
    const u = await (await api.request("/storage")).json();
    expect(u.parts.find((x: { name: string }) => x.name === "notes").files).toBe(1);
    expect(u.totalBytes).toBeGreaterThan(0);
  });
});
