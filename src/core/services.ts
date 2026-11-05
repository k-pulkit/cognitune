import type { Agent } from "./agent/index.js";
import {
  makeCard, openMisconceptions, progress as progressOf, recordMisconception, resolveMisconception,
} from "./insights.js";
import * as P from "./prompts.js";
import { problems, type TaskName } from "./schemas.js";
import { THREAD_MESSAGE_CAP, ReplyCache } from "./storage.js";
import { newId, type Store } from "./store.js";
import type {
  Answer, Attempt, DiffSpec, FileProgress, Grade, Hole, HoleReview, Hunt, LearningPath, Lens, PlantedBug, Practice,
  Project, Quiz, StopActivity, Teachback, Thread, Trace, Verdict, Walk,
} from "./types.js";
import { hashText, langOf, Workspace } from "./workspace.js";

/**
 * The learning actions. Each one builds a prompt from real files, calls the agent, checks the
 * reply against its schema (one retry with the problems listed), and saves the result.
 */

const VERDICTS: Verdict[] = ["right", "partial", "wrong"];
const str = (v: unknown, max = 4000): string => (typeof v === "string" ? v.slice(0, max) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : undefined;
};
const verdict = (v: unknown): Verdict => (VERDICTS.includes(v as Verdict) ? (v as Verdict) : "wrong");
const strs = (v: unknown, max = 600, n = 12): string[] => arr(v).map((x) => str(x, max)).filter(Boolean).slice(0, n);
const now = () => new Date().toISOString();
const ACTIVITIES: StopActivity[] = ["lens", "walk", "quiz", "teachback"];

export class Learn {
  private readonly cache: ReplyCache;

  constructor(
    private readonly store: Store,
    private readonly agent: Agent,
  ) {
    this.cache = new ReplyCache(store);
  }

  private settings() {
    return this.store.settings();
  }

  /**
   * One model call, parsed and checked. `cache` reuses an earlier reply to the exact same prompt
   * (a lens on an unchanged file is free the second time).
   */
  private async ask<T>(ws: Workspace, tasks: TaskName[], system: string, prompt: string, opts: { cache?: boolean } = {}): Promise<T> {
    const key = opts.cache ? this.cache.key(this.agent.name, system, prompt) : "";
    const hit = key ? this.cache.get(key) : undefined;
    if (hit) {
      try {
        const v = P.parseJson<T>(hit);
        if (tasks.every((t) => !problems(t, v))) return v;
      } catch {
        /* bad entry: ask again */
      }
    }
    let text = await this.agent.complete({ system, prompt, cwd: ws.project.root });
    let value: T | undefined;
    let issue: string | null = null;
    try {
      value = P.parseJson<T>(text);
      issue = tasks.map((t) => problems(t, value)).find(Boolean) ?? null;
    } catch (e) {
      issue = e instanceof Error ? e.message.slice(0, 200) : "no JSON";
    }
    if (issue) {
      const retry = `${prompt}\n\nYOUR LAST REPLY COULD NOT BE USED: ${issue}\nReply again with the full JSON object in the required shape.`;
      text = await this.agent.complete({ system, prompt: retry, cwd: ws.project.root });
      value = P.parseJson<T>(text);
      const again = tasks.map((t) => problems(t, value)).find(Boolean);
      if (again) throw new Error(`the model reply did not have the expected shape: ${again}`);
    }
    if (key) this.cache.set(key, text);
    return value as T;
  }

  private bundle(ws: Workspace, files: string[]): string {
    return ws.bundle(files, this.settings()["context.maxBytes"]);
  }

  /** The learner's margin notes on these files, when the setting is on. */
  private notes(ws: Workspace, files: string[]): string | undefined {
    if (!this.settings()["notes.inPrompts"]) return undefined;
    const want = new Set(files);
    const lines = this.store
      .list(ws.project.id, "notes")
      .filter((n) => n.file && want.has(n.file))
      .map((n) => `${ws.rel(n.file!)}${n.line ? `:${n.line}` : ""}: ${n.text}`);
    return lines.length ? lines.join("\n").slice(0, 8000) : undefined;
  }

  private diffText(ws: Workspace, diff: DiffSpec | undefined, files: string[]): string | undefined {
    if (!diff) return undefined;
    const want = new Set(files);
    const patches = ws.diff(diff).filter((f) => want.size === 0 || want.has(f.path)).map((f) => f.patch);
    return patches.join("\n").slice(0, this.settings()["context.maxBytes"] / 2);
  }

  private hashes(ws: Workspace, files: string[]): Record<string, string> {
    return Object.fromEntries(files.map((f) => [f, ws.hash(f) ?? ""]));
  }

  /** Rough size of a prompt for these files, for the "~N tokens" line before a job. */
  estimate(project: Project, files: string[]): { bytes: number; tokens: number; cut: boolean } {
    const ws = new Workspace(project);
    const max = this.settings()["context.maxBytes"];
    const text = ws.bundle(files.map((f) => ws.guard(f)), max);
    return { bytes: text.length, tokens: Math.round(text.length / 3.5), cut: text.includes("(Not included, too large") };
  }

  // ---- lens ------------------------------------------------------------

  async lens(
    project: Project,
    req: { files: string[]; kind: string; question?: string; diff?: DiffSpec; sketch?: string; traceInput?: string; refreshOf?: string },
  ): Promise<Lens> {
    const ws = new Workspace(project);
    const old = req.refreshOf ? this.store.get(project.id, "lenses", req.refreshOf) : undefined;
    if (req.refreshOf && !old) throw new Error("lens not found");
    const r = old
      ? { files: old.files, kind: old.kind, question: old.question, diff: old.diff, sketch: undefined, traceInput: old.trace?.input }
      : req;
    const files = r.files.map((f) => ws.guard(f));
    if (!files.length) throw new Error("pick at least one file");
    const kind = P.LENS_KINDS.find((k) => k.id === r.kind);
    const question = r.question?.trim() || kind?.question || P.LENS_KINDS[0].question;
    const sketch = r.sketch?.trim() || undefined;
    const trace = kind?.id === "trace";
    const max = this.settings()["context.maxBytes"];
    const extras: P.LensExtras = {
      diff: this.diffText(ws, r.diff, files),
      sketch,
      traceInput: trace ? (r.traceInput ?? "").trim() : undefined,
      history: kind?.id === "history" ? ws.history(files[0], max / 2) : undefined,
      previous: old ? `${old.summary}\n${old.deepDives.map((d) => `- ${d.title}`).join("\n")}` : undefined,
      notes: this.notes(ws, files),
    };
    const tasks: TaskName[] = ["lens", ...(sketch ? ["lensSketch" as const] : []), ...(trace ? ["lensTrace" as const] : [])];
    const raw = await this.ask<Record<string, unknown>>(
      ws, tasks, P.lensSystem({ sketch: !!sketch, trace }), P.lensPrompt(question, this.bundle(ws, files), extras),
      { cache: !old && !sketch },
    );
    const lens: Lens = {
      id: newId(),
      projectId: project.id,
      createdAt: now(),
      kind: kind?.id ?? "custom",
      question,
      files,
      diff: r.diff,
      title: str(raw.title, 120) || question,
      summary: str(raw.summary),
      concepts: arr(raw.concepts).map((c) => {
        const o = c as Record<string, unknown>;
        return { term: str(o.term, 120), explain: str(o.explain) };
      }).filter((c) => c.term),
      intuition: str(raw.intuition, 12_000),
      deepDives: arr(raw.deepDives).map((d) => {
        const o = d as Record<string, unknown>;
        return { title: str(o.title, 200), file: ws.absFromRel(str(o.file, 500)), line: num(o.line), body: str(o.body, 8000) };
      }).filter((d) => d.title || d.body),
      fileHashes: this.hashes(ws, files),
      sketch,
      differences: sketch ? strs(raw.differences) : undefined,
      trace: trace ? cleanTrace(raw.trace, ws) : undefined,
    };
    this.store.put(project.id, "lenses", lens);
    // A refresh replaces the old lens; keep one copy, not a pile of versions.
    if (old) this.store.archive(project.id, "lenses", old.id);
    return lens;
  }

  // ---- quiz ------------------------------------------------------------

  async quiz(project: Project, req: { files: string[]; diff?: DiffSpec; lensId?: string; count?: number; weak?: boolean }): Promise<Quiz> {
    const ws = new Workspace(project);
    const lens = req.lensId ? this.store.get(project.id, "lenses", req.lensId) : undefined;
    const weak = req.weak ? openMisconceptions(this.store, project.id).slice(0, 6) : [];
    if (req.weak && !weak.length) throw new Error("no open weak spots: nothing to aim at yet");
    const weakFiles = weak.map((m) => m.file).filter((f): f is string => !!f);
    const files = [...new Set((req.files.length ? req.files : lens?.files ?? weakFiles).map((f) => ws.guard(f)))];
    if (!files.length && !weak.length) throw new Error("pick at least one file");
    const n = Math.min(Math.max(req.count ?? (weak.length || this.settings()["quiz.questions"]), 1), 10);
    const raw = await this.ask<Record<string, unknown>>(
      ws, ["quiz"], P.quizSystem(n),
      P.quizPrompt(this.bundle(ws, files), this.diffText(ws, req.diff ?? lens?.diff, files), lens?.summary, weak.map((m) => ({ id: m.id, text: m.text }))),
    );
    const weakIds = new Set(weak.map((m) => m.id));
    const questions = arr(raw.questions).slice(0, n).map((q, i) => {
      const o = q as Record<string, unknown>;
      const target = str(o.targets, 40);
      return {
        id: `q${i + 1}`, prompt: str(o.prompt, 2000), file: ws.absFromRel(str(o.file, 500)), line: num(o.line), focus: str(o.focus, 120),
        misconceptionId: weakIds.has(target) ? target : undefined,
      };
    }).filter((q) => q.prompt);
    if (!questions.length) throw new Error("the model wrote no questions");
    const quiz: Quiz = {
      id: newId(),
      projectId: project.id,
      createdAt: now(),
      title: str(raw.title, 120) || (weak.length ? "Your weak spots" : "Quiz"),
      files,
      fileHashes: this.hashes(ws, files),
      diff: req.diff ?? lens?.diff,
      lensId: lens?.id,
      questions,
      attempts: [],
    };
    return this.store.put(project.id, "quizzes", quiz);
  }

  async grade(project: Project, quizId: string, answers: Answer[]): Promise<Quiz> {
    const ws = new Workspace(project);
    const quiz = this.store.get(project.id, "quizzes", quizId);
    if (!quiz) throw new Error("quiz not found");
    const byId = new Map(answers.map((a) => [a.qid, a]));
    const items = quiz.questions.map((q) => ({ qid: q.id, question: q.prompt, answer: str(byId.get(q.id)?.answer, 4000) }));
    const raw = await this.ask<{ grades?: unknown[] }>(ws, ["grade"], P.gradeSystem(), P.gradePrompt(items, this.bundle(ws, quiz.files)));
    const got = new Map(arr(raw.grades).map((g) => {
      const o = g as Record<string, unknown>;
      return [str(o.qid, 20), o] as const;
    }));
    const grades: Grade[] = quiz.questions.map((q) => {
      const o = got.get(q.id) ?? {};
      // An empty answer is wrong whatever the model says.
      const answered = !!byId.get(q.id)?.answer?.trim();
      const v = answered ? verdict(o.verdict) : "wrong";
      // No answer shows no belief, so it cannot show a wrong one.
      const mis = v !== "right" && answered ? str(o.misconception, 500) : "";
      return { qid: q.id, verdict: v, feedback: str(o.feedback), modelAnswer: str(o.modelAnswer), ...(mis ? { misconception: mis } : {}) };
    });
    const attempt: Attempt = {
      at: now(),
      answers: quiz.questions.map((q) => ({ qid: q.id, answer: byId.get(q.id)?.answer ?? "", sure: !!byId.get(q.id)?.sure })),
      grades,
      score: scoreOf(grades),
    };
    quiz.attempts.push(attempt);
    this.store.put(project.id, "quizzes", quiz);
    this.afterGrade(project, quiz, grades);
    return quiz;
  }

  /** Misses become misconceptions and review cards; a right answer resolves what it targeted. */
  private afterGrade(project: Project, quiz: Quiz, grades: Grade[]): void {
    const pid = project.id;
    const cards = this.settings()["cards.fromMisses"] ? this.store.list(pid, "cards") : null;
    for (const g of grades) {
      const q = quiz.questions.find((x) => x.id === g.qid);
      if (!q) continue;
      const sourceId = `${quiz.id}:${q.id}`;
      if (g.verdict === "right") {
        resolveMisconception(this.store, pid, (m) => m.id === q.misconceptionId || m.sourceId === sourceId);
        continue;
      }
      if (g.misconception) recordMisconception(this.store, pid, { text: g.misconception, file: q.file, line: q.line, from: "quiz", sourceId });
      if (cards && g.modelAnswer && !cards.some((c) => c.source?.quizId === quiz.id && c.source?.qid === q.id)) {
        this.store.put(pid, "cards", makeCard(pid, { kind: "miss", front: q.prompt, back: g.modelAnswer, file: q.file, line: q.line, source: { quizId: quiz.id, qid: q.id } }));
      }
    }
  }

  // ---- practice --------------------------------------------------------

  async practice(project: Project, req: { file: string; level: number }): Promise<Practice> {
    const ws = new Workspace(project);
    const file = ws.guard(req.file);
    const level = (Math.min(Math.max(Math.round(req.level || 2), 1), 4)) as Practice["level"];
    const original = ws.read(file).text;
    const raw = await this.ask<{ holes?: unknown[] }>(ws, ["practice"], P.practiceSystem(level), `CODE:\n${this.bundle(ws, [file])}`);
    const holes = cleanHoles(arr(raw.holes), original.split("\n").length);
    if (!holes.length) throw new Error("the model found no lines to turn into holes");
    const holed = applyHoles(original, holes, langOf(file));
    const p: Practice = {
      id: newId(), projectId: project.id, createdAt: now(),
      file, level, original, holed, holes, attempt: holed,
    };
    return this.store.put(project.id, "practice", p);
  }

  saveAttempt(project: Project, id: string, text: string): Practice {
    const p = this.store.get(project.id, "practice", id);
    if (!p) throw new Error("practice not found");
    p.attempt = text.slice(0, 1_000_000);
    return this.store.put(project.id, "practice", p);
  }

  async review(project: Project, id: string): Promise<Practice> {
    const ws = new Workspace(project);
    const p = this.store.get(project.id, "practice", id);
    if (!p) throw new Error("practice not found");
    const raw = await this.ask<{ summary?: unknown; holes?: unknown[] }>(ws, ["review"], P.reviewSystem(), P.reviewPrompt(p.original, p.attempt, p.holes));
    const got = new Map(arr(raw.holes).map((h) => [num((h as Record<string, unknown>).id), h as Record<string, unknown>]));
    const holes: HoleReview[] = p.holes.map((h) => {
      const o = got.get(h.id) ?? {};
      return { id: h.id, verdict: verdict(o.verdict), feedback: str(o.feedback) };
    });
    p.review = { at: now(), holes, summary: str(raw.summary) };
    return this.store.put(project.id, "practice", p);
  }

  // ---- teach-back ------------------------------------------------------

  async teachback(project: Project, req: { files: string[]; text: string }): Promise<Teachback> {
    const ws = new Workspace(project);
    const files = req.files.map((f) => ws.guard(f));
    if (!files.length) throw new Error("pick at least one file");
    const text = (req.text ?? "").trim().slice(0, 20_000);
    if (text.length < 20) throw new Error("write a few sentences first");
    const raw = await this.ask<Record<string, unknown>>(ws, ["teachback"], P.teachbackSystem(), P.teachbackPrompt(text, this.bundle(ws, files)));
    const t: Teachback = {
      id: newId(), projectId: project.id, createdAt: now(), files, fileHashes: this.hashes(ws, files), text,
      grade: {
        score: Math.min(5, Math.max(1, num(raw.score) ?? 1)),
        summary: str(raw.summary, 800),
        right: strs(raw.right), missing: strs(raw.missing), wrong: strs(raw.wrong),
      },
    };
    this.store.put(project.id, "teachbacks", t);
    t.grade!.wrong.forEach((w, i) => recordMisconception(this.store, project.id, { text: w, file: files[0], from: "teachback", sourceId: `${t.id}:${i}` }));
    return t;
  }

  // ---- tutor -------------------------------------------------------------

  async startThread(project: Project, req: { files: string[]; text: string }): Promise<Thread> {
    const ws = new Workspace(project);
    const files = req.files.map((f) => ws.guard(f));
    if (!files.length) throw new Error("pick at least one file");
    const text = (req.text ?? "").trim();
    if (!text) throw new Error("ask a question first");
    const t: Thread = { id: newId(), projectId: project.id, createdAt: now(), title: text.split("\n")[0].slice(0, 80), files, messages: [] };
    return this.tutorTurn(project, t, text, false);
  }

  async tutorReply(project: Project, id: string, text: string, tell: boolean): Promise<Thread> {
    const t = this.store.get(project.id, "threads", id);
    if (!t) throw new Error("thread not found");
    return this.tutorTurn(project, t, (text ?? "").trim() || (tell ? "Just tell me." : ""), tell);
  }

  private async tutorTurn(project: Project, t: Thread, text: string, tell: boolean): Promise<Thread> {
    if (!text) throw new Error("write something first");
    const ws = new Workspace(project);
    t.messages.push({ role: "user", text: text.slice(0, 8000), at: now() });
    // The hint ladder climbs one step per tutor turn, and starts again after a "tell me".
    const since = t.messages.slice(t.messages.map((m) => m.hintLevel === 4).lastIndexOf(true) + 1);
    const level = Math.min(3, since.filter((m) => m.role === "tutor").length + 1);
    const raw = await this.ask<{ reply?: unknown }>(ws, ["tutor"], P.tutorSystem(level, tell), P.tutorPrompt(t.messages, this.bundle(ws, t.files), this.notes(ws, t.files)));
    t.messages.push({ role: "tutor", text: str(raw.reply, 8000), at: now(), hintLevel: tell ? 4 : level });
    // Bounded: keep the opening question and the newest turns.
    if (t.messages.length > THREAD_MESSAGE_CAP) t.messages = [t.messages[0], ...t.messages.slice(-(THREAD_MESSAGE_CAP - 1))];
    return this.store.put(project.id, "threads", t);
  }

  // ---- walkthrough ---------------------------------------------------------

  async walk(project: Project, req: { file: string }): Promise<Walk> {
    const ws = new Workspace(project);
    const file = ws.guard(req.file);
    const content = ws.read(file);
    const lines = content.text.split("\n").length;
    const raw = await this.ask<{ blocks?: unknown[] }>(ws, ["walk"], P.walkSystem(), `CODE:\n${this.bundle(ws, [file])}`, { cache: true });
    const blocks = arr(raw.blocks).map((b) => {
      const o = b as Record<string, unknown>;
      const startLine = num(o.startLine) ?? 0;
      return { startLine, endLine: Math.min(lines, num(o.endLine) ?? startLine), title: str(o.title, 120), why: str(o.why, 800), question: str(o.question, 800) };
    }).filter((b) => b.startLine >= 1 && b.endLine >= b.startLine && b.question).slice(0, 12);
    if (blocks.length < 2) throw new Error("the model could not split this file into blocks");
    return this.store.put(project.id, "walks", { id: newId(), projectId: project.id, createdAt: now(), file, fileHash: content.hash, blocks });
  }

  async walkcheck(project: Project, id: string, index: number, answer: string): Promise<Walk> {
    const ws = new Workspace(project);
    const w = this.store.get(project.id, "walks", id);
    if (!w) throw new Error("walkthrough not found");
    const b = w.blocks[index];
    if (!b) throw new Error("block not found");
    const text = ws.read(w.file).text.split("\n");
    const block = text.slice(b.startLine - 1, b.endLine).map((l, i) => `${String(b.startLine + i).padStart(4)}| ${l}`).join("\n");
    const raw = await this.ask<Record<string, unknown>>(ws, ["walkcheck"], P.walkcheckSystem(), P.walkcheckPrompt(b.question, answer, block, this.bundle(ws, [w.file])));
    b.answer = answer.slice(0, 4000);
    b.verdict = answer.trim() ? verdict(raw.verdict) : "wrong";
    b.feedback = str(raw.feedback, 1500);
    this.store.put(project.id, "walks", w);
    const mis = str(raw.misconception, 500);
    if (b.verdict !== "right" && mis && answer.trim()) recordMisconception(this.store, project.id, { text: mis, file: w.file, line: b.startLine, from: "walk", sourceId: `${w.id}:${index}` });
    if (b.verdict === "right") resolveMisconception(this.store, project.id, (m) => m.sourceId === `${w.id}:${index}`);
    return w;
  }

  // ---- bug hunt --------------------------------------------------------------

  async hunt(project: Project, req: { file: string; level: number }): Promise<Hunt> {
    const ws = new Workspace(project);
    const file = ws.guard(req.file);
    const content = ws.read(file);
    const level = Math.min(3, Math.max(1, Math.round(req.level || 1))) as Hunt["level"];
    const raw = await this.ask<{ bugs?: unknown[] }>(ws, ["hunt"], P.huntSystem(level), `CODE:\n${this.bundle(ws, [file])}`);
    const { text, planted } = plantBugs(content.text, arr(raw.bugs));
    if (!planted.length) throw new Error("the model's bugs did not match the file; try again");
    return this.store.put(project.id, "hunts", {
      id: newId(), projectId: project.id, createdAt: now(), file, fileHash: content.hash, level, text, planted, marks: [],
    });
  }

  saveMarks(project: Project, id: string, marks: { line: number; why: string }[]): Hunt {
    const h = this.store.get(project.id, "hunts", id);
    if (!h) throw new Error("bug hunt not found");
    if (h.grade) throw new Error("already graded");
    h.marks = marks
      .map((m) => ({ line: num(m.line) ?? 0, why: str(m.why, 1000) }))
      .filter((m) => m.line >= 1)
      .slice(0, 20);
    return this.store.put(project.id, "hunts", h);
  }

  async huntgrade(project: Project, id: string): Promise<Hunt> {
    const ws = new Workspace(project);
    const h = this.store.get(project.id, "hunts", id);
    if (!h) throw new Error("bug hunt not found");
    const { found, falseAlarms, missed } = matchMarks(h.planted, h.marks);
    let fb = new Map<number, string>();
    let fa = new Map<number, string>();
    if (found.length || falseAlarms.length) {
      const numbered = h.text.split("\n").map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join("\n");
      const raw = await this.ask<{ found?: unknown[]; falseAlarms?: unknown[] }>(
        ws, ["huntgrade"], P.huntgradeSystem(),
        P.huntgradePrompt(h.planted, found.map((f) => ({ line: f.mark.line, why: f.mark.why, bugLine: f.bug.line })), falseAlarms, numbered),
      );
      fb = new Map(arr(raw.found).map((x) => [num((x as Record<string, unknown>).line) ?? 0, str((x as Record<string, unknown>).feedback, 1000)]));
      fa = new Map(arr(raw.falseAlarms).map((x) => [num((x as Record<string, unknown>).line) ?? 0, str((x as Record<string, unknown>).feedback, 1000)]));
    }
    const score = Math.max(0, (found.length - 0.5 * falseAlarms.length) / h.planted.length);
    h.grade = {
      at: now(),
      found: found.map((f) => ({ line: f.bug.line, what: f.bug.what, feedback: fb.get(f.bug.line) ?? fb.get(f.mark.line) ?? "" })),
      missed: missed.map((b) => ({ line: b.line, what: b.what })),
      falseAlarms: falseAlarms.map((m) => ({ line: m.line, feedback: fa.get(m.line) ?? "" })),
      score: Math.round(score * 100) / 100,
    };
    return this.store.put(project.id, "hunts", h);
  }

  // ---- learning path -----------------------------------------------------------

  async path(project: Project, req: { goal?: string; hubs: string[] }): Promise<LearningPath> {
    const ws = new Workspace(project);
    const all = ws.files();
    const rels = all.map((f) => ws.rel(f)).slice(0, 1500);
    const docs = all
      .filter((f) => /(^|\/)(readme|architecture|contributing|design)[^/]*\.md$/i.test(ws.rel(f)))
      .slice(0, 3);
    const docText = docs.length ? ws.bundle(docs, 24_000) : "";
    const raw = await this.ask<Record<string, unknown>>(
      ws, ["path"], P.pathSystem(), P.pathPrompt(rels, req.hubs.slice(0, 20).map((f) => ws.rel(f)), docText, req.goal?.trim()),
      { cache: true },
    );
    const stops = arr(raw.stops).map((s) => {
      const o = s as Record<string, unknown>;
      const files = arr(o.files).map((f) => ws.absFromRel(str(f, 500))).filter((f): f is string => !!f).slice(0, 4);
      const activity = ACTIVITIES.includes(o.activity as StopActivity) ? (o.activity as StopActivity) : "lens";
      return { title: str(o.title, 120), files, why: str(o.why, 800), activity };
    }).filter((s) => s.files.length && s.title).slice(0, 14);
    if (stops.length < 2) throw new Error("the model's path named no files that exist here");
    return this.store.put(project.id, "paths", { id: newId(), projectId: project.id, createdAt: now(), title: str(raw.title, 120) || "Onboarding path", stops });
  }

  // ---- progress --------------------------------------------------------

  progress(project: Project): FileProgress[] {
    return progressOf(this.store, project);
  }
}

function cleanTrace(v: unknown, ws: Workspace): Trace | undefined {
  const o = (v ?? {}) as Record<string, unknown>;
  const steps = arr(o.steps).slice(0, 60).map((s) => {
    const x = s as Record<string, unknown>;
    const state = Object.fromEntries(
      Object.entries((x.state ?? {}) as Record<string, unknown>).slice(0, 16).map(([k, val]) => [k.slice(0, 60), (typeof val === "string" ? val : JSON.stringify(val) ?? "").slice(0, 200)]),
    );
    return { file: ws.absFromRel(str(x.file, 500)), line: num(x.line), state, note: str(x.note, 600) };
  });
  return steps.length ? { input: str(o.input, 600), steps } : undefined;
}

/** Apply one-line bugs. A bug whose "original" does not match its line is looked up by text. */
export function plantBugs(original: string, raw: unknown[]): { text: string; planted: PlantedBug[] } {
  const lines = original.split("\n");
  const planted: PlantedBug[] = [];
  for (const b of raw) {
    const o = b as Record<string, unknown>;
    const want = str(o.original, 2000).trim();
    const buggy = str(o.buggy, 2000);
    if (!want || !buggy.trim() || buggy.trim() === want) continue;
    let at = (num(o.line) ?? 0) - 1;
    if (lines[at]?.trim() !== want) {
      const hits = lines.map((l, i) => (l.trim() === want ? i : -1)).filter((i) => i >= 0);
      if (hits.length !== 1) continue;
      at = hits[0];
    }
    if (planted.some((p) => p.line === at + 1)) continue;
    const indent = /^\s*/.exec(lines[at])?.[0] ?? "";
    planted.push({ line: at + 1, original: lines[at], buggy: indent + buggy.trimStart(), what: str(o.what, 800) });
    lines[at] = indent + buggy.trimStart();
  }
  return { text: lines.join("\n"), planted: planted.sort((a, b) => a.line - b.line) };
}

/** A mark finds a bug on its line or the next one over; each bug is found once. */
export function matchMarks(planted: PlantedBug[], marks: { line: number; why: string }[]) {
  const left = [...planted];
  const found: { bug: PlantedBug; mark: { line: number; why: string } }[] = [];
  const falseAlarms: { line: number; why: string }[] = [];
  for (const m of [...marks].sort((a, b) => a.line - b.line)) {
    const i = left.map((b) => Math.abs(b.line - m.line)).reduce((best, d, j, all) => (d <= 1 && (best < 0 || d < all[best]) ? j : best), -1);
    if (i >= 0) found.push({ bug: left.splice(i, 1)[0], mark: m });
    else falseAlarms.push(m);
  }
  return { found, falseAlarms, missed: left };
}

export function scoreOf(grades: Grade[]): number {
  if (!grades.length) return 0;
  const pts = grades.reduce((s, g) => s + (g.verdict === "right" ? 1 : g.verdict === "partial" ? 0.5 : 0), 0);
  return Math.round((pts / grades.length) * 100) / 100;
}

/** Keep holes that are inside the file and do not overlap; number them in file order. */
export function cleanHoles(raw: unknown[], lineCount: number): Hole[] {
  const holes = raw
    .map((h) => h as Record<string, unknown>)
    .map((o) => ({
      startLine: num(o.startLine) ?? 0,
      endLine: num(o.endLine) ?? num(o.startLine) ?? 0,
      intent: str(o.intent, 500),
      hints: arr(o.hints).map((x) => str(x, 500)).filter(Boolean).slice(0, 3),
    }))
    .filter((h) => h.startLine >= 1 && h.endLine >= h.startLine && h.endLine <= lineCount)
    .sort((a, b) => a.startLine - b.startLine);
  const out: Hole[] = [];
  for (const h of holes) {
    const prev = out[out.length - 1];
    if (prev && h.startLine <= prev.endLine) continue;
    out.push({ id: out.length + 1, ...h });
  }
  return out;
}

const COMMENT: Record<string, string> = {
  python: "#", bash: "#", yaml: "#", toml: "#", ruby: "#", r: "#", elixir: "#", make: "#", docker: "#", hcl: "#", ini: ";",
  sql: "--", lua: "--", html: "<!--", xml: "<!--", markdown: "<!--", css: "/*", scss: "//", jinja: "{#",
};
const CLOSE: Record<string, string> = { "<!--": " -->", "/*": " */", "{#": " #}" };

/** Replace each hole's lines with one marker line, kept at the hole's indent. */
export function applyHoles(original: string, holes: Hole[], lang: string): string {
  const lines = original.split("\n");
  const open = COMMENT[lang] ?? "//";
  const close = CLOSE[open] ?? "";
  for (const h of [...holes].sort((a, b) => b.startLine - a.startLine)) {
    const first = lines[h.startLine - 1] ?? "";
    const indent = /^\s*/.exec(first)?.[0] ?? "";
    lines.splice(h.startLine - 1, h.endLine - h.startLine + 1, `${indent}${open} HOLE ${h.id}: ${h.intent}${close}`);
  }
  return lines.join("\n");
}
