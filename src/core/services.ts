import type { Agent } from "./agent/index.js";
import * as P from "./prompts.js";
import { newId, type Store } from "./store.js";
import type {
  Answer, Attempt, DiffSpec, FileProgress, Grade, Hole, HoleReview, Lens, Practice, Project, Quiz, Verdict,
} from "./types.js";
import { langOf, Workspace } from "./workspace.js";

/**
 * The learning actions. Each one builds a prompt from real files, calls the agent once,
 * checks the reply's shape, and saves the result in the store.
 */

const VERDICTS: Verdict[] = ["right", "partial", "wrong"];
const str = (v: unknown, max = 4000): string => (typeof v === "string" ? v.slice(0, max) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined);
const verdict = (v: unknown): Verdict => (VERDICTS.includes(v as Verdict) ? (v as Verdict) : "wrong");

export class Learn {
  constructor(
    private readonly store: Store,
    private readonly agent: Agent,
  ) {}

  private settings() {
    return this.store.settings();
  }

  private async ask<T>(ws: Workspace, system: string, prompt: string): Promise<T> {
    const text = await this.agent.complete({ system, prompt, cwd: ws.project.root });
    return P.parseJson<T>(text);
  }

  private diffText(ws: Workspace, diff: DiffSpec | undefined, files: string[]): string | undefined {
    if (!diff) return undefined;
    const want = new Set(files);
    const patches = ws.diff(diff).filter((f) => want.size === 0 || want.has(f.path)).map((f) => f.patch);
    return patches.join("\n").slice(0, this.settings()["context.maxBytes"] / 2);
  }

  // ---- lens ------------------------------------------------------------

  async lens(project: Project, req: { files: string[]; kind: string; question?: string; diff?: DiffSpec }): Promise<Lens> {
    const ws = new Workspace(project);
    const files = req.files.map((f) => ws.guard(f));
    if (!files.length) throw new Error("pick at least one file");
    const kind = P.LENS_KINDS.find((k) => k.id === req.kind);
    const question = req.question?.trim() || kind?.question || P.LENS_KINDS[0].question;
    const bundle = ws.bundle(files, this.settings()["context.maxBytes"]);
    const raw = await this.ask<Record<string, unknown>>(ws, P.lensSystem(), P.lensPrompt(question, bundle, this.diffText(ws, req.diff, files)));
    const lens: Lens = {
      id: newId(),
      projectId: project.id,
      createdAt: new Date().toISOString(),
      kind: kind?.id ?? "custom",
      question,
      files,
      diff: req.diff,
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
    };
    return this.store.put(project.id, "lenses", lens);
  }

  // ---- quiz ------------------------------------------------------------

  async quiz(project: Project, req: { files: string[]; diff?: DiffSpec; lensId?: string; count?: number }): Promise<Quiz> {
    const ws = new Workspace(project);
    const lens = req.lensId ? this.store.get(project.id, "lenses", req.lensId) : undefined;
    const files = (req.files.length ? req.files : lens?.files ?? []).map((f) => ws.guard(f));
    if (!files.length) throw new Error("pick at least one file");
    const n = Math.min(Math.max(req.count ?? this.settings()["quiz.questions"], 1), 10);
    const bundle = ws.bundle(files, this.settings()["context.maxBytes"]);
    const raw = await this.ask<Record<string, unknown>>(
      ws, P.quizSystem(n), P.quizPrompt(bundle, this.diffText(ws, req.diff ?? lens?.diff, files), lens?.summary),
    );
    const questions = arr(raw.questions).slice(0, n).map((q, i) => {
      const o = q as Record<string, unknown>;
      return { id: `q${i + 1}`, prompt: str(o.prompt, 2000), file: ws.absFromRel(str(o.file, 500)), line: num(o.line), focus: str(o.focus, 120) };
    }).filter((q) => q.prompt);
    if (!questions.length) throw new Error("the model wrote no questions");
    const quiz: Quiz = {
      id: newId(),
      projectId: project.id,
      createdAt: new Date().toISOString(),
      title: str(raw.title, 120) || "Quiz",
      files,
      fileHashes: Object.fromEntries(files.map((f) => [f, ws.hash(f) ?? ""])),
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
    const raw = await this.ask<{ grades?: unknown[] }>(
      ws, P.gradeSystem(), P.gradePrompt(items, ws.bundle(quiz.files, this.settings()["context.maxBytes"])),
    );
    const got = new Map(arr(raw.grades).map((g) => {
      const o = g as Record<string, unknown>;
      return [str(o.qid, 20), o] as const;
    }));
    const grades: Grade[] = quiz.questions.map((q) => {
      const o = got.get(q.id) ?? {};
      // An empty answer is wrong whatever the model says.
      const v = byId.get(q.id)?.answer?.trim() ? verdict(o.verdict) : "wrong";
      return { qid: q.id, verdict: v, feedback: str(o.feedback), modelAnswer: str(o.modelAnswer) };
    });
    const attempt: Attempt = {
      at: new Date().toISOString(),
      answers: quiz.questions.map((q) => ({ qid: q.id, answer: byId.get(q.id)?.answer ?? "", sure: !!byId.get(q.id)?.sure })),
      grades,
      score: scoreOf(grades),
    };
    quiz.attempts.push(attempt);
    return this.store.put(project.id, "quizzes", quiz);
  }

  // ---- practice --------------------------------------------------------

  async practice(project: Project, req: { file: string; level: number }): Promise<Practice> {
    const ws = new Workspace(project);
    const file = ws.guard(req.file);
    const level = (Math.min(Math.max(Math.round(req.level || 2), 1), 4)) as Practice["level"];
    const original = ws.read(file).text;
    const raw = await this.ask<{ holes?: unknown[] }>(ws, P.practiceSystem(level), `CODE:\n${ws.bundle([file], this.settings()["context.maxBytes"])}`);
    const holes = cleanHoles(arr(raw.holes), original.split("\n").length);
    if (!holes.length) throw new Error("the model found no lines to turn into holes");
    const holed = applyHoles(original, holes, langOf(file));
    const p: Practice = {
      id: newId(), projectId: project.id, createdAt: new Date().toISOString(),
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
    const raw = await this.ask<{ summary?: unknown; holes?: unknown[] }>(ws, P.reviewSystem(), P.reviewPrompt(p.original, p.attempt, p.holes));
    const got = new Map(arr(raw.holes).map((h) => [num((h as Record<string, unknown>).id), h as Record<string, unknown>]));
    const holes: HoleReview[] = p.holes.map((h) => {
      const o = got.get(h.id) ?? {};
      return { id: h.id, verdict: verdict(o.verdict), feedback: str(o.feedback) };
    });
    p.review = { at: new Date().toISOString(), holes, summary: str(raw.summary) };
    return this.store.put(project.id, "practice", p);
  }

  // ---- progress --------------------------------------------------------

  /**
   * Per file: understood = a quiz on it passed and the file has not changed since;
   * stale = it passed, then the file changed; seen = a lens or a quiz touched it.
   */
  progress(project: Project): FileProgress[] {
    const ws = new Workspace(project);
    const passMark = this.settings()["quiz.passMark"];
    const map = new Map<string, FileProgress>();
    const get = (path: string) => {
      let fp = map.get(path);
      if (!fp) map.set(path, (fp = { path, level: "new", lenses: 0, quizzes: 0, bestScore: null, practices: 0 }));
      return fp;
    };
    for (const l of this.store.list(project.id, "lenses")) for (const f of l.files) get(f).lenses++;
    for (const p of this.store.list(project.id, "practice")) get(p.file).practices++;
    const passed = new Map<string, boolean>(); // file -> passed with current hash?
    for (const q of this.store.list(project.id, "quizzes")) {
      const best = Math.max(-1, ...q.attempts.map((a) => a.score));
      for (const f of q.files) {
        const fp = get(f);
        fp.quizzes++;
        if (best >= 0) fp.bestScore = Math.max(fp.bestScore ?? 0, best);
        if (best >= passMark) {
          const fresh = ws.hash(f) === q.fileHashes[f];
          passed.set(f, (passed.get(f) ?? false) || fresh);
        }
      }
    }
    for (const fp of map.values()) {
      if (passed.has(fp.path)) fp.level = passed.get(fp.path) ? "understood" : "stale";
      else if (fp.lenses || fp.quizzes || fp.practices) fp.level = "seen";
    }
    return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
  }
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
