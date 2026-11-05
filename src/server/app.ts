import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { Hono, type Context } from "hono";
import { makeAgent, type Agent } from "../core/agent/index.js";
import {
  dueCards, glossary, makeCard, openMisconceptions, pathDone, previewCard, rateCard, today,
} from "../core/insights.js";
import { Jobs } from "../core/jobs.js";
import { LENS_KINDS } from "../core/prompts.js";
import { Learn } from "../core/services.js";
import { prune, usage } from "../core/storage.js";
import { newId, type Collection, type Store } from "../core/store.js";
import type {
  AgentInfo, Answer, Card, DiffSpec, Graph, Hunt, JobKind, LearningPath, Note, PathStop, Project, Rating, Settings,
} from "../core/types.js";
import { browse, Workspace } from "../core/workspace.js";
import { lensMarkdown, quizMarkdown } from "./export.js";

/** JSON API under /api. The CLI mounts the built web app next to it. */
export function createApi(store: Store, opts: { pruneEveryMs?: number } = {}) {
  const api = new Hono();
  const jobs = new Jobs(store);

  // Keep ~/.groklab bounded: clean up now and every few hours.
  const sweep = () => {
    try {
      prune(store);
    } catch {
      /* a failed sweep must never stop the app */
    }
  };
  sweep();
  if (opts.pruneEveryMs) setInterval(sweep, opts.pruneEveryMs).unref();

  // The import graph is cheap but not free on a big repo; reuse it for a minute.
  const graphs = new Map<string, { at: number; g: Graph }>();
  const graphOf = (p: Project): Graph => {
    const hit = graphs.get(p.id);
    if (hit && Date.now() - hit.at < 60_000) return hit.g;
    const g = new Workspace(p).graph();
    graphs.set(p.id, { at: Date.now(), g });
    return g;
  };
  const hubs = (p: Project) => graphOf(p).nodes.filter((n) => n.fanIn > 0).sort((a, b) => b.fanIn - a.fanIn).map((n) => n.path);
  const offline = () => new Learn(store, { name: "none", complete: async () => "" });
  let current: { agent: Agent | null; info: AgentInfo } | null = null;
  const agent = () => (current ??= makeAgent(store.settings()));

  const fail = (c: Context, status: 400 | 404 | 503, error: string) => c.json({ error }, status);

  const project = (c: Context): Project => {
    const p = store.project(c.req.param("pid") ?? "");
    if (!p) throw new HttpError(404, "project not found");
    return p;
  };

  /** Start model work as a job. Fails fast when no model is set up. */
  const startJob = (c: Context, kind: JobKind, p: Project, work: (l: Learn) => Promise<{ id: string }>) => {
    const a = agent();
    if (!a.agent) return fail(c, 503, a.info.detail);
    const learn = new Learn(store, a.agent);
    return c.json(jobs.start(kind, p.id, () => work(learn)), 202);
  };

  const body = async <T>(c: Context): Promise<T> => {
    try {
      return (await c.req.json()) as T;
    } catch {
      throw new HttpError(400, "body must be JSON");
    }
  };

  api.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    const status = /outside the project|bad ref|not a file|pick at least|already graded|write a few|ask a question|write something|no open weak|needs a file inside a git repo|no commits yet/.test(msg) ? 400 : /ENOENT|not found/.test(msg) ? 404 : 500;
    return c.json({ error: msg }, status);
  });

  // ---- app -------------------------------------------------------------

  api.get("/health", (c) => c.json({ ok: true, home: store.home, agent: agent().info }));
  api.get("/lens-kinds", (c) => c.json(LENS_KINDS));

  api.get("/settings", (c) => c.json({ settings: store.settings(), agent: agent().info, home: store.home }));
  api.put("/settings", async (c) => {
    const s = store.saveSettings(await body<Partial<Settings>>(c));
    current = null; // re-pick the adapter with the new settings
    return c.json({ settings: s, agent: agent().info, home: store.home });
  });

  api.get("/browse", (c) => {
    const path = c.req.query("path") || homedir();
    if (!existsSync(path) || !statSync(path).isDirectory()) return fail(c, 404, "folder not found");
    return c.json(browse(path));
  });

  api.get("/jobs", (c) => c.json(jobs.history()));
  api.get("/storage", (c) => c.json(usage(store)));
  api.post("/storage/prune", (c) => c.json({ ...prune(store), usage: usage(store) }));

  api.get("/jobs/:id", (c) => {
    const j = jobs.get(c.req.param("id"));
    return j ? c.json(j) : fail(c, 404, "job not found");
  });

  // ---- projects --------------------------------------------------------

  api.get("/projects", (c) => c.json(store.projects()));
  api.post("/projects", async (c) => {
    const { root, name } = await body<{ root?: string; name?: string }>(c);
    if (!root || !existsSync(root) || !statSync(root).isDirectory()) return fail(c, 400, "not a folder");
    return c.json(store.openProject(root, name));
  });
  api.get("/projects/:pid", (c) => {
    const p = project(c);
    return c.json({ ...p, running: jobs.running(p.id) });
  });
  api.patch("/projects/:pid", async (c) => {
    const p = project(c);
    const patch = await body<{ name?: string; contexts?: string[] }>(c);
    for (const ctx of patch.contexts ?? []) {
      if (!existsSync(ctx) || !statSync(ctx).isDirectory()) return fail(c, 400, `not a folder: ${ctx}`);
    }
    return c.json(store.updateProject(p.id, patch));
  });
  api.delete("/projects/:pid", (c) => {
    store.forgetProject(project(c).id);
    return c.json({ ok: true });
  });

  // ---- files and git ---------------------------------------------------

  api.get("/projects/:pid/tree", (c) => c.json(new Workspace(project(c)).tree()));
  api.get("/projects/:pid/file", (c) => c.json(new Workspace(project(c)).read(c.req.query("path") ?? "")));
  api.get("/projects/:pid/repos", (c) => c.json(new Workspace(project(c)).repos()));
  api.get("/projects/:pid/refs", (c) => c.json(new Workspace(project(c)).refs(c.req.query("repo") || undefined)));
  api.get("/projects/:pid/diff", (c) => {
    const spec: DiffSpec = { repo: c.req.query("repo") || undefined, base: c.req.query("base") || "HEAD", head: c.req.query("head") ?? "" };
    return c.json(new Workspace(project(c)).diff(spec));
  });

  // ---- lenses ----------------------------------------------------------

  api.get("/projects/:pid/lenses", (c) => c.json(store.list(project(c).id, "lenses")));
  api.get("/projects/:pid/lenses/:id", (c) => {
    const p = project(c);
    const l = store.get(p.id, "lenses", c.req.param("id"));
    if (!l) return fail(c, 404, "lens not found");
    // Files that changed since the lens was made, for the "refresh" banner.
    const ws = new Workspace(p);
    const changed = l.fileHashes ? l.files.filter((f) => ws.hash(f) !== l.fileHashes![f]) : [];
    return c.json({ ...l, changed });
  });
  api.post("/projects/:pid/lenses", async (c) => {
    const p = project(c);
    const req = await body<{
      files: string[]; kind: string; question?: string; diff?: DiffSpec; sketch?: string; traceInput?: string; depth?: "overview" | "standard" | "deep";
    }>(c);
    return startJob(c, "lens", p, (l) => l.lens(p, { ...req, files: req.files ?? [] }));
  });
  api.post("/projects/:pid/lenses/:id/refresh", (c) => {
    const p = project(c);
    const id = c.req.param("id");
    if (!store.get(p.id, "lenses", id)) return fail(c, 404, "lens not found");
    return startJob(c, "lens", p, (l) => l.lens(p, { files: [], kind: "", refreshOf: id }));
  });
  api.get("/projects/:pid/lenses/:id/export", (c) => {
    const p = project(c);
    const l = store.get(p.id, "lenses", c.req.param("id"));
    if (!l) return fail(c, 404, "lens not found");
    return download(c, `${slug(l.title)}.md`, lensMarkdown(l, new Workspace(p)));
  });
  api.delete("/projects/:pid/lenses/:id", (c) => c.json({ ok: store.archive(project(c).id, "lenses", c.req.param("id")) }));

  // ---- quizzes ---------------------------------------------------------

  api.get("/projects/:pid/quizzes", (c) => c.json(store.list(project(c).id, "quizzes")));
  api.get("/projects/:pid/quizzes/:id", (c) => {
    const q = store.get(project(c).id, "quizzes", c.req.param("id"));
    return q ? c.json(q) : fail(c, 404, "quiz not found");
  });
  api.post("/projects/:pid/quizzes", async (c) => {
    const p = project(c);
    const req = await body<{ files?: string[]; diff?: DiffSpec; lensId?: string; count?: number; weak?: boolean }>(c);
    return startJob(c, "quiz", p, (l) => l.quiz(p, { ...req, files: req.files ?? [] }));
  });
  api.post("/projects/:pid/quizzes/:id/attempts", async (c) => {
    const p = project(c);
    const { answers } = await body<{ answers: Answer[] }>(c);
    const id = c.req.param("id");
    if (!store.get(p.id, "quizzes", id)) return fail(c, 404, "quiz not found");
    return startJob(c, "grade", p, (l) => l.grade(p, id, answers ?? []));
  });
  api.delete("/projects/:pid/quizzes/:id", (c) => c.json({ ok: store.archive(project(c).id, "quizzes", c.req.param("id")) }));
  api.get("/projects/:pid/quizzes/:id/export", (c) => {
    const p = project(c);
    const q = store.get(p.id, "quizzes", c.req.param("id"));
    if (!q) return fail(c, 404, "quiz not found");
    return download(c, `${slug(q.title)}.md`, quizMarkdown(q, new Workspace(p)));
  });

  // ---- practice --------------------------------------------------------

  api.get("/projects/:pid/practice", (c) => c.json(store.list(project(c).id, "practice")));
  api.get("/projects/:pid/practice/:id", (c) => {
    const x = store.get(project(c).id, "practice", c.req.param("id"));
    return x ? c.json(x) : fail(c, 404, "practice not found");
  });
  api.post("/projects/:pid/practice", async (c) => {
    const p = project(c);
    const req = await body<{ file: string; level: number }>(c);
    return startJob(c, "practice", p, (l) => l.practice(p, req));
  });
  api.put("/projects/:pid/practice/:id/attempt", async (c) => {
    const p = project(c);
    const { text } = await body<{ text: string }>(c);
    // Saving needs no model.
    return c.json(offline().saveAttempt(p, c.req.param("id"), text ?? ""));
  });
  api.post("/projects/:pid/practice/:id/review", (c) => {
    const p = project(c);
    const id = c.req.param("id");
    if (!store.get(p.id, "practice", id)) return fail(c, 404, "practice not found");
    return startJob(c, "review", p, (l) => l.review(p, id));
  });
  api.delete("/projects/:pid/practice/:id", (c) => c.json({ ok: store.archive(project(c).id, "practice", c.req.param("id")) }));

  // ---- progress --------------------------------------------------------

  api.get("/projects/:pid/progress", (c) => {
    const p = project(c);
    return c.json(offline().progress(p));
  });

  api.post("/projects/:pid/estimate", async (c) => {
    const { files } = await body<{ files?: string[] }>(c);
    return c.json(offline().estimate(project(c), files ?? []));
  });

  // ---- shared item routes ---------------------------------------------------

  /** GET list, GET one and DELETE (archive) for a collection. */
  const crud = (name: string, col: Collection, view: (x: never) => unknown = (x) => x) => {
    api.get(`/projects/:pid/${name}`, (c) => c.json(store.list(project(c).id, col).map((x) => view(x as never))));
    api.get(`/projects/:pid/${name}/:id`, (c) => {
      const x = store.get(project(c).id, col, c.req.param("id"));
      return x ? c.json(view(x as never)) : fail(c, 404, `${name} item not found`);
    });
    api.delete(`/projects/:pid/${name}/:id`, (c) => c.json({ ok: store.archive(project(c).id, col, c.req.param("id")) }));
  };

  // ---- cards -----------------------------------------------------------------

  const withPreview = (card: Card) => ({ ...card, next: previewCard(card) });
  api.get("/projects/:pid/cards/due", (c) => c.json(dueCards(store, project(c).id).map(withPreview)));
  crud("cards", "cards");
  api.post("/projects/:pid/cards", async (c) => {
    const p = project(c);
    const b = await body<Partial<Card>>(c);
    if (!b.front?.trim() || !b.back?.trim()) return fail(c, 400, "a card needs a front and a back");
    const ws = new Workspace(p);
    const file = b.file ? ws.guard(b.file) : undefined;
    const kind = b.kind === "concept" || b.kind === "miss" ? b.kind : "own";
    return c.json(store.put(p.id, "cards", makeCard(p.id, { kind, front: b.front.trim(), back: b.back.trim(), file, line: b.line, source: b.source })));
  });
  api.post("/projects/:pid/cards/:id/review", async (c) => {
    const p = project(c);
    const card = store.get(p.id, "cards", c.req.param("id"));
    if (!card) return fail(c, 404, "card not found");
    const { rating } = await body<{ rating: Rating }>(c);
    if (!["again", "hard", "good", "easy"].includes(rating)) return fail(c, 400, "rating must be again, hard, good or easy");
    return c.json(store.put(p.id, "cards", rateCard(card, rating)));
  });
  api.patch("/projects/:pid/cards/:id", async (c) => {
    const p = project(c);
    const card = store.get(p.id, "cards", c.req.param("id"));
    if (!card) return fail(c, 404, "card not found");
    const b = await body<Partial<Pick<Card, "front" | "back" | "suspended">>>(c);
    if (b.front?.trim()) card.front = b.front.trim().slice(0, 2000);
    if (b.back?.trim()) card.back = b.back.trim().slice(0, 4000);
    if (typeof b.suspended === "boolean") card.suspended = b.suspended;
    return c.json(store.put(p.id, "cards", card));
  });

  // ---- misconceptions ------------------------------------------------------------

  api.get("/projects/:pid/misconceptions", (c) => {
    const p = project(c);
    return c.json(c.req.query("all") ? store.list(p.id, "misconceptions") : openMisconceptions(store, p.id));
  });
  api.post("/projects/:pid/misconceptions/:id/resolve", (c) => {
    const p = project(c);
    const m = store.get(p.id, "misconceptions", c.req.param("id"));
    if (!m) return fail(c, 404, "not found");
    m.resolvedAt = new Date().toISOString();
    return c.json(store.put(p.id, "misconceptions", m));
  });
  api.delete("/projects/:pid/misconceptions/:id", (c) => c.json({ ok: store.archive(project(c).id, "misconceptions", c.req.param("id")) }));

  // ---- teach-back, tutor, walkthrough, bug hunt -------------------------------------

  crud("teachbacks", "teachbacks");
  api.post("/projects/:pid/teachbacks", async (c) => {
    const p = project(c);
    const req = await body<{ files?: string[]; text?: string }>(c);
    return startJob(c, "teachback", p, (l) => l.teachback(p, { files: req.files ?? [], text: req.text ?? "" }));
  });

  crud("threads", "threads");
  api.post("/projects/:pid/threads", async (c) => {
    const p = project(c);
    const req = await body<{ files?: string[]; text?: string }>(c);
    return startJob(c, "tutor", p, (l) => l.startThread(p, { files: req.files ?? [], text: req.text ?? "" }));
  });
  api.post("/projects/:pid/threads/:id/messages", async (c) => {
    const p = project(c);
    const id = c.req.param("id");
    if (!store.get(p.id, "threads", id)) return fail(c, 404, "thread not found");
    const req = await body<{ text?: string; tell?: boolean }>(c);
    return startJob(c, "tutor", p, (l) => l.tutorReply(p, id, req.text ?? "", !!req.tell));
  });

  crud("walks", "walks");
  api.post("/projects/:pid/walks", async (c) => {
    const p = project(c);
    const req = await body<{ file: string }>(c);
    return startJob(c, "walk", p, (l) => l.walk(p, req));
  });
  api.post("/projects/:pid/walks/:id/blocks/:i", async (c) => {
    const p = project(c);
    const id = c.req.param("id");
    if (!store.get(p.id, "walks", id)) return fail(c, 404, "walkthrough not found");
    const { answer } = await body<{ answer?: string }>(c);
    return startJob(c, "walkcheck", p, (l) => l.walkcheck(p, id, Number(c.req.param("i")), answer ?? ""));
  });

  /** The planted bugs stay hidden until the hunt is graded. */
  const huntView = (h: Hunt) => (h.grade ? h : { ...h, planted: h.planted.map(() => null) });
  crud("hunts", "hunts", huntView as (x: never) => unknown);
  api.post("/projects/:pid/hunts", async (c) => {
    const p = project(c);
    const req = await body<{ file: string; level: number }>(c);
    return startJob(c, "hunt", p, (l) => l.hunt(p, req));
  });
  api.put("/projects/:pid/hunts/:id/marks", async (c) => {
    const p = project(c);
    const { marks } = await body<{ marks?: { line: number; why: string }[] }>(c);
    return c.json(huntView(offline().saveMarks(p, c.req.param("id"), marks ?? [])));
  });
  api.post("/projects/:pid/hunts/:id/grade", (c) => {
    const p = project(c);
    const id = c.req.param("id");
    if (!store.get(p.id, "hunts", id)) return fail(c, 404, "bug hunt not found");
    return startJob(c, "huntgrade", p, (l) => l.huntgrade(p, id));
  });

  // ---- orientation ------------------------------------------------------------------

  api.get("/projects/:pid/graph", (c) => c.json(graphOf(project(c))));
  api.get("/projects/:pid/glossary", (c) => c.json(glossary(store, project(c).id)));

  const pathView = (x: LearningPath) => ({ ...x, done: pathDone(store, x) });
  crud("paths", "paths", pathView as (x: never) => unknown);
  api.post("/projects/:pid/paths", async (c) => {
    const p = project(c);
    const { goal } = await body<{ goal?: string }>(c);
    return startJob(c, "path", p, (l) => l.path(p, { goal, hubs: hubs(p) }));
  });
  api.patch("/projects/:pid/paths/:id", async (c) => {
    const p = project(c);
    const x = store.get(p.id, "paths", c.req.param("id"));
    if (!x) return fail(c, 404, "path not found");
    const b = await body<{ title?: string; stops?: PathStop[] }>(c);
    if (b.title?.trim()) x.title = b.title.trim().slice(0, 120);
    if (Array.isArray(b.stops)) {
      const ws = new Workspace(p);
      x.stops = b.stops.filter((s) => s && Array.isArray(s.files)).map((s) => ({ ...s, files: s.files.map((f) => ws.guard(f)) }));
    }
    return c.json(pathView(store.put(p.id, "paths", x)));
  });

  // ---- notes ------------------------------------------------------------------------

  api.get("/projects/:pid/notes", (c) => {
    const file = c.req.query("file");
    const list = store.list(project(c).id, "notes");
    return c.json(file ? list.filter((n) => n.file === file) : list);
  });
  api.post("/projects/:pid/notes", async (c) => {
    const p = project(c);
    const b = await body<Partial<Note>>(c);
    if (!b.text?.trim()) return fail(c, 400, "a note needs text");
    const note: Note = {
      id: newId(), projectId: p.id, createdAt: new Date().toISOString(), text: b.text.trim().slice(0, 8000),
      file: b.file ? new Workspace(p).guard(b.file) : undefined, line: b.line, lensId: b.lensId,
    };
    return c.json(store.put(p.id, "notes", note));
  });
  api.patch("/projects/:pid/notes/:id", async (c) => {
    const p = project(c);
    const n = store.get(p.id, "notes", c.req.param("id"));
    if (!n) return fail(c, 404, "note not found");
    const b = await body<{ text?: string }>(c);
    if (b.text?.trim()) n.text = b.text.trim().slice(0, 8000);
    return c.json(store.put(p.id, "notes", n));
  });
  api.delete("/projects/:pid/notes/:id", (c) => c.json({ ok: store.archive(project(c).id, "notes", c.req.param("id")) }));

  // ---- today and export ---------------------------------------------------------------

  api.get("/projects/:pid/today", (c) => {
    const p = project(c);
    return c.json(today(store, p, () => hubs(p)));
  });

  /** Everything groklab saved for this project, as one JSON file. */
  api.get("/projects/:pid/export", (c) => {
    const p = project(c);
    const all: Record<string, unknown> = { project: p, exportedAt: new Date().toISOString() };
    for (const col of ["lenses", "quizzes", "practice", "cards", "misconceptions", "teachbacks", "threads", "walks", "hunts", "paths", "notes"] as Collection[]) {
      all[col] = store.list(p.id, col);
    }
    return download(c, `groklab-${p.id}.json`, JSON.stringify(all, null, 2), "application/json");
  });

  return api;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "export";

function download(c: Context, name: string, text: string, type = "text/markdown; charset=utf-8") {
  return c.body(text, 200, { "content-type": type, "content-disposition": `attachment; filename="${name}"` });
}

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 503,
    message: string,
  ) {
    super(message);
  }
}
