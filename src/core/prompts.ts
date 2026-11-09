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

const DEPTH: Record<LensDepth, { steps: string; words: number; note: string; concepts: string; gotchas: string }> = {
  overview: {
    steps: "3-4", words: 60, concepts: "2-4", gotchas: "0-3",
    note: "The reader wants the big picture in 3 minutes. Skip details that do not change the mental model.",
  },
  standard: {
    steps: "5-8", words: 120, concepts: "3-6", gotchas: "2-5",
    note: "The reader wants to be able to change this code safely after reading. Give one concrete example with real values in the steps that carry logic.",
  },
  deep: {
    steps: "9-14", words: 260, concepts: "5-9", gotchas: "5-8",
    note: `The reader will own this code and debug it at 2am. This is a long, thorough lesson, not a summary:
- Every step is 2-4 paragraphs: (1) what it does and why it exists, (2) a worked example with concrete values
  from a small input ("if \`rows\` is [3, 0], then ..."), (3) the edge cases, ordering rules or failure path that
  touch this part, (4) why it was built this way instead of the obvious way, and what a change would break.
- Cover EVERY branch, early return, try/except, fallback and default in the files, not only the happy path. If the
  code has an "if this fails, do that" path, it gets its own step.
- Every step has a "pitfall" (a real mistake or a change that would break it) and a "check" question that needs
  reasoning, not recall ("what happens if X is empty?"), never "what does line 12 do?".
- "intuition" has BOTH a worked example with toy data walked through as numbered steps AND a mermaid diagram.
- "gotchas" lists real traps (ordering, mutation, silent fallbacks, error swallowing). "nextSteps" is required
  (2-3 real files that callers, types or tests live in) so the reader knows where to go after this.
- Prefer more steps over longer steps when an idea has two halves. Do not pad: every sentence must teach.`,
  },
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
- Write like a good engineering blog post: second person ("you"), short paragraphs of 2-3 sentences with a
  blank line between them, a bullet list when there are 3+ parallel items. Never one long block of text.
- Every field is markdown. Put identifiers, file names, functions, fields and values in \`backticks\`.
  Use **bold** at most once per field, for the one phrase that matters.
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
  "summary": "markdown, at most 3 short sentences: the answer in plain words, expanding the tldr. If there is more to say, it belongs in the steps",
  "concepts": [{"term": "name", "explain": "1-2 plain sentences", "example": "a tiny concrete example or analogy", "file": "relative/path", "line": 12}],  // ${d.concepts} items, only terms the reader needs first
  "intuition": "markdown: the core idea with toy data walked through as numbered steps, and/or a small mermaid diagram (\`\`\`mermaid fenced, max 12 nodes, flowchart or sequenceDiagram, short sentence-case labels, never ALL CAPS; prefer flowchart TD when it has more than 5 nodes)",
  "deepDives": [{
    "title": "the idea of this step as a claim",
    "file": "relative/path", "startLine": 10, "endLine": 24, "line": 12,   // line = the single key line
    "body": "markdown, up to ${d.words} words, in short paragraphs: why this part exists and how it works; connect to the previous step",
    "pitfall": "optional: a mistake people make here, or what breaks if you change it",
    "check": {"q": "a short question the reader should now be able to answer", "a": "the answer, 1-2 sentences"}
  }],  // ${d.steps} items, in teaching order
  "gotchas": ["surprising behaviour, edge cases or traps, 1 sentence each, with the line"],   // ${d.gotchas} items
  "nextSteps": [{"file": "relative/path", "why": "what reading it next will teach"}]       // 1-3 items, files that exist
}`;
}

// ---- staged lens: a planner outlines, a writer fills in the parts -----------------------------
// Size is set in SCREENS of the finished page, not in words. One screen is about 30 lines of
// prose; a step with its code card, pitfall and check is roughly a third to half a screen.

export const SCREENS: Record<LensDepth, { size: string; steps: string; paras: string; concepts: string; gotchas: string }> = {
  overview: { size: "about 1.5 screens", steps: "3-4", paras: "1-2 short paragraphs", concepts: "2-4", gotchas: "1-3" },
  standard: { size: "at least 3 screens", steps: "6-9", paras: "2-3 paragraphs", concepts: "4-6", gotchas: "3-5" },
  deep: { size: "5 to 6 screens, a long blog post", steps: "11-15", paras: "3-5 paragraphs", concepts: "5-9", gotchas: "5-8" },
};

const TEACH = `How to teach (this matters more than coverage):
- Lead with the mental model. Answer the question directly; no hedging.
- Explain WHY, not WHAT. The reader can read the code; tell them what it is for, what would break without it,
  and why it is done this way rather than the obvious way. Never paraphrase a line ("line 12 sets x to y").
- Concrete over abstract: real values, a small example input, "if you change A, B happens".
- Define every term at first use, in plain words. Short sentences. No filler.
- Write like a good engineering blog post: second person ("you"), short paragraphs of 2-3 sentences with a blank
  line between them, a bullet list when there are 3+ parallel items. Never one long block of text.
- Every field is markdown. Put identifiers, file names, functions, fields and values in \`backticks\`.
  Use **bold** at most once per field.
- Name real files and line numbers from the input (the numbers before "|"). Never invent code.`;

export function lensPlanSystem(x: { depth?: LensDepth; trace?: boolean } = {}): string {
  const d = SCREENS[x.depth ?? "standard"];
  return `TASK: lensPlan
You are the PLANNER of a "lens": a lesson that teaches code through ONE question. A second writer model will
write the prose from your plan, so the plan decides how good the lesson is. You do not write the prose.
Read all the code first. If you have file tools, open callers, the types it uses and its tests so the plan
covers how this code is really used.

Target size of the finished page: ${d.size}. Choose the number of steps for that size (${d.steps} steps).
Do not cut short: for a longer page, cover every branch, early return, fallback, error path and default, not only
the happy path, and give each its own step. Teach in the order that builds understanding (entry point and data
shapes first), not file order. Each step is ONE idea, titled as a CLAIM the reader learns ("Layer 1 only sees
manifests, so code edits never bust it"), not a label.

${TEACH}
${STYLE}

JSON shape:
{
  "title": "short title, max 8 words",
  "tldr": "ONE sentence: the mental model that answers the question",
  "whyItMatters": "1-2 sentences: what goes wrong for someone who does not know this",
  "reader": "who this is for and what they can do after reading, 1 sentence",
  "concepts": [{"term": "name", "note": "what to explain and the line it shows up at", "file": "relative/path", "line": 12}],  // ${d.concepts} terms the reader needs first
  "intuition": {"example": "a toy input with real values to walk through, and the numbered stages it goes through", "diagram": "what a mermaid diagram should show (flowchart TD or sequenceDiagram, max 12 nodes), or empty"},
  "steps": [{
    "title": "the idea as a claim",
    "file": "relative/path", "startLine": 10, "endLine": 24, "line": 12,   // a SHORT range (3-25 lines) that shows the idea
    "covers": ["each concrete fact, branch or rule this step must explain, in order"],
    "example": "concrete values to use in this step, or empty",
    "edge": "the edge case, ordering rule or failure path that touches this part, or empty",
    "why": "why it is built this way and what a change would break",
    "pitfall": "a real mistake or breaking change to warn about, or empty",
    "check": "an idea for a question that needs reasoning, not recall"
  }],
  "gotchas": ["a trap, 1 sentence, with the line"],   // ${d.gotchas}
  "nextSteps": [{"file": "relative/path", "why": "what reading it next will teach"}]   // 2-3 real files
}`;
}

export function lensIntroSystem(x: { depth?: LensDepth; sketch?: boolean; trace?: boolean } = {}): string {
  const d = SCREENS[x.depth ?? "standard"];
  const extra = [
    x.sketch ? `  "differences": ["where the learner's take (SKETCH) is wrong, missing something, or right for the wrong reason; 1-2 sentences each, name the line"],  // 1-6 items` : "",
    x.trace ? `  "trace": {"input": "the toy input used, one line", "steps": [{"file": "relative/path", "line": 12, "state": {"var": "value as short text"}, "note": "what happens, 1 sentence"}]},  // 5-40 steps in run order` : "",
  ].filter(Boolean).join("\n");
  return `TASK: lensIntro
You are the WRITER of the opening of a lens (a lesson on code). A planner already decided what the lesson says;
follow its PLAN and write the opening parts well. The steps are written separately, so do not write them.
The whole page will be ${d.size}; the opening sets it up, it does not try to say everything.

${TEACH}
${STYLE}

JSON shape:
{
${extra ? extra + "\n" : ""}  "summary": "markdown, at most 3 short sentences: the answer in plain words, expanding the tldr",
  "concepts": [{"term": "name", "explain": "1-2 plain sentences", "example": "a tiny concrete example or analogy", "file": "relative/path", "line": 12}],  // the planner's terms, ${d.concepts} items
  "intuition": "markdown: the core idea walked through with the planner's toy input as numbered stages${x.depth === "overview" ? "" : ", AND a mermaid diagram (```mermaid fenced, max 12 nodes, short sentence-case labels, flowchart TD when more than 5 nodes)"}",
  "gotchas": ["surprising behaviour or trap, 1 sentence each, with the line"],   // ${d.gotchas} items, from the plan
  "nextSteps": [{"file": "relative/path", "why": "what reading it next will teach"}]   // the planner's files that exist
}`;
}

export function lensStepsSystem(x: { depth?: LensDepth } = {}): string {
  const d = SCREENS[x.depth ?? "standard"];
  return `TASK: lensSteps
You are the WRITER of some steps of a lens (a lesson on code). A planner outlined every step; you write only the
steps you are asked for, in full, following the plan for each one: its "covers" list, "example", "edge" and "why".
Write each step's "body" as ${d.paras}. Take the space the idea needs; do not compress, and do not pad.
Use the example's real values, walk the edge case, and say why it is built this way. Connect each step to the one
before it (the earlier titles are given). The page shows the cited code lines next to your text, so do not repeat
the code; explain it.
"pitfall": one real mistake or breaking change, 1-3 sentences (omit if the plan has none).
"check": a short question that needs reasoning (what happens if X is empty? what breaks first if Y?), and "a", the
answer in 1-2 sentences.

${TEACH}
${STYLE}

JSON shape:
{ "steps": [{"index": 3, "body": "markdown", "pitfall": "...", "check": {"q": "...", "a": "..."}}] }   // one item per requested step, same "index" as in the plan (0-based)`;
}

export function lensWritePrompt(question: string, plan: unknown, files: string, x: { steps?: [number, number]; titles?: string[]; extras?: LensExtras } = {}): string {
  const e = x.extras;
  return `QUESTION: ${question}

${e?.sketch ? `SKETCH (the learner's own take, written before the lesson):\n${e.sketch}\n\n` : ""}${
    e?.traceInput !== undefined ? `TRACE INPUT: ${e.traceInput || "(pick a small, typical input that exercises the main path)"}\n\n` : ""
  }PLAN (from the planner; follow it):
${JSON.stringify(plan, null, 1)}

${x.steps ? `WRITE STEPS ${x.steps[0]}-${x.steps[1]} (0-based, both included).${x.titles?.length ? `\nEarlier steps, for continuity:\n${x.titles.map((t) => `- ${t}`).join("\n")}` : ""}\n\n` : ""}CODE:
${files}`;
}

/** Generic planner for the short generators (quiz, walk, practice, hunt, path). */
export function planSystem(writerSystem: string): string {
  const task = writerSystem.split("JSON shape:")[0].trim();
  return `TASK: plan
You are the PLANNER. A second model will do the task below and follows your outline, so make it specific.
Read the code (open related files if you can). Decide what the output must cover and in what order, which files
and line ranges matter, the common traps to include, and what to leave out. Do not write the final output.

THE TASK THE WRITER WILL DO:
${task}

${STYLE}

JSON shape:
{ "outline": "markdown, 6-20 lines: the plan, with real files and line numbers" }`;
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

export function practiceSystem(level: number, hasConcept = false, multi = false): string {
  return `TASK: practice
You turn real code into a practice exercise that trains ONE concept. ${hasConcept
    ? "The learner named the concept; cut the lines where the code applies it."
    : "Name the one concept the code is built around (the idea worth learning), then cut the lines where the code applies it."}
${multi ? "The concept usually shows up in several files (definition, use, wiring, test). Spread the holes over the files where it matters, and say in each intent how this hole fits the whole." : ""}
The holes are lines the learner must write back. Total size: ${LEVELS[level]}
Rules: holes must not overlap; each hole is a range of whole lines (1-based, inclusive) from the numbers before "|"
in ONE code file; set "file" to the path in that file's "=== FILE" header. CONTEXT FILES are read only.
Good holes: a branch with a decision, a loop that builds or filters something, a transformation, error handling
that changes the result, a guard that protects an invariant. Bad holes: imports, type declarations, constants and
tables, logging, plain getters, glue, comments, closing brackets.
Each hole must be solvable from the code around it: the learner sees the signature, the neighbouring lines and
the names, but not the cut lines. Do not cut a line whose meaning cannot be guessed from the rest.
intent: what the hole must do (inputs, outputs, edge cases) and what part of the concept it tests, without giving
the code; 2-4 sentences. hints: 2-3, from gentle (where to look) to nearly the answer.
concept: one sentence naming what this practice trains.
${STYLE}

JSON shape:
{ "concept": "...", "holes": [{"file": "src/a.ts", "startLine": 10, "endLine": 14, "intent": "...", "hints": ["...", "..."]}] }`;
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
  files: { rel: string; original: string; attempt: string; holes: { id: number; startLine: number; endLine: number; intent: string }[] }[],
): string {
  const list = files
    .flatMap((f) => f.holes.map((h) => `hole ${h.id}: file ${f.rel}, original lines ${h.startLine}-${h.endLine}; must: ${h.intent}`))
    .join("\n");
  const texts = files
    .map((f) => `=== ${f.rel} ===\nORIGINAL:\n${f.original}\n\nLEARNER'S VERSION (holes filled in):\n${f.attempt}`)
    .join("\n\n");
  return `HOLES:\n${list}\n\n${texts}`;
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

export function walkPlanSystem(): string {
  return `TASK: walkPlan
You are the PLANNER of a guided walkthrough of one file. A second writer model writes each block from your plan.
Read the whole file (and, if you have file tools, its callers and tests) and split it into 5-12 blocks in READING
order: entry point and data shapes first, helpers when they are first needed, not file order. A block is a range
of whole lines (1-based, inclusive, from the numbers before "|"), usually 5-30 lines, that holds ONE idea. Skip
boilerplate (imports, logging) unless it matters. Cover every branch, fallback and error path that matters.
For each block decide what the writer must teach and which concrete example will make it click: a call with real
values ("push(3) on an empty queue"), a small usage snippet, or a before/after. Plan a question that asks the
learner to PREDICT or REASON about a concrete case ("what does it return for ...? why?"), never one that asks
them to paraphrase the code.
${STYLE}

JSON shape:
{ "blocks": [{
  "startLine": 10, "endLine": 30, "title": "the idea as a short claim",
  "covers": ["each fact, branch or rule the block must explain, in order"],
  "example": "the concrete input and the result to walk through, or a small usage snippet to show",
  "question": "the question idea, about a concrete case"
}] }`;
}

export function walkBlocksSystem(): string {
  return `TASK: walkBlocks
You are the WRITER of some blocks of a guided code walkthrough. A planner outlined every block; write only the
blocks you are asked for, following the plan for each one. The page shows the block's own code above your text, so
do not repeat the code; explain it.
For each block write:
- "why": 1-2 sentences: why this block matters and how it connects to the previous one.
- "explain": markdown, 2-4 short paragraphs for a capable engineer who is new to this code: what it does, why it
  exists, why it is done this way, and what to notice. Identifiers in \`backticks\`. Second person.
- "example": markdown. A worked example with real values: the call or input, what happens step by step through the
  block, and the result. Include at least one fenced code block (a small usage snippet, a tiny table of values, or
  before/after). The snippet may be illustrative calling code, but it must match the real names and signatures.
- "question": one check question about a concrete case the learner must predict or reason about, answerable in 1-3
  sentences from the block and your text. Do not put the answer in the question.
${STYLE}

JSON shape:
{ "blocks": [{"index": 0, "why": "...", "explain": "...", "example": "...", "question": "..."}] }   // one item per requested block, same "index" as in the plan (0-based)`;
}

export function walkWritePrompt(plan: unknown, range: [number, number], titles: string[], files: string): string {
  return `PLAN (from the planner; follow it):
${JSON.stringify(plan, null, 1)}

WRITE BLOCKS ${range[0]}-${range[1]} (0-based, both included).${titles.length ? `\nEarlier blocks, for continuity:\n${titles.map((t) => `- ${t}`).join("\n")}` : ""}

CODE:
${files}`;
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
