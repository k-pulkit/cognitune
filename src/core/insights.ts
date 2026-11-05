import { createEmptyCard, fsrs, Rating as R, type Card as FsrsCard, type Grade as FsrsGrade } from "ts-fsrs";
import { newId, type Store } from "./store.js";
import { CARD_REVIEW_CAP } from "./storage.js";
import type {
  Card, CardState, FileLevel, FileProgress, GlossaryTerm, LearningPath, Misconception, Project, Rating, Today,
} from "./types.js";
import { hashText, Workspace } from "./workspace.js";

/**
 * Everything groklab works out from what is saved, without a model: review cards and their
 * schedule, misconceptions, per-file progress, the Today page, the glossary, path progress.
 */

const DAY = 86_400_000;
const scheduler = fsrs();
const RATINGS: Record<Rating, FsrsGrade> = { again: R.Again, hard: R.Hard, good: R.Good, easy: R.Easy };

// ---- cards -----------------------------------------------------------------

function toFsrs(s: CardState): FsrsCard {
  return { ...s, due: new Date(s.due), last_review: s.last_review ? new Date(s.last_review) : undefined } as FsrsCard;
}

function fromFsrs(c: FsrsCard): CardState {
  return {
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review?.toISOString(),
  };
}

export function newCardState(now = new Date()): CardState {
  return fromFsrs(createEmptyCard(now));
}

/** When the card would come back for each rating, for the buttons. */
export function previewCard(card: Card, now = new Date()): Record<Rating, string> {
  const p = scheduler.repeat(toFsrs(card.fsrs), now);
  return {
    again: p[R.Again].card.due.toISOString(),
    hard: p[R.Hard].card.due.toISOString(),
    good: p[R.Good].card.due.toISOString(),
    easy: p[R.Easy].card.due.toISOString(),
  };
}

export function rateCard(card: Card, rating: Rating, now = new Date()): Card {
  const next = scheduler.next(toFsrs(card.fsrs), now, RATINGS[rating]);
  card.fsrs = fromFsrs(next.card);
  card.reviews = [...card.reviews, { at: now.toISOString(), rating }].slice(-CARD_REVIEW_CAP);
  return card;
}

export function makeCard(projectId: string, c: Pick<Card, "kind" | "front" | "back"> & Partial<Card>): Card {
  return {
    id: newId(),
    projectId,
    createdAt: new Date().toISOString(),
    kind: c.kind,
    front: c.front.slice(0, 2000),
    back: c.back.slice(0, 4000),
    file: c.file,
    line: c.line,
    source: c.source,
    fsrs: newCardState(),
    reviews: [],
  };
}

export function dueCards(store: Store, projectId: string, now = new Date()): Card[] {
  return store
    .list(projectId, "cards")
    .filter((c) => !c.suspended && Date.parse(c.fsrs.due) <= now.getTime())
    .sort((a, b) => a.fsrs.due.localeCompare(b.fsrs.due));
}

// ---- misconceptions -----------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Save a misconception, or bump the count of one with the same text. */
export function recordMisconception(
  store: Store,
  projectId: string,
  m: { text: string; file?: string; line?: number; from: string; sourceId: string },
): Misconception | null {
  const text = m.text.trim().slice(0, 500);
  if (text.length < 8) return null;
  const all = store.list(projectId, "misconceptions");
  const same = all.find((x) => !x.resolvedAt && (x.sourceId === m.sourceId || norm(x.text) === norm(text)));
  if (same) {
    same.seen++;
    same.text = text;
    return store.put(projectId, "misconceptions", same);
  }
  return store.put(projectId, "misconceptions", {
    id: newId(), projectId, createdAt: new Date().toISOString(), text, file: m.file, line: m.line, from: m.from, sourceId: m.sourceId, seen: 1,
  });
}

export function resolveMisconception(store: Store, projectId: string, pick: (m: Misconception) => boolean): number {
  let n = 0;
  for (const m of store.list(projectId, "misconceptions")) {
    if (m.resolvedAt || !pick(m)) continue;
    m.resolvedAt = new Date().toISOString();
    store.put(projectId, "misconceptions", m);
    n++;
  }
  return n;
}

export function openMisconceptions(store: Store, projectId: string): Misconception[] {
  return store
    .list(projectId, "misconceptions")
    .filter((m) => !m.resolvedAt)
    .sort((a, b) => b.seen - a.seen || b.createdAt.localeCompare(a.createdAt));
}

// ---- progress -------------------------------------------------------------------

interface Signal {
  file: string;
  at: string;
  /** A check passed (counts towards understood). */
  pass: boolean;
  /** Recall happened (resets fading). */
  recall: boolean;
  /** File hash the check was made on. */
  hash?: string;
  kind: "lens" | "quiz" | "practice" | "other" | "card";
  score?: number;
}

/** One list of evidence per file, from every kind of activity. */
function signals(store: Store, project: Project, passMark: number): Signal[] {
  const out: Signal[] = [];
  const pid = project.id;
  for (const l of store.list(pid, "lenses")) for (const f of l.files) out.push({ file: f, at: l.createdAt, pass: false, recall: false, kind: "lens" });
  for (const q of store.list(pid, "quizzes")) {
    for (const f of q.files) {
      if (!q.attempts.length) out.push({ file: f, at: q.createdAt, pass: false, recall: false, kind: "quiz" });
      for (const a of q.attempts) out.push({ file: f, at: a.at, pass: a.score >= passMark, recall: true, hash: q.fileHashes[f], kind: "quiz", score: a.score });
    }
  }
  for (const p of store.list(pid, "practice")) {
    const allRight = !!p.review && p.review.holes.every((h) => h.verdict === "right");
    out.push({ file: p.file, at: p.review?.at ?? p.createdAt, pass: allRight, recall: !!p.review, hash: hashText(p.original), kind: "practice" });
  }
  for (const t of store.list(pid, "teachbacks")) {
    if (!t.grade) continue;
    for (const f of t.files) out.push({ file: f, at: t.createdAt, pass: t.grade.score >= 4, recall: true, hash: t.fileHashes[f], kind: "other" });
  }
  for (const w of store.list(pid, "walks")) {
    const answered = w.blocks.filter((b) => b.verdict);
    if (!answered.length) {
      out.push({ file: w.file, at: w.createdAt, pass: false, recall: false, kind: "other" });
      continue;
    }
    const pts = answered.reduce((s, b) => s + (b.verdict === "right" ? 1 : b.verdict === "partial" ? 0.5 : 0), 0);
    const done = answered.length === w.blocks.length;
    out.push({ file: w.file, at: w.createdAt, pass: done && pts / w.blocks.length >= passMark, recall: true, hash: w.fileHash, kind: "other" });
  }
  for (const h of store.list(pid, "hunts")) {
    if (!h.grade) out.push({ file: h.file, at: h.createdAt, pass: false, recall: false, kind: "other" });
    else out.push({ file: h.file, at: h.grade.at, pass: h.grade.score >= passMark, recall: true, hash: h.fileHash, kind: "other" });
  }
  for (const c of store.list(pid, "cards")) {
    const last = c.reviews[c.reviews.length - 1];
    if (c.file && last) out.push({ file: c.file, at: last.at, pass: false, recall: true, kind: "card" });
  }
  return out;
}

/**
 * Per file: understood = a check passed on the current version of the file; fading = understood,
 * but no recall for progress.fadeDays; stale = it passed, then the file changed; seen = touched.
 */
export function progress(store: Store, project: Project, now = Date.now()): FileProgress[] {
  const s = store.settings();
  const ws = new Workspace(project);
  const map = new Map<string, FileProgress & { fresh: boolean; passed: boolean }>();
  const hashes = new Map<string, string | null>();
  const hashOf = (f: string) => {
    if (!hashes.has(f)) hashes.set(f, ws.hash(f));
    return hashes.get(f);
  };
  for (const sig of signals(store, project, s["quiz.passMark"])) {
    let fp = map.get(sig.file);
    if (!fp) {
      fp = { path: sig.file, level: "new", lenses: 0, quizzes: 0, bestScore: null, practices: 0, other: 0, lastRetrieval: null, fresh: false, passed: false };
      map.set(sig.file, fp);
    }
    if (sig.kind === "lens") fp.lenses++;
    if (sig.kind === "practice") fp.practices++;
    if (sig.kind === "other") fp.other++;
    if (sig.kind === "quiz" && sig.score !== undefined) fp.bestScore = Math.max(fp.bestScore ?? 0, sig.score);
    if (sig.recall && (!fp.lastRetrieval || sig.at > fp.lastRetrieval)) fp.lastRetrieval = sig.at;
    if (sig.pass) {
      fp.passed = true;
      if (sig.hash && sig.hash === hashOf(sig.file)) fp.fresh = true;
    }
  }
  // Quizzes counted per quiz, not per attempt.
  for (const q of store.list(project.id, "quizzes")) for (const f of q.files) {
    const fp = map.get(f);
    if (fp) fp.quizzes++;
  }
  const fadeMs = s["progress.fadeDays"] * DAY;
  const out: FileProgress[] = [];
  for (const { fresh, passed, ...fp } of map.values()) {
    let level: FileLevel = "seen";
    if (fresh) level = fadeMs > 0 && fp.lastRetrieval && now - Date.parse(fp.lastRetrieval) > fadeMs ? "fading" : "understood";
    else if (passed) level = "stale";
    out.push({ ...fp, level });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// ---- paths ----------------------------------------------------------------------

/** A stop is done when its activity was done on its files after the path was made. */
export function pathDone(store: Store, path: LearningPath): boolean[] {
  const pid = path.projectId;
  const since = path.createdAt;
  const passMark = store.settings()["quiz.passMark"];
  const covers = (have: string[], want: string[]) => want.every((f) => have.includes(f));
  const lenses = store.list(pid, "lenses").filter((l) => l.createdAt >= since);
  const quizzes = store.list(pid, "quizzes").filter((q) => q.createdAt >= since);
  const walks = store.list(pid, "walks").filter((w) => w.createdAt >= since);
  const teach = store.list(pid, "teachbacks").filter((t) => t.createdAt >= since);
  return path.stops.map((st) => {
    switch (st.activity) {
      case "lens":
        return lenses.some((l) => covers(l.files, st.files));
      case "walk":
        return walks.some((w) => st.files.includes(w.file) && w.blocks.every((b) => b.verdict));
      case "quiz":
        return quizzes.some((q) => covers(q.files, st.files) && q.attempts.some((a) => a.score >= passMark));
      case "teachback":
        return teach.some((t) => covers(t.files, st.files) && (t.grade?.score ?? 0) >= 3);
      default:
        return false;
    }
  });
}

// ---- glossary ---------------------------------------------------------------------

/** Every lens concept, merged by term. */
export function glossary(store: Store, projectId: string): GlossaryTerm[] {
  const map = new Map<string, GlossaryTerm>();
  for (const l of store.list(projectId, "lenses")) {
    for (const c of l.concepts) {
      const key = norm(c.term);
      if (!key) continue;
      let t = map.get(key);
      if (!t) map.set(key, (t = { term: c.term, explains: [], files: [] }));
      if (!t.explains.some((e) => norm(e.text) === norm(c.explain))) t.explains.push({ text: c.explain, lensId: l.id, lensTitle: l.title });
      for (const f of l.files) if (!t.files.includes(f)) t.files.push(f);
    }
  }
  return [...map.values()].sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" }));
}

// ---- today ---------------------------------------------------------------------------

const dayKey = (iso: string | number) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Days in a row with any learning activity, counting back from today (or yesterday). */
export function streak(store: Store, projectId: string, now = Date.now()): number {
  const days = new Set<string>();
  const add = (iso?: string) => iso && days.add(dayKey(iso));
  for (const l of store.list(projectId, "lenses")) add(l.createdAt);
  for (const q of store.list(projectId, "quizzes")) q.attempts.forEach((a) => add(a.at));
  for (const c of store.list(projectId, "cards")) c.reviews.forEach((r) => add(r.at));
  for (const t of store.list(projectId, "teachbacks")) add(t.createdAt);
  for (const w of store.list(projectId, "walks")) add(w.createdAt);
  for (const h of store.list(projectId, "hunts")) add(h.grade?.at);
  for (const p of store.list(projectId, "practice")) add(p.review?.at);
  let n = 0;
  let t = now;
  if (!days.has(dayKey(t))) t -= DAY; // today not done yet: the streak is still alive
  while (days.has(dayKey(t))) {
    n++;
    t -= DAY;
  }
  return n;
}

export function today(store: Store, project: Project, hubs: () => string[], now = new Date()): Today {
  const cards = store.list(project.id, "cards").filter((c) => !c.suspended);
  const due = cards.filter((c) => Date.parse(c.fsrs.due) <= now.getTime());
  const weak = openMisconceptions(store, project.id).slice(0, 5);
  const prog = progress(store, project, now.getTime());
  const attention = prog
    .filter((p) => p.level === "stale" || p.level === "fading")
    .sort((a, b) => (a.lastRetrieval ?? "").localeCompare(b.lastRetrieval ?? ""))
    .slice(0, 6);

  let nextStop: Today["nextStop"] = null;
  const path = store.list(project.id, "paths")[0];
  if (path) {
    const done = pathDone(store, path);
    const i = done.findIndex((d) => !d);
    if (i >= 0) nextStop = { pathId: path.id, title: path.title, index: i, stop: path.stops[i] };
  }

  let suggestion: Today["suggestion"] = null;
  if (due.length) suggestion = { text: `Review ${due.length} card${due.length === 1 ? "" : "s"} (about ${Math.max(1, Math.round(due.length / 3))} min).`, files: [], activity: "review" };
  else if (weak.length) suggestion = { text: "Quiz your weak spots: questions aimed at what you got wrong before.", files: [], activity: "weak" };
  else if (attention.length) suggestion = { text: `${attention[0].level === "stale" ? "The code changed since you passed" : "It has been a while since you recalled"} ${new Workspace(project).rel(attention[0].path)}. Quiz it again.`, files: [attention[0].path], activity: "quiz" };
  else if (nextStop) suggestion = { text: `Next stop on "${nextStop.title}": ${nextStop.stop.title}.`, files: nextStop.stop.files, activity: nextStop.stop.activity };
  else if (!prog.length) {
    const start = hubs()[0];
    if (start) suggestion = { text: `Start with the file most of the code depends on: ${new Workspace(project).rel(start)}. Read a lens, then quiz it.`, files: [start], activity: "lens" };
  }

  return {
    due: due.length,
    newCards: cards.filter((c) => c.fsrs.reps === 0).length,
    weak,
    attention,
    nextStop,
    streak: streak(store, project.id, now.getTime()),
    suggestion,
  };
}
