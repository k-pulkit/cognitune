import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { join, sep } from "node:path";
import { COLLECTIONS, type Store } from "./store.js";
import type { StorageItem, StorageUsage } from "./types.js";

/**
 * Keeps ~/.groklab bounded. Everything that can grow without limit has a cap:
 *
 *   archive (deleted items, forgotten projects)  -> removed after storage.archiveDays
 *   model reply cache                            -> oldest first, down to storage.cacheMB
 *   quiz attempts                                -> storage.maxAttempts per quiz, best kept
 *   card review log, tutor messages, jobs        -> fixed caps where they are written
 *   *.tmp left by a crash mid-write              -> removed after an hour
 *
 * prune() runs at start-up and every 6 hours, and from Settings > Storage > Clean up now.
 * It only ever touches files inside the groklab home folder, never the user's folders.
 */

const DAY = 86_400_000;
export const CARD_REVIEW_CAP = 50;
export const THREAD_MESSAGE_CAP = 200;

interface Walked {
  bytes: number;
  files: number;
}

function walk(dir: string, each?: (path: string, size: number, mtime: number) => void): Walked {
  const out = { bytes: 0, files: 0 };
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const sub = walk(p, each);
      out.bytes += sub.bytes;
      out.files += sub.files;
    } else if (e.isFile()) {
      const st = statSync(p);
      out.bytes += st.size;
      out.files++;
      each?.(p, st.size, st.mtimeMs);
    }
  }
  return out;
}

export function usage(store: Store): StorageUsage {
  const home = store.home;
  const parts: StorageUsage["parts"] = [];
  const byName = new Map<string, Walked>();
  const add = (name: string, w: Walked) => {
    const cur = byName.get(name) ?? { bytes: 0, files: 0 };
    byName.set(name, { bytes: cur.bytes + w.bytes, files: cur.files + w.files });
  };
  const projects = join(home, "projects");
  if (existsSync(projects)) {
    for (const pid of readdirSync(projects)) {
      for (const c of [...COLLECTIONS, "archive"]) add(c, walk(join(projects, pid, c)));
    }
  }
  add("cache", walk(join(home, "cache")));
  add("forgotten projects", walk(join(home, "archive")));
  for (const [name, w] of byName) if (w.files) parts.push({ name, ...w });
  parts.sort((a, b) => b.bytes - a.bytes);
  const total = walk(home);
  return { home, totalBytes: total.bytes, parts, lastPrune: store.read(join(home, "prune.json"), null) };
}

/** Remove what the caps say must go. Returns how much was removed. */
export function prune(store: Store, now = Date.now()): { removed: number; freedBytes: number } {
  const s = store.settings();
  const home = store.home;
  let removed = 0;
  let freedBytes = 0;
  const drop = (path: string, size: number, dir = false) => {
    rmSync(path, { recursive: dir, force: true });
    removed++;
    freedBytes += size;
  };

  // Crash leftovers from the temp-file-then-rename write.
  walk(home, (p, size, mtime) => {
    if (p.endsWith(".tmp") && now - mtime > 3_600_000) drop(p, size);
  });

  // Archived items and forgotten projects past their keep time. A move keeps the old mtime,
  // so archive() touches the file when it moves it.
  const days = s["storage.archiveDays"];
  if (days > 0) {
    const cutoff = now - days * DAY;
    const projects = join(home, "projects");
    if (existsSync(projects)) {
      for (const pid of readdirSync(projects)) {
        walk(join(projects, pid, "archive"), (p, size, mtime) => mtime < cutoff && drop(p, size));
      }
    }
    const forgotten = join(home, "archive", "projects");
    if (existsSync(forgotten)) {
      for (const name of readdirSync(forgotten)) {
        const p = join(forgotten, name);
        if (statSync(p).mtimeMs < cutoff) drop(p, walk(p).bytes, true);
      }
    }
  }

  // Reply cache: least recently used first.
  const cap = Math.max(0, s["storage.cacheMB"]) * 1024 * 1024;
  const cached: { p: string; size: number; mtime: number }[] = [];
  const total = walk(join(home, "cache"), (p, size, mtime) => cached.push({ p, size, mtime })).bytes;
  let over = total - cap;
  for (const c of cached.sort((a, b) => a.mtime - b.mtime)) {
    if (over <= 0) break;
    drop(c.p, c.size);
    over -= c.size;
  }

  // Quiz attempts: keep the newest N, and always the best one.
  const maxAttempts = Math.max(1, s["storage.maxAttempts"]);
  for (const p of store.projects()) {
    for (const q of store.list(p.id, "quizzes")) {
      if (q.attempts.length <= maxAttempts) continue;
      const best = q.attempts.reduce((b, a) => (a.score > b.score ? a : b));
      const keep = q.attempts.slice(-maxAttempts);
      if (!keep.includes(best)) keep.splice(0, 1, best);
      removed += q.attempts.length - keep.length;
      q.attempts = keep.sort((a, b) => a.at.localeCompare(b.at));
      store.put(p.id, "quizzes", q);
    }
  }

  store.write(join(home, "prune.json"), { at: new Date(now).toISOString(), removed, freedBytes });
  return { removed, freedBytes };
}

/** Model reply cache keyed on everything that goes into the call. */
export class ReplyCache {
  private readonly dir: string;

  constructor(private readonly store: Store) {
    this.dir = join(store.home, "cache");
  }

  key(...parts: string[]): string {
    const h = createHash("sha256");
    for (const p of parts) h.update(p).update("\u0000");
    return h.digest("hex").slice(0, 32);
  }

  get(key: string): string | undefined {
    const p = join(this.dir, `${key}.json`);
    const hit = this.store.read<{ text: string } | null>(p, null);
    if (!hit) return undefined;
    const t = new Date();
    utimesSync(p, t, t); // mark as recently used for the LRU sweep
    return hit.text;
  }

  set(key: string, text: string): void {
    mkdirSync(this.dir, { recursive: true });
    this.store.write(join(this.dir, `${key}.json`), { text, at: new Date().toISOString() });
  }
}

// ---- pick and remove -------------------------------------------------------
// Settings > Storage lists single items so the user can tick some and remove only those.
// Ids are paths under the groklab home. remove() accepts only the shapes items() produces,
// so a crafted id can never reach anything else.

const SHAPES = [
  new RegExp(`^projects/[a-z0-9-]+/(archive/)?(${COLLECTIONS.join("|")})/[A-Za-z0-9_.-]+\\.json$`),
  /^cache\/[a-f0-9]+\.json$/,
  /^archive\/projects\/[A-Za-z0-9_.-]+$/,
];

function labelOf(v: unknown, fallback: string): string {
  const o = (v ?? {}) as Record<string, unknown>;
  for (const k of ["title", "question", "text", "front", "term", "name", "file"]) {
    if (typeof o[k] === "string" && o[k]) return (o[k] as string).replace(/\s+/g, " ").slice(0, 100);
  }
  return fallback;
}

export function items(store: Store): StorageItem[] {
  const out: StorageItem[] = [];
  const home = store.home;
  const projects = new Map(store.projects().map((p) => [p.id, p.name]));
  const addDir = (dir: string, group: string, project?: string) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const p = join(dir, f);
      const st = statSync(p);
      const rel = p.slice(home.length + 1).split(sep).join("/");
      out.push({ id: rel, group, project, label: labelOf(store.read(p, null), f), bytes: st.size, at: st.mtime.toISOString() });
    }
  };
  const root = join(home, "projects");
  if (existsSync(root)) {
    for (const pid of readdirSync(root)) {
      const name = projects.get(pid) ?? pid;
      for (const c of COLLECTIONS) {
        addDir(join(root, pid, c), c, name);
        addDir(join(root, pid, "archive", c), `archived ${c}`, name);
      }
    }
  }
  addDir(join(home, "cache"), "reply cache");
  const forgotten = join(home, "archive", "projects");
  if (existsSync(forgotten)) {
    for (const f of readdirSync(forgotten)) {
      const p = join(forgotten, f);
      const st = statSync(p);
      out.push({ id: `archive/projects/${f}`, group: "forgotten projects", label: f, bytes: walk(p).bytes, at: st.mtime.toISOString() });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export function remove(store: Store, ids: string[]): { removed: number; freedBytes: number } {
  let removed = 0;
  let freedBytes = 0;
  for (const id of ids) {
    if (id.includes("..") || !SHAPES.some((r) => r.test(id))) continue;
    const p = join(store.home, ...id.split("/"));
    if (!existsSync(p)) continue;
    const st = statSync(p);
    freedBytes += st.isDirectory() ? walk(p).bytes : st.size;
    rmSync(p, { recursive: st.isDirectory(), force: true });
    removed++;
  }
  return { removed, freedBytes };
}
