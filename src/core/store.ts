import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, resolve } from "node:path";
import type {
  Card, Hunt, LearningPath, Lens, Misconception, Note, Practice, Project, Quiz, Settings, Teachback, Thread, Walk,
} from "./types.js";

/**
 * Everything groklab writes lives under one home folder (default ~/.groklab).
 * The user's code folders are never written.
 *
 *   settings.json
 *   projects.json
 *   projects/<id>/lenses/<lid>.json
 *   projects/<id>/quizzes/<qid>.json
 *   projects/<id>/practice/<pid>.json
 *   projects/<id>/<cards|misconceptions|teachbacks|threads|walks|hunts|paths|notes>/<id>.json
 *   projects/<id>/archive/<collection>/<id>.json   (removed after storage.archiveDays)
 *   cache/<hash>.json                               (model replies, capped at storage.cacheMB)
 *   archive/projects/<id>/                          (forgotten projects, removed after storage.archiveDays)
 *
 * Why files and not SQLite: the data is small (a few KB per item), people can read and back it up,
 * and there is no native module to build. storage.ts keeps it bounded.
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
  "cards.fromMisses": true,
  "progress.fadeDays": 21,
  "notes.inPrompts": false,
  "storage.archiveDays": 30,
  "storage.cacheMB": 50,
  "storage.maxAttempts": 20,
};

interface Collections {
  lenses: Lens;
  quizzes: Quiz;
  practice: Practice;
  cards: Card;
  misconceptions: Misconception;
  teachbacks: Teachback;
  threads: Thread;
  walks: Walk;
  hunts: Hunt;
  paths: LearningPath;
  notes: Note;
}
export type Collection = keyof Collections;
export type ItemOf<C extends Collection> = Collections[C];
export const COLLECTIONS: Collection[] = [
  "lenses", "quizzes", "practice", "cards", "misconceptions", "teachbacks", "threads", "walks", "hunts", "paths", "notes",
];

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

  read<T>(path: string, fallback: T): T {
    if (!existsSync(path)) return fallback;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch {
      return fallback;
    }
  }

  /** Write to a temp file then rename, so a crash never leaves half a file. */
  write(path: string, data: unknown): void {
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
      // A folder forgotten not long ago gets its history back.
      const old = join(this.home, "archive", "projects", p.id);
      const live = join(this.home, "projects", p.id);
      if (existsSync(old) && !existsSync(live)) renameSync(old, live);
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

  /**
   * Forget the folder. Its data moves to archive/projects/ and is removed after
   * storage.archiveDays, so forgotten projects do not pile up. Opening the folder again
   * within that time brings the history back.
   */
  forgetProject(id: string): void {
    this.saveProjects(this.projects().filter((p) => p.id !== id));
    if (!/^[a-z0-9-]+$/.test(id)) return;
    const src = join(this.home, "projects", id);
    if (!existsSync(src)) return;
    const dst = join(this.home, "archive", "projects");
    mkdirSync(dst, { recursive: true });
    const target = join(dst, id);
    if (existsSync(target)) renameSync(target, `${target}-${Date.now()}`);
    renameSync(src, target);
    const now = new Date();
    utimesSync(target, now, now);
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
    const to = join(dst, `${id}.json`);
    renameSync(src, to);
    const now = new Date();
    utimesSync(to, now, now); // the keep time counts from the archive date
    return true;
  }
}
