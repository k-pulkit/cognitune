import type { Agent } from "./agent/index.js";
import {
  makeCard, openMisconceptions, progress as progressOf, recordMisconception, resolveMisconception,
} from "./insights.js";
import * as P from "./prompts.js";
import { problems, type TaskName } from "./schemas.js";
import { THREAD_MESSAGE_CAP, ReplyCache } from "./storage.js";
import { newId, type Store } from "./store.js";
import type {
  Answer, Attempt, DeepDive, DiffSpec, FileProgress, LensEdit, Grade, Hole, HoleReview, Hunt, LearningPath, Lens, PlantedBug, Practice, PracticeFile,
  Project, Quiz, Shelf, StopActivity, Teachback, Thread, Trace, Verdict, Walk,
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
  private async ask<T>(
    ws: Workspace, tasks: TaskName[], system: string, prompt0: string, opts: { cache?: boolean; plan?: boolean; role?: "plan" | "write" } = {},
  ): Promise<T> {
    const key = opts.cache ? this.cache.key(this.agent.name, system, prompt0) : "";
    let prompt = prompt0;
    if (opts.plan && this.settings()["generate.plan"]) {
      // Plan first, then write: the planner (a stronger model when one is set) outlines, the writer follows.
      const o = await this.ask<{ outline: string }>(ws, ["plan"], P.planSystem(system), prompt0, { role: "plan" });
      prompt = `${prompt0}\n\nPLAN (from the planner; follow it):\n${o.outline}`;
    }
    const hit = key ? this.cache.get(key) : undefined;
    if (hit) {
      try {
        const v = P.parseJson<T>(hit);
        if (tasks.every((t) => !problems(t, v))) return v;
      } catch {
        /* bad entry: ask again */
      }
    }
    let text = await this.agent.complete({ system, prompt, cwd: ws.project.root, role: opts.role });
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
      text = await this.agent.complete({ system, prompt: retry, cwd: ws.project.root, role: opts.role });
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
    req: {
      files: string[]; kind: string; question?: string; diff?: DiffSpec; sketch?: string; traceInput?: string; refreshOf?: string;
      depth?: P.LensDepth;
      /** Extra instruction from the reader. On a refresh, undefined keeps the old lens's steer. */
      steer?: string;
      /** A refresh asked for by the reader (steer or depth), not because the code changed. */
      rework?: boolean;
    },
  ): Promise<Lens> {
    const ws = new Workspace(project);
    const old = req.refreshOf ? this.store.get(project.id, "lenses", req.refreshOf) : undefined;
    if (req.refreshOf && !old) throw new Error("lens not found");
    const r = old
      ? { files: old.files, kind: old.kind, question: old.question, diff: old.diff, sketch: undefined, traceInput: old.trace?.input, depth: req.depth ?? old.depth }
      : req;
    const steer = ((old && req.steer === undefined ? old.steer : req.steer) ?? "").trim().slice(0, 2000) || undefined;
    const depth: P.LensDepth = r.depth === "overview" || r.depth === "deep" ? r.depth : "standard";
    // Same depth, no sketch or trace: update block by block instead of writing the whole lens again.
    if (old && depth === (old.depth ?? "standard") && !old.sketch && !old.trace && old.deepDives.length) {
      return this.lensUpdate(project, old, { steer, rework: !!req.rework });
    }
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
      rework: !!req.rework,
      steer,
      notes: this.notes(ws, files),
    };
    const tasks: TaskName[] = ["lens", ...(sketch ? ["lensSketch" as const] : []), ...(trace ? ["lensTrace" as const] : [])];
    const cache = !old && !sketch;
    const raw = this.settings()["generate.plan"]
      ? await this.lensStaged(ws, { question, files, depth, extras, sketch: !!sketch, trace, cache })
      : await this.ask<Record<string, unknown>>(
          ws, tasks, P.lensSystem({ sketch: !!sketch, trace, depth }), P.lensPrompt(question, this.bundle(ws, files), extras), { cache },
        );
    const lens: Lens = {
      id: newId(),
      projectId: project.id,
      createdAt: now(),
      kind: kind?.id ?? "custom",
      question,
      files,
      diff: r.diff,
      // A rebuilt lens stays on its shelf.
      shelf: old?.shelf,
      shelfPinned: old?.shelfPinned,
      title: str(raw.title, 120) || question,
      // The verdict's table shows right under the summary; a summary that repeats it loses the table.
      summary: str(raw.verdict) ? str(raw.summary).split("\n").filter((ln) => !ln.trim().startsWith("|")).join("\n").trim() : str(raw.summary),
      concepts: arr(raw.concepts).map((c) => {
        const o = c as Record<string, unknown>;
        return {
          term: str(o.term, 120), explain: str(o.explain), example: str(o.example, 1000) || undefined,
          file: ws.absFromRel(str(o.file, 500)), line: num(o.line),
        };
      }).filter((c) => c.term),
      intuition: str(raw.intuition, 12_000),
      deepDives: arr(raw.deepDives).map((d) => cleanDive(d as Record<string, unknown>, ws)).filter((d) => d.title || d.body),
      tldr: str(raw.tldr, 400) || undefined,
      whyItMatters: str(raw.whyItMatters, 800) || undefined,
      gotchas: strs(raw.gotchas, 400, 8),
      verdict: str(raw.verdict, 4000) || undefined,
      alsoNoticed: strs(raw.alsoNoticed, 600, 6),
      nextSteps: arr(raw.nextSteps).map((n) => {
        const o = n as Record<string, unknown>;
        return { file: ws.absFromRel(str(o.file, 500)) ?? "", why: str(o.why, 400) };
      }).filter((n) => n.file).slice(0, 4),
      depth,
      fileHashes: this.hashes(ws, files),
      sketch,
      steer,
      differences: sketch ? strs(raw.differences) : undefined,
      trace: trace ? cleanTrace(raw.trace, ws) : undefined,
    };
    this.store.put(project.id, "lenses", lens);
    // A refresh replaces the old lens; keep one copy, not a pile of versions.
    if (old) this.store.archive(project.id, "lenses", old.id);
    return lens;
  }

  /**
   * A follow-up question on a lens, answered on top of it: the reply becomes a new follow-up section,
   * its new terms and traps join the lens's own lists, and any extra files join the lens.
   */
  async lensMore(project: Project, id: string, req: { question: string; files?: string[] }): Promise<Lens> {
    const ws = new Workspace(project);
    const l = this.store.get(project.id, "lenses", id);
    if (!l) throw new Error("lens not found");
    const question = (req.question ?? "").trim().slice(0, 4000);
    if (!question) throw new Error("ask a question first");
    const extra = [...new Set((req.files ?? []).map((f) => ws.guard(f)))].filter((f) => !l.files.includes(f));
    const files = [...l.files, ...extra];
    const lesson = [
      `Title: ${l.title}`,
      l.tldr && `Idea: ${l.tldr}`,
      `Summary: ${l.summary}`,
      l.concepts.length && `Terms already defined: ${l.concepts.map((c) => c.term).join(", ")}`,
      `Steps:\n${l.deepDives.map((d) => `- ${d.title}`).join("\n")}`,
      l.gotchas?.length && `Gotchas:\n${l.gotchas.map((g) => `- ${g}`).join("\n")}`,
      ...(l.followUps ?? []).map((f) => `Earlier follow-up: ${f.question}\nAnswer: ${f.answer.slice(0, 1200)}`),
    ].filter(Boolean).join("\n\n").slice(0, 12_000);
    const raw = await this.ask<Record<string, unknown>>(
      ws, ["lensMore"], P.lensMoreSystem(l.depth), P.lensMorePrompt(question, lesson, this.bundle(ws, files), this.notes(ws, files)),
    );
    const known = new Set(l.concepts.map((c) => c.term.toLowerCase()));
    const concepts = arr(raw.concepts).map((c) => {
      const o = c as Record<string, unknown>;
      return { term: str(o.term, 120), explain: str(o.explain), example: str(o.example, 1000) || undefined, file: ws.absFromRel(str(o.file, 500)), line: num(o.line) };
    }).filter((c) => c.term && !known.has(c.term.toLowerCase())).slice(0, 3);
    const gotchas = strs(raw.gotchas, 400, 3).filter((g) => !l.gotchas?.includes(g));
    const next: Lens = {
      ...l,
      files,
      fileHashes: { ...this.hashes(ws, extra), ...l.fileHashes },
      concepts: [...l.concepts, ...concepts],
      gotchas: [...(l.gotchas ?? []), ...gotchas],
      followUps: [
        ...(l.followUps ?? []),
        {
          at: now(), question, files: extra, answer: str(raw.answer, 12_000),
          deepDives: arr(raw.deepDives).map((d) => cleanDive(d as Record<string, unknown>, ws)).filter((d) => d.title || d.body).slice(0, 4),
        },
      ],
    };
    return this.store.put(project.id, "lenses", next);
  }


  /**
   * Rewrite one block of a lens in place, from a selection and an instruction. The rest of the lesson goes
   * along as context; the old block is kept so the edit can be undone.
   */
  async lensRevise(project: Project, id: string, req: { block: string; selection?: string; instruction: string }): Promise<Lens> {
    const ws = new Workspace(project);
    const l = this.store.get(project.id, "lenses", id);
    if (!l) throw new Error("lens not found");
    const instruction = (req.instruction ?? "").trim().slice(0, 2000);
    if (!instruction) throw new Error("say how to change it first");
    const block = String(req.block ?? "");
    if (!blockIds(l).includes(block)) throw new Error(`this lens has no block "${block}"`);
    const raw = await this.ask<{ block: Record<string, unknown> }>(
      ws, ["lensRevise"], P.lensReviseSystem(l.depth),
      P.lensRevisePrompt({
        question: l.question, lesson: lessonText(l, ws, { skip: block, max: 16_000 }), id: block, block: blockForModel(l, block, ws),
        selection: req.selection?.trim().slice(0, 2000) || undefined, instruction, code: this.bundle(ws, l.files),
      }),
    );
    const edit: LensEdit = { at: now(), block, instruction, selection: req.selection?.trim().slice(0, 400) || undefined, before: snapshot(l, block) };
    const next = applyBlock(l, block, raw.block ?? {}, ws);
    return this.store.put(project.id, "lenses", { ...next, edits: [...(l.edits ?? []), edit].slice(-MAX_EDITS) });
  }

  /** Undo the newest revise. */
  lensUndo(project: Project, id: string): Lens {
    const l = this.store.get(project.id, "lenses", id);
    if (!l) throw new Error("lens not found");
    const edits = [...(l.edits ?? [])];
    const last = edits.pop();
    if (!last) throw new Error("nothing to undo");
    return this.store.put(project.id, "lenses", { ...restore(l, last.before), edits });
  }

  /**
   * Refresh or rework a lens block by block: a planner reads the lesson and the current code and says which
   * blocks to keep, rewrite (with an instruction each), drop or add; writers then rewrite only those, side by
   * side. Follow-ups are kept. The result replaces the old lens, like a full refresh does.
   */
  private async lensUpdate(project: Project, old: Lens, x: { steer?: string; rework: boolean }): Promise<Lens> {
    const ws = new Workspace(project);
    const files = old.files.map((f) => ws.guard(f));
    const code = this.bundle(ws, files);
    const depth: P.LensDepth = old.depth ?? "standard";
    const changedFiles = files.filter((f) => old.fileHashes?.[f] !== undefined && ws.hash(f) !== old.fileHashes[f]);
    const reason = x.rework
      ? "The reader asked for a rework with the steer below. The code may also have changed; check it."
      : `The code changed since the lesson was written${changedFiles.length ? `, in: ${changedFiles.map((f) => ws.rel(f)).join(", ")}` : ""}.`;
    const plan = await this.ask<Record<string, unknown>>(
      ws, ["lensUpdate"], P.lensUpdateSystem(depth),
      P.lensUpdatePrompt({ question: old.question, blocks: lessonText(old, ws, { max: 40_000 }), reason, steer: x.steer, code }),
      { role: "plan" },
    );
    const steerNote = x.steer ? `\nThe reader's steer for the whole lesson: ${x.steer}` : "";
    const lesson = lessonText(old, ws, { max: 16_000 });
    const reviseOne = (base: Lens, block: string, change: string) => () => this.ask<{ block: Record<string, unknown> }>(
      ws, ["lensRevise"], P.lensReviseSystem(depth),
      P.lensRevisePrompt({ question: old.question, lesson, id: block, block: blockForModel(base, block, ws), instruction: change + steerNote, code }),
    ).then((r) => ({ block, raw: r.block ?? {} }));

    // The new step list: kept steps as they were (maybe with new lines), rewritten and new ones filled in below.
    type Slot = { dive: DeepDive; change?: string; fresh?: Record<string, unknown> };
    const slots: Slot[] = [];
    for (const st of arr(plan.steps).map((v) => v as Record<string, unknown>)) {
      const lines = (d: DeepDive): DeepDive => {
        const startLine = num(st.startLine) ?? d.startLine;
        const endLine = num(st.endLine) ?? d.endLine;
        const ok = startLine && endLine && endLine >= startLine;
        return { ...d, ...(ok ? { startLine, endLine, line: num(st.line) ?? d.line } : {}), part: str(st.part, 120) || d.part };
      };
      const from = num(st.keep) ?? num(st.from);
      if (from !== undefined && old.deepDives[from]) slots.push({ dive: lines(old.deepDives[from]), change: st.keep === undefined ? str(st.change, 2000) || undefined : undefined });
      else if (st.new || st.title) {
        const d = cleanDive(st, ws);
        slots.push({ dive: { ...d, body: strs(st.covers, 400, 12).map((c) => `- ${c}`).join("\n") || str(st.why, 800) }, fresh: st });
      }
    }
    if (!slots.length) old.deepDives.forEach((d) => slots.push({ dive: d }));

    // Rewrites run against a draft that already has the new order and line ranges.
    let draft: Lens = { ...old, deepDives: slots.map((sl) => sl.dive) };
    const blockJobs = arr(plan.blocks).map((b) => b as Record<string, unknown>)
      .filter((b) => (LENS_BLOCKS as readonly string[]).includes(str(b.id)) && str(b.change))
      .map((b) => reviseOne(draft, str(b.id), str(b.change, 2000)));
    const stepJobs = slots.flatMap((sl, i) => (sl.change ? [reviseOne(draft, `step:${i}`, sl.change)] : []));
    const freshAt = slots.flatMap((sl, i) => (sl.fresh ? [i] : []));
    const freshJob = freshAt.length
      ? [() => this.ask<{ steps: Record<string, unknown>[] }>(
          ws, ["lensSteps"], P.lensStepsSystem({ depth }),
          P.lensWritePrompt(old.question, { title: old.title, tldr: old.tldr, steps: freshAt.map((i) => slots[i].fresh) }, code, {
            steps: [0, freshAt.length - 1], titles: draft.deepDives.map((d) => d.title), steer: x.steer,
          }),
        ).then((r) => ({ fresh: r.steps }))]
      : [];
    const results = await inParallel<unknown>([...blockJobs, ...stepJobs, ...freshJob], 3);

    const changed: string[] = [];
    for (const r of results as ({ block: string; raw: Record<string, unknown> } | { fresh: Record<string, unknown>[] })[]) {
      if ("block" in r) {
        draft = applyBlock(draft, r.block, r.raw, ws);
        changed.push(r.block);
      } else {
        arr(r.fresh).forEach((w, k) => {
          const o = w as Record<string, unknown>;
          const at = freshAt[num(o.index) ?? k];
          if (at === undefined) return;
          const deepDives = [...draft.deepDives];
          const chk = (o.check ?? {}) as Record<string, unknown>;
          deepDives[at] = {
            ...deepDives[at], body: str(o.body, 12_000) || deepDives[at].body, pitfall: str(o.pitfall, 800) || deepDives[at].pitfall,
            check: str(chk.q) && str(chk.a) ? { q: str(chk.q, 600), a: str(chk.a, 1000) } : deepDives[at].check,
          };
          draft = { ...draft, deepDives };
        });
        changed.push(...freshAt.map((i) => `step:${i}`));
      }
    }
    for (const k of ["title", "tldr", "whyItMatters"] as const) {
      const v = str(plan[k], k === "title" ? 120 : 800);
      if (v && v !== old[k]) {
        draft = { ...draft, [k]: v };
        changed.push(k);
      }
    }
    const note = str(plan.note, 600) || (changed.length ? `Rewrote ${changed.length} part${changed.length === 1 ? "" : "s"}.` : "Nothing needed to change.");
    const lens: Lens = {
      ...draft,
      id: newId(),
      createdAt: now(),
      fileHashes: this.hashes(ws, files),
      steer: x.steer,
      edits: [],
      update: { at: now(), kind: x.rework ? "rework" : "refresh", note, changed: [...new Set(changed)] },
    };
    this.store.put(project.id, "lenses", lens);
    this.store.archive(project.id, "lenses", old.id);
    return lens;
  }

  /**
   * A lens in parts instead of one call: the planner outlines (title, tldr, every step with its lines and
   * what it must cover), then the writer fills in the opening and the steps, a few steps per call, side by
   * side. The result has the same shape as the one-shot reply, so the caller does not care which ran.
   */
  private async lensStaged(
    ws: Workspace,
    x: { question: string; files: string[]; depth: P.LensDepth; extras: P.LensExtras; sketch: boolean; trace: boolean; cache: boolean },
  ): Promise<Record<string, unknown>> {
    const code = this.bundle(ws, x.files);
    const plan = await this.ask<Record<string, unknown>>(
      ws, ["lensPlan"], P.lensPlanSystem({ depth: x.depth, trace: x.trace }), P.lensPrompt(x.question, code, x.extras),
      { cache: x.cache, role: "plan" },
    );
    const planned = arr(plan.steps).map((st) => st as Record<string, unknown>);
    const introTasks: TaskName[] = ["lensIntro", ...(x.sketch ? ["lensSketch" as const] : []), ...(x.trace ? ["lensTrace" as const] : [])];
    const chunk = x.depth === "overview" ? 4 : 3;
    const ranges: [number, number][] = [];
    for (let i = 0; i < planned.length; i += chunk) ranges.push([i, Math.min(planned.length, i + chunk) - 1]);

    const jobs: (() => Promise<unknown>)[] = [
      () => this.ask<Record<string, unknown>>(
        ws, introTasks, P.lensIntroSystem({ depth: x.depth, sketch: x.sketch, trace: x.trace }),
        P.lensWritePrompt(x.question, plan, code, { extras: x.extras }), { cache: x.cache },
      ),
      ...ranges.map((r) => () => this.ask<{ steps: Record<string, unknown>[] }>(
        ws, ["lensSteps"], P.lensStepsSystem({ depth: x.depth }),
        P.lensWritePrompt(x.question, plan, code, { steps: r, titles: planned.slice(0, r[0]).map((st) => str(st.title, 200)), steer: x.extras.steer }), { cache: x.cache },
      )),
    ];
    const [intro, ...written] = (await inParallel(jobs, 3)) as [Record<string, unknown>, ...{ steps: Record<string, unknown>[] }[]];

    const bodies = new Map<number, Record<string, unknown>>();
    written.forEach((w, n) => arr(w.steps).forEach((st, k) => {
      const o = st as Record<string, unknown>;
      bodies.set(num(o.index) ?? ranges[n][0] + k, o);
    }));
    const deepDives = planned.map((st, i) => {
      const w = bodies.get(i) ?? {};
      const covers = strs(st.covers, 400, 12);
      return {
        title: st.title, file: st.file, line: st.line, startLine: st.startLine, endLine: st.endLine, part: st.part,
        // If a part never came back, fall back to the plan's own notes so the step is not empty.
        body: str(w.body, 12_000) || covers.map((c) => `- ${c}`).join("\n") || str(st.why, 800),
        pitfall: w.pitfall ?? (str(st.pitfall, 800) || undefined),
        check: w.check,
      };
    });
    return {
      ...intro,
      title: plan.title, tldr: plan.tldr, whyItMatters: plan.whyItMatters, verdict: plan.verdict, alsoNoticed: plan.alsoNoticed,
      concepts: arr(intro.concepts).length ? intro.concepts : arr(plan.concepts).map((c) => ({ ...(c as object), explain: str((c as Record<string, unknown>).note) })),
      gotchas: arr(intro.gotchas).length ? intro.gotchas : plan.gotchas,
      nextSteps: arr(intro.nextSteps).length ? intro.nextSteps : plan.nextSteps,
      deepDives,
    };
  }

  // ---- shelves ----------------------------------------------------------

  /** Shelves with how many lenses each holds, and the lenses that sit on no (existing) shelf. */
  private shelfState(pid: string) {
    const shelves = this.store.list(pid, "shelves");
    const ids = new Set(shelves.map((s) => s.id));
    const lenses = this.store.list(pid, "lenses");
    const count = new Map<string, number>();
    for (const l of lenses) if (l.shelf && ids.has(l.shelf)) count.set(l.shelf, (count.get(l.shelf) ?? 0) + 1);
    const text = shelves.map((s) => `${s.id} | ${s.name} | ${s.about} | ${count.get(s.id) ?? 0}`).join("\n");
    return { shelves, ids, lenses, text, unshelved: lenses.filter((l) => !l.shelf || !ids.has(l.shelf)) };
  }

  private newShelf(pid: string, name: string, about: string): Shelf {
    const shelves = this.store.list(pid, "shelves");
    const same = shelves.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (same) return same;
    return this.store.put(pid, "shelves", { id: newId(), projectId: pid, createdAt: now(), name: name.slice(0, 60), about: about.slice(0, 300) });
  }

  /** A lens as the shelving agent sees it: what it is about, not the whole lesson. */
  private lensCard(ws: Workspace, l: Lens, full = false): string {
    return [
      `- id: ${l.id}`,
      `  title: ${l.title}`,
      l.tldr && `  idea: ${l.tldr}`,
      `  question: ${l.question}`,
      `  files: ${l.files.slice(0, 8).map((f) => ws.rel(f)).join(", ")}`,
      full && l.summary && `  summary: ${l.summary.slice(0, 600)}`,
      full && `  steps: ${l.deepDives.map((d) => d.title).join(" / ").slice(0, 1200)}`,
    ].filter(Boolean).join("\n");
  }

  /**
   * Put every unshelved lens on a shelf: existing shelves stay as they are, the agent adds shelves only when
   * none fits. Lenses that are already shelved are not sent, so a second run does not reshuffle anything.
   */
  async organize(project: Project): Promise<{ id: string; placed: number; created: number }> {
    const ws = new Workspace(project);
    const pid = project.id;
    const todo = this.shelfState(pid).unshelved;
    let placed = 0;
    let created = 0;
    // A big backlog goes in batches; each batch sees the shelves the last one made.
    for (let i = 0; i < todo.length; i += 40) {
      const batch = todo.slice(i, i + 40);
      const st = this.shelfState(pid);
      const raw = await this.ask<{ newShelves?: unknown[]; place: unknown[] }>(
        ws, ["shelve"], P.shelveSystem(), P.shelvePrompt(st.text, batch.map((l) => this.lensCard(ws, l)).join("\n")),
      );
      const keys = new Map<string, string>();
      for (const n of arr(raw.newShelves).map((x) => x as Record<string, unknown>)) {
        const name = str(n.name, 60).trim();
        if (!name) continue;
        const before = this.store.list(pid, "shelves").length;
        keys.set(str(n.key, 40), this.newShelf(pid, name, str(n.about, 300)).id);
        if (this.store.list(pid, "shelves").length > before) created++;
      }
      const want = new Set(batch.map((l) => l.id));
      const ids = new Set(this.store.list(pid, "shelves").map((s) => s.id));
      for (const pl of arr(raw.place).map((x) => x as Record<string, unknown>)) {
        const lid = str(pl.lens, 40);
        const target = keys.get(str(pl.shelf, 40)) ?? str(pl.shelf, 40);
        const l = want.has(lid) ? this.store.get(pid, "lenses", lid) : undefined;
        if (!l || !ids.has(target)) continue;
        want.delete(lid);
        this.store.put(pid, "lenses", { ...l, shelf: target, shelfPinned: false });
        placed++;
      }
    }
    // A shelf the agent made but filled with nothing is noise.
    const st = this.shelfState(pid);
    for (const s of st.shelves) if (!st.lenses.some((l) => l.shelf === s.id)) this.store.archive(pid, "shelves", s.id);
    return { id: "", placed, created };
  }

  /** Take a shelf apart and sort its lenses again; lenses you placed yourself stay where they are. */
  async reworkShelf(project: Project, shelfId: string): Promise<{ id: string; placed: number; created: number }> {
    const pid = project.id;
    if (!this.store.get(pid, "shelves", shelfId)) throw new Error("shelf not found");
    const on = this.store.list(pid, "lenses").filter((l) => l.shelf === shelfId);
    for (const l of on) if (!l.shelfPinned) this.store.put(pid, "lenses", { ...l, shelf: undefined, shelfPinned: false });
    // With nothing pinned left on it, the shelf itself goes too, so the agent can name the topic afresh.
    if (on.every((l) => !l.shelfPinned)) this.store.archive(pid, "shelves", shelfId);
    return this.organize(project);
  }

  /** Move every lens from the other shelves onto `into`, and drop the emptied shelves. */
  mergeShelves(project: Project, into: string, from: string[]): Shelf {
    const pid = project.id;
    const target = this.store.get(pid, "shelves", into);
    if (!target) throw new Error("shelf not found");
    const gone = new Set(from.filter((id) => id !== into && this.store.get(pid, "shelves", id)));
    if (!gone.size) throw new Error("pick a shelf to merge");
    for (const l of this.store.list(pid, "lenses")) if (l.shelf && gone.has(l.shelf)) this.store.put(pid, "lenses", { ...l, shelf: into });
    for (const id of gone) this.store.archive(pid, "shelves", id);
    return target;
  }

  /** Put a lens on a shelf by hand (pinned), or back on Unshelved (null; unpinned, so Organize may place it). */
  moveLens(project: Project, lensId: string, shelfId: string | null): Lens {
    const pid = project.id;
    const l = this.store.get(pid, "lenses", lensId);
    if (!l) throw new Error("lens not found");
    if (shelfId && !this.store.get(pid, "shelves", shelfId)) throw new Error("shelf not found");
    return this.store.put(pid, "lenses", { ...l, shelf: shelfId ?? undefined, shelfPinned: !!shelfId });
  }

  /** Ask the agent where one lens belongs, with the reader's steer weighing most. The result is pinned. */
  async reshelve(project: Project, lensId: string, steer?: string): Promise<Lens> {
    const ws = new Workspace(project);
    const pid = project.id;
    const l = this.store.get(pid, "lenses", lensId);
    if (!l) throw new Error("lens not found");
    const st = this.shelfState(pid);
    const raw = await this.ask<Record<string, unknown>>(
      ws, ["shelveOne"], P.shelveOneSystem(), P.shelveOnePrompt(st.text, this.lensCard(ws, l, true), steer?.trim().slice(0, 1000) || undefined),
    );
    let target = str(raw.shelf, 40);
    if (target === "new" || !st.ids.has(target)) {
      const name = str(raw.name, 60).trim();
      if (!name) throw new Error("the model did not pick a shelf");
      target = this.newShelf(pid, name, str(raw.about, 300)).id;
    }
    const old = l.shelf;
    const next = this.store.put(pid, "lenses", { ...l, shelf: target, shelfPinned: true });
    // The lens's old shelf, if now empty, goes.
    if (old && old !== target && !this.store.list(pid, "lenses").some((x) => x.shelf === old)) this.store.archive(pid, "shelves", old);
    return next;
  }

  // ---- quiz ------------------------------------------------------------

  async quiz(
    project: Project, req: { files: string[]; diff?: DiffSpec; lensId?: string; shelfId?: string; count?: number; weak?: boolean; weakIds?: string[];
      /** What the learner read, when it is not one lens (a shelf quiz). */
      lensSummary?: string },
  ): Promise<Quiz> {
    const ws = new Workspace(project);
    if (req.shelfId) {
      // A shelf quiz mixes the topic's lenses: their files as the code, their ideas as what was read.
      const shelf = this.store.get(project.id, "shelves", req.shelfId);
      if (!shelf) throw new Error("shelf not found");
      const on = this.store.list(project.id, "lenses").filter((l) => l.shelf === shelf.id);
      if (!on.length) throw new Error("this shelf has no lenses");
      const read = on.map((l) => `- ${l.title}: ${l.tldr ?? l.summary.slice(0, 300)}`).join("\n");
      const q = await this.quiz(project, { files: [...new Set(on.flatMap((l) => l.files))].slice(0, 20), count: req.count ?? Math.min(8, on.length + 3), lensSummary: read });
      return this.store.put(project.id, "quizzes", { ...q, title: `${shelf.name}: ${q.title}` });
    }
    const lens = req.lensId ? this.store.get(project.id, "lenses", req.lensId) : undefined;
    const pick = req.weakIds?.length ? new Set(req.weakIds) : undefined;
    const weak = req.weak ? openMisconceptions(this.store, project.id).filter((m) => !pick || pick.has(m.id)).slice(0, 6) : [];
    if (req.weak && !weak.length) throw new Error("no open weak spots: nothing to aim at yet");
    const weakFiles = weak.map((m) => m.file).filter((f): f is string => !!f);
    const files = [...new Set((req.files.length ? req.files : lens?.files ?? weakFiles).map((f) => ws.guard(f)))];
    if (!files.length && !weak.length) throw new Error("pick at least one file");
    const n = Math.min(Math.max(req.count ?? (weak.length || this.settings()["quiz.questions"]), 1), 10);
    const raw = await this.ask<Record<string, unknown>>(
      ws, ["quiz"], P.quizSystem(n),
      P.quizPrompt(this.bundle(ws, files), this.diffText(ws, req.diff ?? lens?.diff, files), req.lensSummary ?? lens?.summary, weak.map((m) => ({ id: m.id, text: m.text }))),
      { plan: true },
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

  async practice(project: Project, req: { file?: string; files?: string[]; concept?: string; level: number }): Promise<Practice> {
    const ws = new Workspace(project);
    const level = (Math.min(Math.max(Math.round(req.level || 2), 1), 4)) as Practice["level"];
    const paths = [...new Set([...(req.files ?? []), ...(req.file ? [req.file] : [])].map((f) => ws.guard(f)))];
    // Data, config and text can be read for context but hold no logic to cut.
    const DATA = /\.(json|ya?ml|toml|ini|cfg|lock|csv|tsv|md|txt|svg|xml|html?|css)$/i;
    const code = paths.filter((f) => !DATA.test(f));
    if (!code.length) throw new Error("practice needs at least one file with logic (code). These are data, config or text; add a source file.");
    const texts = new Map(paths.map((f) => [f, ws.read(f).text] as const));
    const concept = (req.concept ?? "").trim().slice(0, 300);
    const prompt =
      (concept ? `CONCEPT TO PRACTISE: ${concept}\n\n` : "") +
      `CODE FILES (holes may be cut from these):\n${this.bundle(ws, code)}` +
      (paths.length > code.length ? `\n\nCONTEXT FILES (read only, no holes):\n${this.bundle(ws, paths.filter((f) => DATA.test(f)))}` : "");
    const raw = await this.ask<{ concept?: unknown; holes?: unknown[] }>(ws, ["practice"], P.practiceSystem(level, !!concept, code.length > 1), prompt, { plan: true });
    // Match each hole to a file by the path the model saw; one code file needs no path.
    const byFile = new Map<string, unknown[]>();
    for (const h of arr(raw.holes)) {
      const want = str((h as Record<string, unknown>).file, 500);
      const hit = want ? code.find((f) => ws.rel(f) === want || ws.rel(f).endsWith(want) || want.endsWith(ws.rel(f))) : code.length === 1 ? code[0] : undefined;
      if (hit) byFile.set(hit, [...(byFile.get(hit) ?? []), h]);
    }
    const holes: Hole[] = [];
    const files: PracticeFile[] = [];
    for (const f of paths) {
      const original = texts.get(f)!;
      const lines = original.split("\n");
      // cleanHoles numbers from 1 per file; renumber across files so a hole id is unique in the practice.
      const mine = cleanHoles(byFile.get(f) ?? [], lines.length, lines).map((h, i) => ({ ...h, id: holes.length + i + 1, file: f }));
      holes.push(...mine);
      const holed = mine.length ? applyHoles(original, mine, langOf(f)) : original;
      files.push({ path: f, original, holed, attempt: holed });
    }
    if (!holes.length) throw new Error("the model found no lines with real logic to turn into holes; try other files or a higher level");
    // Files with holes first, in the order given; read-only context after them.
    files.sort((x, y) => Number(holes.some((h) => h.file === y.path)) - Number(holes.some((h) => h.file === x.path)));
    const first = files[0];
    const p: Practice = {
      id: newId(), projectId: project.id, createdAt: now(),
      concept: concept || str(raw.concept, 300) || undefined,
      files, file: first.path, level, original: first.original, holed: first.holed, holes, attempt: first.holed,
    };
    return this.store.put(project.id, "practice", p);
  }

  saveAttempt(project: Project, id: string, text: string, file?: string): Practice {
    const got = this.store.get(project.id, "practice", id);
    if (!got) throw new Error("practice not found");
    const p = normalizePractice(got);
    const f = p.files!.find((x) => x.path === file) ?? p.files![0];
    f.attempt = text.slice(0, 1_000_000);
    if (f.path === p.file) p.attempt = f.attempt;
    return this.store.put(project.id, "practice", p);
  }

  async review(project: Project, id: string): Promise<Practice> {
    const ws = new Workspace(project);
    const got = this.store.get(project.id, "practice", id);
    if (!got) throw new Error("practice not found");
    const p = normalizePractice(got);
    const parts = p.files!
      .map((f) => ({ rel: ws.rel(f.path), original: f.original, attempt: f.attempt, holes: p.holes.filter((h) => h.file === f.path) }))
      .filter((f) => f.holes.length);
    const raw = await this.ask<{ summary?: unknown; holes?: unknown[] }>(ws, ["review"], P.reviewSystem(), P.reviewPrompt(parts));
    const got2 = new Map(arr(raw.holes).map((h) => [num((h as Record<string, unknown>).id), h as Record<string, unknown>]));
    const holes: HoleReview[] = p.holes.map((h) => {
      const o = got2.get(h.id) ?? {};
      return { id: h.id, verdict: verdict(o.verdict), feedback: str(o.feedback) };
    });
    p.review = { at: now(), holes, summary: str(raw.summary) };
    return this.store.put(project.id, "practice", p);
  }

  // ---- teach-back ------------------------------------------------------

  async teachback(project: Project, req: { files: string[]; text: string; diff?: DiffSpec }): Promise<Teachback> {
    const ws = new Workspace(project);
    const files = req.files.map((f) => ws.guard(f));
    if (!files.length) throw new Error("pick at least one file");
    const text = (req.text ?? "").trim().slice(0, 20_000);
    if (text.length < 20) throw new Error("write a few sentences first");
    const raw = await this.ask<Record<string, unknown>>(
      ws, ["teachback"], P.teachbackSystem(), P.teachbackPrompt(text, this.bundle(ws, files), this.diffText(ws, req.diff, files)),
    );
    const t: Teachback = {
      id: newId(), projectId: project.id, createdAt: now(), files, fileHashes: this.hashes(ws, files), text, diff: req.diff,
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

  async startThread(project: Project, req: { files: string[]; text: string; diff?: DiffSpec }): Promise<Thread> {
    const ws = new Workspace(project);
    const files = req.files.map((f) => ws.guard(f));
    if (!files.length) throw new Error("pick at least one file");
    const text = (req.text ?? "").trim();
    if (!text) throw new Error("ask a question first");
    const t: Thread = { id: newId(), projectId: project.id, createdAt: now(), title: text.split("\n")[0].slice(0, 80), files, diff: req.diff, messages: [] };
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
    const raw = await this.ask<{ reply?: unknown }>(
      ws, ["tutor"], P.tutorSystem(level, tell),
      P.tutorPrompt(t.messages, this.bundle(ws, t.files), this.notes(ws, t.files), this.diffText(ws, t.diff, t.files)),
    );
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
    const code = this.bundle(ws, [file]);
    let rawBlocks: unknown[];
    if (this.settings()["generate.plan"]) {
      // Planner picks the blocks and the examples; the writer teaches a few blocks per call, side by side.
      const plan = await this.ask<{ blocks: Record<string, unknown>[] }>(ws, ["walkPlan"], P.walkPlanSystem(), `CODE:\n${code}`, { cache: true, role: "plan" });
      const planned = arr(plan.blocks).slice(0, 14).map((b) => b as Record<string, unknown>);
      const ranges: [number, number][] = [];
      for (let i = 0; i < planned.length; i += 3) ranges.push([i, Math.min(planned.length, i + 3) - 1]);
      const written = await inParallel(
        ranges.map((r) => () => this.ask<{ blocks: Record<string, unknown>[] }>(
          ws, ["walkBlocks"], P.walkBlocksSystem(),
          P.walkWritePrompt({ blocks: planned }, r, planned.slice(0, r[0]).map((b) => str(b.title, 160)), code), { cache: true },
        )),
        3,
      );
      const byIndex = new Map<number, Record<string, unknown>>();
      written.forEach((w, n) => arr(w.blocks).forEach((b, k) => {
        const o = b as Record<string, unknown>;
        byIndex.set(num(o.index) ?? ranges[n][0] + k, o);
      }));
      rawBlocks = planned.map((b, i) => ({ ...b, ...(byIndex.get(i) ?? {}), question: str(byIndex.get(i)?.question, 800) || str(b.question, 800) }));
    } else {
      rawBlocks = (await this.ask<{ blocks?: unknown[] }>(ws, ["walk"], P.walkSystem(), `CODE:\n${code}`, { cache: true })).blocks ?? [];
    }
    const blocks = arr(rawBlocks).map((b) => {
      const o = b as Record<string, unknown>;
      const startLine = num(o.startLine) ?? 0;
      return {
        startLine, endLine: Math.min(lines, num(o.endLine) ?? startLine), title: str(o.title, 120), why: str(o.why, 800),
        explain: str(o.explain, 6000) || undefined, example: str(o.example, 6000) || undefined, question: str(o.question, 800),
      };
    }).filter((b) => b.startLine >= 1 && b.endLine >= b.startLine && b.question).slice(0, 12);
    if (blocks.length < 2) throw new Error("the model could not split this file into blocks");
    return this.store.put(project.id, "walks", { id: newId(), projectId: project.id, createdAt: now(), file, fileHash: content.hash, blocks });
  }

  /** Rewrite one walkthrough block's teaching text from a selection and an instruction; undo takes it back. */
  async walkRevise(project: Project, id: string, req: { block: number; selection?: string; instruction: string }): Promise<Walk> {
    const ws = new Workspace(project);
    const w = this.store.get(project.id, "walks", id);
    if (!w) throw new Error("walkthrough not found");
    const b = w.blocks[req.block];
    if (!b) throw new Error(`no block ${req.block + 1} in this walkthrough`);
    const instruction = (req.instruction ?? "").trim().slice(0, 2000);
    if (!instruction) throw new Error("say how to change it first");
    const lesson = w.blocks.map((x, i) => `${i === req.block ? ">> " : ""}Block ${i + 1}, lines ${x.startLine}-${x.endLine}: ${x.title}. ${x.why}`).join("\n");
    const raw = await this.ask<{ block: Record<string, unknown> }>(
      ws, ["walkRevise"], P.walkReviseSystem(),
      P.lensRevisePrompt({
        question: `Walk through ${ws.rel(w.file)} block by block`, lesson, id: `block ${req.block + 1} (lines ${b.startLine}-${b.endLine})`,
        block: { title: b.title, why: b.why, explain: b.explain ?? "", example: b.example ?? "" },
        selection: req.selection?.trim().slice(0, 2000) || undefined, instruction, code: this.bundle(ws, [w.file]),
      }),
    );
    const o = raw.block ?? {};
    const next = {
      ...b,
      title: str(o.title, 120) || b.title, why: str(o.why, 800) || b.why,
      explain: str(o.explain, 8000) || b.explain, example: str(o.example, 4000) || b.example,
    };
    const blocks = [...w.blocks];
    blocks[req.block] = next;
    const edits = [...(w.edits ?? []), { at: now(), block: req.block, instruction, before: b }].slice(-MAX_EDITS);
    return this.store.put(project.id, "walks", { ...w, blocks, edits });
  }

  /** Undo the newest walkthrough revise. The answer and grade on the block stay as they are now. */
  walkUndo(project: Project, id: string): Walk {
    const w = this.store.get(project.id, "walks", id);
    if (!w) throw new Error("walkthrough not found");
    const edits = [...(w.edits ?? [])];
    const last = edits.pop();
    if (!last) throw new Error("nothing to undo");
    const blocks = [...w.blocks];
    const cur = blocks[last.block];
    blocks[last.block] = { ...last.before, answer: cur.answer, verdict: cur.verdict, feedback: cur.feedback };
    return this.store.put(project.id, "walks", { ...w, blocks, edits });
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
    const raw = await this.ask<{ bugs?: unknown[] }>(ws, ["hunt"], P.huntSystem(level), `CODE:\n${this.bundle(ws, [file])}`, { plan: true });
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
      { cache: true, plan: true },
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

/** A step of the walkthrough; a bad or missing range becomes a small window around the key line. */
/** Run the jobs with at most `limit` in flight; results keep the jobs' order. */
async function inParallel<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return out;
}

// ---- lens blocks: the parts of a lens that can be rewritten on their own -----------------------

const LENS_BLOCKS = ["tldr", "summary", "verdict", "intuition", "concepts", "gotchas", "alsoNoticed"] as const;
const MAX_EDITS = 10;

/** Every block a lens has, in page order (steps after the intuition, as the page shows them). */
function blockIds(l: Lens): string[] {
  const has = (id: string) => {
    const v = (l as unknown as Record<string, unknown>)[id];
    return Array.isArray(v) ? v.length > 0 : !!v;
  };
  const head = LENS_BLOCKS.filter((b) => b === "tldr" || has(b));
  const at = head.indexOf("intuition") >= 0 ? head.indexOf("intuition") + 1 : head.length;
  return [...head.slice(0, at), ...l.deepDives.map((_, i) => `step:${i}`), ...head.slice(at)];
}

function stepIndex(id: string): number | undefined {
  const m = /^step:(\d+)$/.exec(id);
  return m ? Number(m[1]) : undefined;
}

/** A dive as the model sees it: relative paths, no empty fields. */
function diveForModel(d: DeepDive, ws: Workspace) {
  return {
    title: d.title, file: d.file ? ws.rel(d.file) : undefined, startLine: d.startLine, endLine: d.endLine, line: d.line,
    body: d.body, pitfall: d.pitfall, check: d.check, part: d.part,
  };
}

/** One block's content, in the shape the revise prompt asks the model to send back. */
function blockForModel(l: Lens, id: string, ws: Workspace): Record<string, unknown> {
  const i = stepIndex(id);
  if (i !== undefined) {
    const d = l.deepDives[i];
    if (!d) throw new Error(`no step ${i + 1} in this lens`);
    return diveForModel(d, ws);
  }
  switch (id) {
    case "tldr": return { tldr: l.tldr ?? "", whyItMatters: l.whyItMatters ?? "" };
    case "concepts": return { concepts: l.concepts.map((c) => ({ ...c, file: c.file ? ws.rel(c.file) : undefined })) };
    case "summary": case "verdict": case "intuition": case "gotchas": case "alsoNoticed":
      return { [id]: (l as unknown as Record<string, unknown>)[id] ?? "" };
    default: throw new Error(`unknown block: ${id}`);
  }
}

/** The lens's own fields for a block, to undo an edit. */
function snapshot(l: Lens, id: string): LensEdit["before"] {
  const i = stepIndex(id);
  if (i !== undefined) return { step: i, dive: l.deepDives[i] };
  if (id === "tldr") return { tldr: l.tldr, whyItMatters: l.whyItMatters };
  return { [id]: (l as unknown as Record<string, unknown>)[id] } as Partial<Lens>;
}

function restore(l: Lens, before: LensEdit["before"]): Lens {
  if ("step" in before && "dive" in before) {
    const deepDives = [...l.deepDives];
    deepDives[before.step] = before.dive;
    return { ...l, deepDives };
  }
  return { ...l, ...(before as Partial<Lens>) };
}

/** A lens with one block replaced by the model's rewrite. Empty or missing fields keep the old text. */
function applyBlock(l: Lens, id: string, raw: Record<string, unknown>, ws: Workspace): Lens {
  const i = stepIndex(id);
  if (i !== undefined) {
    const old = l.deepDives[i];
    const d = cleanDive({ ...diveForModel(old, ws), ...raw }, ws);
    const deepDives = [...l.deepDives];
    deepDives[i] = { ...d, file: d.file ?? old.file, body: d.body || old.body, title: d.title || old.title, part: d.part ?? old.part };
    return { ...l, deepDives };
  }
  switch (id) {
    case "tldr": return { ...l, tldr: str(raw.tldr, 400) || l.tldr, whyItMatters: str(raw.whyItMatters, 800) || l.whyItMatters };
    case "summary": return { ...l, summary: str(raw.summary) || l.summary };
    case "verdict": return { ...l, verdict: str(raw.verdict, 4000) || l.verdict };
    case "intuition": return { ...l, intuition: str(raw.intuition, 12_000) || l.intuition };
    case "gotchas": { const g = strs(raw.gotchas, 400, 10); return { ...l, gotchas: g.length ? g : l.gotchas }; }
    case "alsoNoticed": { const a = strs(raw.alsoNoticed, 600, 8); return { ...l, alsoNoticed: a.length ? a : l.alsoNoticed }; }
    case "concepts": {
      const c = arr(raw.concepts).map((x) => {
        const o = x as Record<string, unknown>;
        return { term: str(o.term, 120), explain: str(o.explain), example: str(o.example, 1000) || undefined, file: ws.absFromRel(str(o.file, 500)), line: num(o.line) };
      }).filter((x) => x.term);
      return { ...l, concepts: c.length ? c : l.concepts };
    }
    default: throw new Error(`unknown block: ${id}`);
  }
}

/** The whole lesson as blocks, for context (`skip` leaves the block being rewritten out). */
function lessonText(l: Lens, ws: Workspace, opts: { skip?: string; max?: number } = {}): string {
  const head = [`=== TITLE\n${l.title}`];
  const blocks = blockIds(l).filter((b) => b !== opts.skip).map((b) => `=== BLOCK ${b}\n${JSON.stringify(blockForModel(l, b, ws))}`);
  return [...head, ...blocks].join("\n\n").slice(0, opts.max ?? 30_000);
}

function cleanDive(o: Record<string, unknown>, ws: Workspace) {
  const file = ws.absFromRel(str(o.file, 500));
  const line = num(o.line);
  let startLine = num(o.startLine);
  let endLine = num(o.endLine);
  if (!startLine || !endLine || endLine < startLine) {
    startLine = line ? Math.max(1, line - 3) : undefined;
    endLine = line ? line + 6 : undefined;
  }
  if (startLine && endLine && endLine - startLine > 40) endLine = startLine + 40;
  const chk = (o.check ?? {}) as Record<string, unknown>;
  const q = str(chk.q, 600);
  const a = str(chk.a, 1000);
  return {
    title: str(o.title, 200), file, line: line ?? startLine, startLine, endLine, body: str(o.body, 12_000),
    pitfall: str(o.pitfall, 800) || undefined,
    check: q && a ? { q, a } : undefined,
    part: str(o.part, 120) || undefined,
  };
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
/** Old practices hold one file in top-level fields; give them the files list and a file on each hole. */
export function normalizePractice(p: Practice): Practice {
  if (p.files?.length) return p;
  return {
    ...p,
    files: [{ path: p.file, original: p.original, holed: p.holed, attempt: p.attempt }],
    holes: p.holes.map((h) => ({ ...h, file: h.file ?? p.file })),
  };
}

/** A line that carries no logic: blank, a comment, a bracket, an import or a decorator. */
const TRIVIAL = /^\s*(?:$|\/\/|#|\*|\/\*|\*\/|[{}()\[\];,]+\s*$|import\b|from\s+\S+\s+import\b|export\s*\{|@\w+|"""|'\'\'\')/;

export function cleanHoles(raw: unknown[], lineCount: number, lines?: string[]): Hole[] {
  const holes = raw
    .map((h) => h as Record<string, unknown>)
    .map((o) => ({
      startLine: num(o.startLine) ?? 0,
      endLine: num(o.endLine) ?? num(o.startLine) ?? 0,
      intent: str(o.intent, 500),
      hints: arr(o.hints).map((x) => str(x, 500)).filter(Boolean).slice(0, 3),
    }))
    .filter((h) => h.startLine >= 1 && h.endLine >= h.startLine && h.endLine <= lineCount)
    // A hole must hold at least two lines of real logic; a cut of braces and comments teaches nothing.
    .filter((h) => !lines || lines.slice(h.startLine - 1, h.endLine).filter((l) => !TRIVIAL.test(l)).length >= Math.min(2, h.endLine - h.startLine + 1))
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
    // A comment alone is valid almost everywhere. Python is the exception: a block whose whole body was cut
    // ("def f():" then the hole) is a syntax error, so it gets "pass" in front of the marker.
    const prev = lines.slice(0, h.startLine - 1).reverse().find((l) => l.trim());
    const next = lines.slice(h.endLine).find((l) => l.trim());
    const nextIndent = next === undefined ? -1 : (/^\s*/.exec(next)?.[0].length ?? 0);
    const emptyBlock = lang === "python" && !!prev && /:\s*(#.*)?$/.test(prev) && nextIndent < indent.length;
    lines.splice(h.startLine - 1, h.endLine - h.startLine + 1, `${indent}${emptyBlock ? "pass  " : ""}${open} HOLE ${h.id}: ${h.intent}${close}`);
  }
  return lines.join("\n");
}
