import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { Hono, type Context } from "hono";
import { makeAgent, type Agent } from "../core/agent/index.js";
import { Jobs } from "../core/jobs.js";
import { LENS_KINDS } from "../core/prompts.js";
import { Learn } from "../core/services.js";
import type { Store } from "../core/store.js";
import type { AgentInfo, Answer, DiffSpec, JobKind, Project, Settings } from "../core/types.js";
import { browse, Workspace } from "../core/workspace.js";

/** JSON API under /api. The CLI mounts the built web app next to it. */
export function createApi(store: Store) {
  const api = new Hono();
  const jobs = new Jobs();
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
    const status = /outside the project|bad ref|not a file|pick at least/.test(msg) ? 400 : /ENOENT|not found/.test(msg) ? 404 : 500;
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
    const l = store.get(project(c).id, "lenses", c.req.param("id"));
    return l ? c.json(l) : fail(c, 404, "lens not found");
  });
  api.post("/projects/:pid/lenses", async (c) => {
    const p = project(c);
    const req = await body<{ files: string[]; kind: string; question?: string; diff?: DiffSpec }>(c);
    return startJob(c, "lens", p, (l) => l.lens(p, { ...req, files: req.files ?? [] }));
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
    const req = await body<{ files?: string[]; diff?: DiffSpec; lensId?: string; count?: number }>(c);
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
    const a = agent();
    // Saving needs no model; Learn only uses the agent for model calls.
    const learn = new Learn(store, a.agent ?? { name: "none", complete: async () => "" });
    return c.json(learn.saveAttempt(p, c.req.param("id"), text ?? ""));
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
    const learn = new Learn(store, { name: "none", complete: async () => "" });
    return c.json(learn.progress(p));
  });

  return api;
}

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 503,
    message: string,
  ) {
    super(message);
  }
}
