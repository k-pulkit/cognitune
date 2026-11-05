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

export interface DiffSpec {
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
}

export interface Question {
  id: string;
  prompt: string;
  file?: string;
  line?: number;
  /** What the question tests, shown after grading. */
  focus: string;
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

export type JobKind = "lens" | "quiz" | "grade" | "practice" | "review";

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

export type FileLevel = "new" | "seen" | "understood" | "stale";

export interface FileProgress {
  path: string;
  level: FileLevel;
  lenses: number;
  quizzes: number;
  bestScore: number | null;
  practices: number;
}

export interface Settings {
  "agent.mode": "auto" | "claude" | "sdk" | "fake";
  "agent.model": string;
  "agent.claudeCommand": string;
  "agent.timeoutSec": number;
  "quiz.questions": number;
  "quiz.passMark": number;
  "context.maxBytes": number;
}

export interface AgentInfo {
  mode: string;
  name: string;
  ready: boolean;
  detail: string;
}
