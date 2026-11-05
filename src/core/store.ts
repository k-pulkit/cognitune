import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, resolve } from "node:path";
import type { Lens, Practice, Project, Quiz, Settings } from "./types.js";

/**
 * Everything groklab writes lives under one home folder (default ~/.groklab).
 * The user's code folders are never written.
 *
 *   settings.json
 *   projects.json
 *   projects/<id>/lenses/<lid>.json
 *   projects/<id>/quizzes/<qid>.json
 *   projects/<id>/practice/<pid>.json
 */

export const DEFAULT_SETTINGS: Settings = {
  "agent.mode": "auto",
  "agent.model": "claude-sonnet-5-5",
  "agent.claudeCommand": "claude",
  "agent.codexCommand": "codex",
  "agent.codexModel": "",
  "agent.copilotCommand": "copilot",
  "agent.copilotModel": "",
  "agent.timeoutSec": 300,
  "quiz.questions": 4,
  "quiz.passMark": 0.67,
  "context.maxBytes": 160_000,
};

type Collection = "lenses" | "quizzes" | "practice";
type ItemOf<C extends Collection> = C extends "lenses" ? Lens : C extends "quizzes" ? Quiz : Practice;

export function newId(): string {
  return Date.now().toString(36) + randomBytes(3).toString("hex");
}

/** Project id is stable per folder, so re-opening a folder finds its history. */
export function projectIdFor(root: string): string {
  const slug = basename(root).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  return `${slug}-${createHash("sha1").update(root).digest("hex").slice(0, 6)}`;
}

export class Store {
  readonly home: string;

  constructor(home = process.env.GROKLAB_HOME || join(homedir(), ".groklab")) {
    this.home = resolve(home);
    mkdirSync(join(this.home, "projects"), { recursive: true });
  }

  // ---- low level -------------------------------------------------------

  private read<T>(path: string, fallback: T): T {
    if (!existsSync(path)) return fallback;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch {
      return fallback;
    }
  }

  /** Write to a temp file then rename, so a crash never leaves half a file. */
  private write(path: string, data: unknown): void {
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, path);
  }

  // ---- settings --------------------------------------------------------

  settings(): Settings {
    return { ...DEFAULT_SETTINGS, ...this.read<Partial<Settings>>(join(this.home, "settings.json"), {}) };
  }

  saveSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.settings() };
    for (const [k, v] of Object.entries(patch)) {
      if (k in DEFAULT_SETTINGS && v !== undefined && v !== null) (next as Record<string, unknown>)[k] = v;
    }
    this.write(join(this.home, "settings.json"), next);
    return next;
  }

  // ---- projects --------------------------------------------------------

  projects(): Project[] {
    return this.read<Project[]>(join(this.home, "projects.json"), []).sort((a, b) =>
      b.openedAt.localeCompare(a.openedAt),
    );
  }

  project(id: string): Project | undefined {
    return this.projects().find((p) => p.id === id);
  }

  private saveProjects(list: Project[]): void {
    this.write(join(this.home, "projects.json"), list);
  }

  /** Add a folder, or touch it if it is already known. */
  openProject(root: string, name?: string): Project {
    const abs = resolve(root);
    const list = this.projects();
    const now = new Date().toISOString();
    let p = list.find((x) => x.root === abs);
    if (p) {
      p.openedAt = now;
      if (name) p.name = name;
    } else {
      p = { id: projectIdFor(abs), name: name || basename(abs), root: abs, contexts: [], addedAt: now, openedAt: now };
      list.push(p);
    }
    this.saveProjects(list);
    return p;
  }

  updateProject(id: string, patch: Partial<Pick<Project, "name" | "contexts">>): Project | undefined {
    const list = this.projects();
    const p = list.find((x) => x.id === id);
    if (!p) return undefined;
    if (patch.name) p.name = patch.name;
    if (patch.contexts) p.contexts = [...new Set(patch.contexts.map((c) => resolve(c)))].filter((c) => c !== p.root);
    this.saveProjects(list);
    return p;
  }

  /** Forget the folder in the list. Its lenses and quizzes stay on disk. */
  forgetProject(id: string): void {
    this.saveProjects(this.projects().filter((p) => p.id !== id));
  }

  // ---- collections -----------------------------------------------------

  private dir(projectId: string, c: Collection): string {
    if (!/^[a-z0-9-]+$/.test(projectId)) throw new Error("bad project id");
    const d = join(this.home, "projects", projectId, c);
    mkdirSync(d, { recursive: true });
    return d;
  }

  list<C extends Collection>(projectId: string, c: C): ItemOf<C>[] {
    const d = this.dir(projectId, c);
    return readdirSync(d)
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.read<ItemOf<C> | null>(join(d, f), null))
      .filter((x): x is ItemOf<C> => x !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get<C extends Collection>(projectId: string, c: C, id: string): ItemOf<C> | undefined {
    if (!/^[a-z0-9]+$/.test(id)) return undefined;
    return this.read<ItemOf<C> | undefined>(join(this.dir(projectId, c), `${id}.json`), undefined);
  }

  put<C extends Collection>(projectId: string, c: C, item: ItemOf<C>): ItemOf<C> {
    this.write(join(this.dir(projectId, c), `${item.id}.json`), item);
    return item;
  }

  /** Move to an archive folder instead of erasing. */
  archive(projectId: string, c: Collection, id: string): boolean {
    if (!/^[a-z0-9]+$/.test(id)) return false;
    const src = join(this.dir(projectId, c), `${id}.json`);
    if (!existsSync(src)) return false;
    const dst = join(this.home, "projects", projectId, "archive", c);
    mkdirSync(dst, { recursive: true });
    renameSync(src, join(dst, `${id}.json`));
    return true;
  }
}
