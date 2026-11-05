import type { LensKind } from "./types.js";

/**
 * Every prompt asks for one JSON object in a ```json fence. The first line of each system
 * prompt is `TASK: <name>` (the fake agent keys on it).
 */

export const LENS_KINDS: LensKind[] = [
  {
    id: "explain",
    label: "Explain",
    question: "What does this code do, and what do I need to know to read it?",
    blurb: "The tour: purpose, main pieces, how they connect.",
  },
  {
    id: "flow",
    label: "Data flow",
    question: "How does data move through this code, from input to output?",
    blurb: "Follow one value from where it enters to where it leaves.",
  },
  {
    id: "state",
    label: "State over time",
    question: "What state does this code keep, and how does it change step by step?",
    blurb: "What is stored, who changes it, in which order.",
  },
  {
    id: "failure",
    label: "Failure modes",
    question: "How can this code fail, and what happens when it does?",
    blurb: "Bad input, timeouts, partial writes, retries.",
  },
  {
    id: "contracts",
    label: "Contracts",
    question: "What does this code promise its callers, and what does it expect from what it calls?",
    blurb: "Inputs, outputs, invariants, the edges between parts.",
  },
  {
    id: "concepts",
    label: "Concepts",
    question: "Which ideas, APIs or patterns must I know to understand this code?",
    blurb: "The vocabulary first, with the line where each one shows up.",
  },
  {
    id: "change",
    label: "The change",
    question: "What changed, why might it have changed, and what could it break?",
    blurb: "Best with a diff: intent, risk, what to check.",
  },
  {
    id: "trace",
    label: "Trace a run",
    question: "Step through this code on a small input: which line runs, and what does each variable hold?",
    blurb: "A debugger without running: line by line, with the state.",
  },
  {
    id: "history",
    label: "History",
    question: "Why is this code the way it is? Explain it through its git history.",
    blurb: "What changed over time and why, from the commits.",
  },
];

const STYLE = `Write for a capable engineer who is new to this code. Plain, short sentences. Name real
files and line numbers from the input (the numbers before "|"). Never invent code that is not in the input.
Return ONLY one JSON object inside a single \`\`\`json fence. No text outside the fence.`;

export type LensDepth = "overview" | "standard" | "deep";

const DEPTH: Record<LensDepth, { steps: string; words: number; note: string }> = {
  overview: { steps: "3-4", words: 50, note: "The reader wants the big picture in 3 minutes. Skip details that do not change the mental model." },
  standard: { steps: "4-7", words: 80, note: "The reader wants to be able to change this code safely after reading." },
  deep: { steps: "6-10", words: 120, note: "The reader will own this code. Cover edge cases, ordering, failure paths and the reasons behind odd choices." },
};

function lensSystem0(depth: LensDepth = "standard"): string {
  const d = DEPTH[depth];
  return `TASK: lens
You build a "lens": a lesson that teaches code through ONE question, like a senior engineer walking a new
teammate through it at a whiteboard. ${d.note}

How to teach (this matters more than coverage):
- Lead with the mental model. "tldr" is the one idea that makes the rest make sense, in one sentence a newcomer
  can repeat. Answer the question directly; no hedging, no "this file is not X".
- Explain WHY, not WHAT. The reader can read the code; tell them what it is for, what would break without it,
  and why it is done this way rather than the obvious way. Never paraphrase a line ("line 12 sets x to y").
- Concrete over abstract: real values, a small example input, "if you change A, B happens".
- Define every term at first use, in plain words. Short sentences. No filler ("This is important because...").
- One idea per step. The step title is that idea as a CLAIM the reader learns ("Layer 1 only sees manifests, so
  code edits never bust it"), not a label ("Layer 1").
- Steps go in the order that builds understanding (entry point and data shapes first), not file order. Each
  step's "explain" connects to the step before.
- Each step points at a SHORT line range (3-25 lines) that shows the idea; the page shows those lines next to
  your text, so do not repeat the code.
- If you have file tools, you may open other files in the repo (callers, the types it uses, its tests) to explain
  how this code is used. Cite them with real paths. If you cannot see something, leave it out instead of
  guessing or saying you did not look.
Name real files and line numbers from the input (the numbers before "|"). Never invent code.
Return ONLY one JSON object inside a single \`\`\`json fence. No text outside the fence.

JSON shape:
{
  "title": "short title, max 8 words",
  "tldr": "ONE sentence: the mental model that answers the question",
  "whyItMatters": "1-2 sentences: what goes wrong for someone who does not know this",
  "summary": "2-4 sentences: the answer in plain words, expanding the tldr",
  "concepts": [{"term": "name", "explain": "1-2 plain sentences", "example": "a tiny concrete example or analogy", "file": "relative/path", "line": 12}],  // 2-6 items, only terms the reader needs first
  "intuition": "markdown: the core idea with toy data walked through as numbered steps, and/or a small mermaid diagram (\`\`\`mermaid fenced, max 12 nodes, flowchart or sequenceDiagram, short labels)",
  "deepDives": [{
    "title": "the idea of this step as a claim",
    "file": "relative/path", "startLine": 10, "endLine": 24, "line": 12,   // line = the single key line
    "body": "markdown, at most ${d.words} words: why this part exists and how it works; connect to the previous step",
    "pitfall": "optional: a mistake people make here, or what breaks if you change it",
    "check": {"q": "a short question the reader should now be able to answer", "a": "the answer, 1-2 sentences"}
  }],  // ${d.steps} items, in teaching order
  "gotchas": ["surprising behaviour, edge cases or traps, 1 sentence each, with the line"],   // 0-5 items
  "nextSteps": [{"file": "relative/path", "why": "what reading it next will teach"}]       // 1-3 items, files that exist
}`;
}

export interface LensExtras {
  diff?: string;
  /** The learner's own take, written before the lens. */
  sketch?: string;
  /** Trace lens: the input to step through (empty = pick one). */
  traceInput?: string;
  /** History lens: git log with patches. */
  history?: string;
  /** Refresh: what the old lens said, so the new one can say what changed. */
  previous?: string;
  notes?: string;
}

export function lensSystem(x: { sketch?: boolean; trace?: boolean; depth?: LensDepth } = {}): string {
  const extra = [
    x.sketch
      ? `  "differences": ["where the learner's take (SKETCH) is wrong, missing something, or right for the wrong reason; 1-2 sentences each, name the line"],  // 1-6 items; if the sketch is fully right say so in one item`
      : "",
    x.trace
      ? `  "trace": {"input": "the toy input used, one line", "steps": [{"file": "relative/path", "line": 12, "state": {"var": "value as short text"}, "note": "what happens, 1 sentence"}]}  // 5-40 steps in run order; state lists only variables in scope that matter`
      : "",
  ].filter(Boolean);
  const base = lensSystem0(x.depth);
  if (!extra.length) return base;
  const end = `"why": "what reading it next will teach"}]`;
  return base.replace(end, `${end},`).replace(/\n}$/, `\n${extra.join(",\n")}\n}`);
}

export function lensPrompt(question: string, files: string, x: LensExtras = {}): string {
  return `QUESTION: ${question}

${x.sketch ? `SKETCH (the learner's own take, written before reading your lesson):\n${x.sketch}\n\n` : ""}${
    x.traceInput !== undefined ? `TRACE INPUT: ${x.traceInput || "(pick a small, typical input that exercises the main path)"}\n\n` : ""
  }${x.previous ? `AN EARLIER LESSON ON THIS CODE SAID (the code has changed since; say what is different now):\n${x.previous}\n\n` : ""}${
    x.history ? `GIT HISTORY (newest first):\n${x.history}\n\n` : ""
  }${x.diff ? `THE CHANGE (unified diff):\n${x.diff}\n\n` : ""}${x.notes ? `THE LEARNER'S NOTES:\n${x.notes}\n\n` : ""}CODE:
${files}`;
}

export function quizSystem(n: number): string {
  return `TASK: quiz
You write a short quiz that checks real understanding of the given code, not recall of names.
Ask about behaviour, reasons, edge cases and consequences ("what happens when...", "why does... ",
"which line breaks first if..."). Each question must be answerable from the code shown, in 1-4 sentences.
Do not put the answer in the question. Mix easy and hard.
${STYLE}

JSON shape:
{
  "title": "short title",
  "questions": [{"prompt": "the question", "file": "relative/path", "line": 12, "focus": "what it tests, 3-6 words", "targets": "weak spot id, only if WEAK SPOTS are given"}]  // exactly ${n} items
}`;
}

export function quizPrompt(files: string, diff?: string, lensSummary?: string, weak?: { id: string; text: string }[]): string {
  const w = weak?.length
    ? `WEAK SPOTS: this learner got these wrong before. Write questions that probe exactly these gaps, in new words
and from a new angle (not the old question). Put the weak spot's id in "targets".
${weak.map((m) => `[${m.id}] ${m.text}`).join("\n")}\n\n`
    : "";
  return `${w}${lensSummary ? `The learner just read this lesson summary:\n${lensSummary}\n\n` : ""}${
    diff ? `THE CHANGE (unified diff):\n${diff}\n\n` : ""
  }CODE:
${files}`;
}

export function gradeSystem(): string {
  return `TASK: grade
You grade a learner's free-text answers about code. Be fair and lenient on wording: if the core idea is right,
it is "right"; if part is right, "partial"; a wrong conclusion is "wrong". Feedback: 1-3 sentences, name the
line that settles it. modelAnswer: the best short answer, 1-3 sentences.
misconception (only for partial or wrong): what the learner seems to BELIEVE that is not true, as one line in
the second person ("You think X, but Y"). Not the fact they missed; the wrong model in their head. Omit if the
answer is empty or just "I don't know".
${STYLE}

JSON shape:
{ "grades": [{"qid": "q1", "verdict": "right|partial|wrong", "feedback": "...", "modelAnswer": "...", "misconception": "..."}] }`;
}

export function gradePrompt(items: { qid: string; question: string; answer: string }[], files: string): string {
  const qa = items.map((i) => `[${i.qid}] Q: ${i.question}\nA: ${i.answer || "(no answer)"}`).join("\n\n");
  return `ANSWERS TO GRADE:\n${qa}\n\nCODE:\n${files}`;
}

export const LEVELS: Record<number, string> = {
  1: "1 hole: one short, central expression or condition (1-3 lines).",
  2: "2 holes: a key condition and a key computation (2-6 lines each).",
  3: "3 holes: the core logic of the main function(s) (3-12 lines each).",
  4: "3-4 holes: whole function bodies of the most important logic.",
};

export function practiceSystem(level: number): string {
  return `TASK: practice
You turn real code into a practice exercise: pick the lines that hold the key logic and mark them as holes the
learner must write back. Level: ${LEVELS[level]}
Rules: holes must not overlap; each hole is a range of whole lines (1-based, inclusive) from the numbers before "|";
never pick imports, boilerplate or logging; the rest of the file must give enough context to solve each hole.
intent: what the hole must do, without giving the code. hints: 2-3, from gentle to nearly the answer.
${STYLE}

JSON shape:
{ "holes": [{"startLine": 10, "endLine": 14, "intent": "...", "hints": ["...", "..."]}] }`;
}

export function reviewSystem(): string {
  return `TASK: review
You check a learner's attempt to fill holes in code. Compare each hole with the original. Judge behaviour,
not style: a different but correct solution is "right"; pseudo-code that has the right logic is "partial" or
"right". Feedback: 1-3 sentences per hole, say what differs and what it would break.
${STYLE}

JSON shape:
{ "summary": "1-2 sentences", "holes": [{"id": 1, "verdict": "right|partial|wrong", "feedback": "..."}] }`;
}

export function reviewPrompt(
  original: string,
  attempt: string,
  holes: { id: number; startLine: number; endLine: number; intent: string }[],
): string {
  const list = holes.map((h) => `hole ${h.id}: original lines ${h.startLine}-${h.endLine}; must: ${h.intent}`).join("\n");
  return `HOLES:\n${list}\n\nORIGINAL FILE:\n${original}\n\nLEARNER'S FILE (holes filled in):\n${attempt}`;
}

// ---- teach-back ----------------------------------------------------------

export function teachbackSystem(): string {
  return `TASK: teachback
The learner explains the given code in their own words, as if teaching a new teammate. Grade the explanation
against the code. Be fair on wording; judge the mental model.
right: claims that are correct and important. missing: important things a good explanation would have said.
wrong: claims that are false, each as "You say X, but Y (line N)". score: 1-5 (1 = mostly wrong or empty,
3 = right but shallow, 4 = right and covers the important parts, 5 = also the why and the edge cases).
${STYLE}

JSON shape:
{ "score": 4, "summary": "1-2 sentences", "right": ["..."], "missing": ["..."], "wrong": ["..."] }`;
}

export function teachbackPrompt(text: string, files: string): string {
  return `THE LEARNER'S EXPLANATION:\n${text}\n\nCODE:\n${files}`;
}

// ---- tutor ------------------------------------------------------------------

export function tutorSystem(level: number, tell: boolean): string {
  const how = tell
    ? "The learner asked you to tell them. Give the full answer now, clearly, with the lines that show it. Then ask one short question that checks they got it."
    : level <= 1
      ? "Do NOT give the answer. Reply with ONE guiding question or a pointer to where to look (a line or a name), so the learner can find it."
      : level === 2
        ? "Do NOT give the full answer yet. Give a concrete hint: name the mechanism or the line that matters and what to notice there. End with a question."
        : "The learner has tried twice. Walk through the answer step by step, but leave the last step for them, as a question.";
  return `TASK: tutor
You are a Socratic tutor for code. The learner is trying to understand the code below. Never lecture.
Keep replies short (2-6 sentences). Use the learner's own words back to them when they are close.
If the learner states something wrong, do not just correct it: ask a question that makes them test it against the code.
This turn: ${how}
Name real files and line numbers from the input. Never invent code.
Return ONLY one JSON object inside a single \`\`\`json fence.

JSON shape:
{ "reply": "markdown" }`;
}

export function tutorPrompt(history: { role: string; text: string }[], files: string, notes?: string): string {
  const h = history.map((m) => `${m.role === "user" ? "LEARNER" : "TUTOR"}: ${m.text}`).join("\n\n");
  return `CONVERSATION SO FAR:\n${h}\n\n${notes ? `THE LEARNER'S NOTES:\n${notes}\n\n` : ""}CODE:\n${files}`;
}

// ---- walkthrough --------------------------------------------------------------

export function walkSystem(): string {
  return `TASK: walk
Split the file into 4-10 blocks for a guided walkthrough, in READING order (the order that makes it easiest to
understand: entry point and data shapes first, helpers when they are first needed), not file order.
Each block is a range of whole lines (1-based, inclusive, from the numbers before "|"). Blocks may skip
boilerplate (imports, logging). why: why this block matters and how it connects to the previous one (1-2 sentences).
question: one check question about the block's behaviour or reason, answerable from the block in 1-2 sentences.
Do not put the answer in the question.
${STYLE}

JSON shape:
{ "blocks": [{"startLine": 10, "endLine": 30, "title": "short", "why": "...", "question": "..."}] }`;
}

export function walkcheckSystem(): string {
  return `TASK: walkcheck
Grade one answer to a check question about a block of code. Lenient on wording: core idea right = "right".
feedback: 1-2 sentences; if not right, say what the block really does and name the line.
misconception (only for partial or wrong): what the learner seems to believe that is not true, one line, "You think X, but Y".
${STYLE}

JSON shape:
{ "verdict": "right|partial|wrong", "feedback": "...", "misconception": "..." }`;
}

export function walkcheckPrompt(question: string, answer: string, block: string, file: string): string {
  return `QUESTION: ${question}\nANSWER: ${answer || "(no answer)"}\n\nTHE BLOCK:\n${block}\n\nWHOLE FILE FOR CONTEXT:\n${file}`;
}

// ---- bug hunt -----------------------------------------------------------------

export const HUNT_LEVELS: Record<number, string> = {
  1: "1 bug, fairly visible to a careful reader (wrong comparison, off-by-one, wrong variable).",
  2: "2 bugs: one visible, one that needs understanding of the logic (wrong default, swapped arguments, missing await, wrong boolean).",
  3: "2-3 subtle bugs that only show with real understanding (edge case, ordering, state not reset, wrong branch taken).",
};

export function huntSystem(level: number): string {
  return `TASK: hunt
Plant realistic bugs in the code for a debugging exercise. ${HUNT_LEVELS[level]}
Each bug changes exactly ONE line. "original" must be that line copied exactly from the input (without the
number and "|"). "buggy" is the full replacement line, same indent, still valid syntax, plausible as a real
mistake (no comments that give it away, no weird names). Pick lines in the core logic, not imports or logging.
"what": what the bug breaks, 1-2 sentences, for after the learner answers.
${STYLE}

JSON shape:
{ "bugs": [{"line": 12, "original": "exact line", "buggy": "changed line", "what": "..."}] }`;
}

export function huntgradeSystem(): string {
  return `TASK: huntgrade
A learner hunted for planted bugs. You get the planted bugs and the learner's marks (line + why).
For each FOUND bug (the learner marked that line or the one next to it), judge their reason: feedback says if the
reason is right and what the full effect is (1-2 sentences).
For each FALSE ALARM (a mark on a line with no bug), explain in 1-2 sentences why that line is fine.
${STYLE}

JSON shape:
{ "found": [{"line": 12, "feedback": "..."}], "falseAlarms": [{"line": 40, "feedback": "..."}] }`;
}

export function huntgradePrompt(
  bugs: { line: number; original: string; buggy: string; what: string }[],
  found: { line: number; why: string; bugLine: number }[],
  falseAlarms: { line: number; why: string }[],
  text: string,
): string {
  return `PLANTED BUGS:\n${bugs.map((b) => `line ${b.line}: was \`${b.original.trim()}\`, now \`${b.buggy.trim()}\` (${b.what})`).join("\n")}

FOUND (learner's mark -> bug line):\n${found.map((f) => `mark line ${f.line} -> bug line ${f.bugLine}: "${f.why}"`).join("\n") || "(none)"}

FALSE ALARMS:\n${falseAlarms.map((f) => `line ${f.line}: "${f.why}"`).join("\n") || "(none)"}

THE FILE WITH THE BUGS:\n${text}`;
}

// ---- learning path --------------------------------------------------------------

export function pathSystem(): string {
  return `TASK: path
Plan an onboarding path through this codebase for an engineer new to it: 6-12 stops, in the order to learn them.
Start where the reader gets the big picture (entry points, core data shapes), then the most depended-on modules,
then the interesting logic. Each stop: 1-4 files (relative paths EXACTLY as listed), why it comes now (1-2
sentences), and the activity that fits: "lens" (read an explanation), "walk" (guided walkthrough of one file),
"quiz" (check understanding), "teachback" (explain it yourself; good after 2-3 stops on one area).
${STYLE}

JSON shape:
{ "title": "short", "stops": [{"title": "short", "files": ["relative/path"], "why": "...", "activity": "lens|walk|quiz|teachback"}] }`;
}

export function pathPrompt(files: string[], hubs: string[], docs: string, goal?: string): string {
  return `${goal ? `THE LEARNER'S GOAL: ${goal}\n\n` : ""}MOST IMPORTED FILES (import graph, most first):\n${hubs.join("\n") || "(no import data)"}

ALL FILES:\n${files.join("\n")}

${docs ? `DOCS:\n${docs}` : ""}`;
}

/** Pull the JSON object out of a model reply: the last ```json fence, else the outermost braces. */
export function parseJson<T>(text: string): T {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  const candidates = fences.map((m) => m[1]).reverse();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c) as T;
    } catch {
      /* try the next one */
    }
  }
  throw new Error(`model reply had no valid JSON: ${text.slice(0, 300)}`);
}
