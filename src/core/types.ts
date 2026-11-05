/** Shared shapes between the server and the web app. Plain data only, no functions. */

export interface Project {
  id: string;
  name: string;
  /** Absolute path of the main folder. */
  root: string;
  /** Extra folders read as context (docs, notes, a session folder). Read-only, like the root. */
  contexts: string[];
  addedAt: string;
  openedAt: string;
}

export interface TreeNode {
  name: string;
  /** Absolute path. */
  path: string;
  kind: "file" | "dir";
  children?: TreeNode[];
}

export interface FileContent {
  path: string;
  rel: string;
  lang: string;
  text: string;
  hash: string;
  truncated: boolean;
}

export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  patch: string;
}

export interface GitRepo {
  /** Absolute path of the repo folder. */
  path: string;
  /** Path shown to the user (relative to the project). */
  name: string;
  branch: string;
}

export interface DiffSpec {
  /** Repo folder; empty or missing means the project root. */
  repo?: string;
  base: string;
  /** Empty string means the working tree. */
  head: string;
}

export interface LensKind {
  id: string;
  label: string;
  question: string;
  blurb: string;
}

export interface Concept {
  term: string;
  explain: string;
}

export interface DeepDive {
  title: string;
  file?: string;
  line?: number;
  body: string;
}

export interface Lens {
  id: string;
  projectId: string;
  createdAt: string;
  kind: string;
  question: string;
  files: string[];
  diff?: DiffSpec;
  title: string;
  summary: string;
  concepts: Concept[];
  /** Markdown; may hold one mermaid block. */
  intuition: string;
  deepDives: DeepDive[];
  /** File hash when the lens was made; a later change shows a "refresh" banner. */
  fileHashes?: Record<string, string>;
  /** The learner's own take before the lens (sketch first, or a prediction on a change). */
  sketch?: string;
  /** Where the lens disagrees with or adds to the sketch. */
  differences?: string[];
  /** Trace lens only: a step-by-step run on a toy input. */
  trace?: Trace;
}

export interface TraceStep {
  file?: string;
  line?: number;
  /** Variable name -> value as text, after this step. */
  state: Record<string, string>;
  note: string;
}

export interface Trace {
  input: string;
  steps: TraceStep[];
}

export interface Question {
  id: string;
  prompt: string;
  file?: string;
  line?: number;
  /** What the question tests, shown after grading. */
  focus: string;
  /** Weak-spot quizzes: the misconception this question probes. */
  misconceptionId?: string;
}

export interface Answer {
  qid: string;
  answer: string;
  sure: boolean;
}

export type Verdict = "right" | "partial" | "wrong";

export interface Grade {
  qid: string;
  verdict: Verdict;
  feedback: string;
  modelAnswer: string;
  /** Wrong / partial only: what the learner believes that is not so, in one line. */
  misconception?: string;
}

export interface Attempt {
  at: string;
  answers: Answer[];
  grades: Grade[];
  /** 0..1, partial counts half. */
  score: number;
}

export interface Quiz {
  id: string;
  projectId: string;
  createdAt: string;
  title: string;
  files: string[];
  /** File hash when the quiz was made; a later change makes a pass stale. */
  fileHashes: Record<string, string>;
  diff?: DiffSpec;
  lensId?: string;
  questions: Question[];
  attempts: Attempt[];
}

export interface Hole {
  id: number;
  /** 1-based, inclusive, lines of the original file. */
  startLine: number;
  endLine: number;
  intent: string;
  hints: string[];
}

export interface HoleReview {
  id: number;
  verdict: Verdict;
  feedback: string;
}

export interface Practice {
  id: string;
  projectId: string;
  createdAt: string;
  file: string;
  level: 1 | 2 | 3 | 4;
  original: string;
  holed: string;
  holes: Hole[];
  attempt: string;
  review?: { at: string; holes: HoleReview[]; summary: string };
}

export type JobKind =
  | "lens" | "quiz" | "grade" | "practice" | "review"
  | "teachback" | "tutor" | "walk" | "walkcheck" | "hunt" | "huntgrade" | "path";

export interface Job {
  id: string;
  kind: JobKind;
  projectId: string;
  status: "running" | "done" | "failed";
  error?: string;
  /** Id of the lens / quiz / practice the job made or updated. */
  resultId?: string;
  startedAt: string;
  endedAt?: string;
}

/**
 * understood: passed a check and the file has not changed since; fading: understood, but no
 * retrieval for a while; stale: passed, then the file changed; seen: touched, never passed.
 */
export type FileLevel = "new" | "seen" | "understood" | "fading" | "stale";

export interface FileProgress {
  path: string;
  level: FileLevel;
  lenses: number;
  quizzes: number;
  bestScore: number | null;
  practices: number;
  /** Teach-backs, walkthroughs and bug hunts on the file. */
  other: number;
  /** Last time you recalled something about the file (quiz, card, teach-back, walk, hunt). */
  lastRetrieval: string | null;
}

export interface Settings {
  "agent.mode": "auto" | "claude" | "codex" | "copilot" | "sdk" | "fake";
  "agent.model": string;
  "agent.claudeCommand": string;
  "agent.codexCommand": string;
  /** Empty = the CLI's own default model. */
  "agent.codexModel": string;
  "agent.copilotCommand": string;
  "agent.copilotModel": string;
  "agent.timeoutSec": number;
  "quiz.questions": number;
  "quiz.passMark": number;
  "context.maxBytes": number;
  /** Turn each wrong or partial quiz answer into a review card. */
  "cards.fromMisses": boolean;
  /** Days without recall before "understood" becomes "fading". */
  "progress.fadeDays": number;
  /** Send your margin notes with the code in prompts. */
  "notes.inPrompts": boolean;
  /** Days an archived item is kept before it is removed for good. 0 = keep forever. */
  "storage.archiveDays": number;
  /** Most megabytes for the model reply cache; oldest entries go first. */
  "storage.cacheMB": number;
  /** Most graded attempts kept per quiz (the best one is always kept). */
  "storage.maxAttempts": number;
}

export interface AgentInfo {
  mode: string;
  name: string;
  ready: boolean;
  detail: string;
  /** Which providers were found on this machine. */
  available: Record<string, boolean>;
}

// ---- review cards ------------------------------------------------------

export type Rating = "again" | "hard" | "good" | "easy";

/** FSRS scheduler state, dates as ISO strings. */
export interface CardState {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: string;
}

export interface Card {
  id: string;
  projectId: string;
  createdAt: string;
  kind: "miss" | "concept" | "own";
  front: string;
  back: string;
  file?: string;
  line?: number;
  source?: { quizId?: string; lensId?: string; qid?: string };
  fsrs: CardState;
  /** Last reviews, newest last (capped). */
  reviews: { at: string; rating: Rating }[];
  suspended?: boolean;
}

export interface Misconception {
  id: string;
  projectId: string;
  createdAt: string;
  text: string;
  file?: string;
  line?: number;
  /** Where it came from: "quiz", "teachback", "walk", "hunt". */
  from: string;
  sourceId: string;
  /** How many times it showed up again. */
  seen: number;
  resolvedAt?: string;
}

// ---- produce-first activities ------------------------------------------

export interface Teachback {
  id: string;
  projectId: string;
  createdAt: string;
  files: string[];
  fileHashes: Record<string, string>;
  text: string;
  grade?: { score: number; right: string[]; missing: string[]; wrong: string[]; summary: string };
}

export interface ChatMessage {
  role: "user" | "tutor";
  text: string;
  at: string;
  /** Tutor turns: 1 nudge, 2 hint, 3 worked answer. */
  hintLevel?: number;
}

export interface Thread {
  id: string;
  projectId: string;
  createdAt: string;
  title: string;
  files: string[];
  messages: ChatMessage[];
}

export interface WalkBlock {
  startLine: number;
  endLine: number;
  title: string;
  why: string;
  question: string;
  answer?: string;
  verdict?: Verdict;
  feedback?: string;
}

export interface Walk {
  id: string;
  projectId: string;
  createdAt: string;
  file: string;
  fileHash: string;
  blocks: WalkBlock[];
}

export interface PlantedBug {
  line: number;
  original: string;
  buggy: string;
  what: string;
}

export interface HuntMark {
  line: number;
  why: string;
}

export interface Hunt {
  id: string;
  projectId: string;
  createdAt: string;
  file: string;
  fileHash: string;
  level: 1 | 2 | 3;
  /** The file with the bugs in it (a copy; your folder is never touched). */
  text: string;
  /** Hidden from the page until graded. */
  planted: PlantedBug[];
  marks: HuntMark[];
  grade?: {
    at: string;
    found: { line: number; what: string; feedback: string }[];
    missed: { line: number; what: string }[];
    falseAlarms: { line: number; feedback: string }[];
    score: number;
  };
}

// ---- orientation ---------------------------------------------------------

export interface GraphNode {
  path: string;
  /** How many files import this one. */
  fanIn: number;
  fanOut: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: { from: string; to: string }[];
}

export type StopActivity = "lens" | "walk" | "quiz" | "teachback";

export interface PathStop {
  title: string;
  files: string[];
  why: string;
  activity: StopActivity;
}

export interface LearningPath {
  id: string;
  projectId: string;
  createdAt: string;
  title: string;
  stops: PathStop[];
}

export interface GlossaryTerm {
  term: string;
  explains: { text: string; lensId: string; lensTitle: string }[];
  files: string[];
}

export interface Note {
  id: string;
  projectId: string;
  createdAt: string;
  file?: string;
  line?: number;
  lensId?: string;
  text: string;
}

export interface Today {
  due: number;
  newCards: number;
  weak: Misconception[];
  attention: FileProgress[];
  nextStop: { pathId: string; title: string; index: number; stop: PathStop } | null;
  streak: number;
  suggestion: { text: string; files: string[]; activity: string } | null;
}

export interface StorageUsage {
  home: string;
  totalBytes: number;
  parts: { name: string; bytes: number; files: number }[];
  lastPrune: { at: string; removed: number; freedBytes: number } | null;
}
