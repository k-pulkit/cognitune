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
];

const STYLE = `Write for a capable engineer who is new to this code. Plain, short sentences. Name real
files and line numbers from the input (the numbers before "|"). Never invent code that is not in the input.
Return ONLY one JSON object inside a single \`\`\`json fence. No text outside the fence.`;

export function lensSystem(): string {
  return `TASK: lens
You build a "lens": a short lesson that shows code through ONE question.
${STYLE}

JSON shape:
{
  "title": "short title, max 8 words",
  "summary": "2-3 sentences: the answer to the question in plain words",
  "concepts": [{"term": "name", "explain": "1-2 sentences"}],          // 2-6 items
  "intuition": "markdown: the core idea with toy data or a small mermaid diagram (\`\`\`mermaid fenced, max 12 nodes, flowchart or sequenceDiagram)",
  "deepDives": [{"title": "piece of code", "file": "relative/path", "line": 12, "body": "markdown, 3-8 sentences, in reading order"}]  // 3-7 items
}`;
}

export function lensPrompt(question: string, files: string, diff?: string): string {
  return `QUESTION: ${question}

${diff ? `THE CHANGE (unified diff):\n${diff}\n\n` : ""}CODE:
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
  "questions": [{"prompt": "the question", "file": "relative/path", "line": 12, "focus": "what it tests, 3-6 words"}]  // exactly ${n} items
}`;
}

export function quizPrompt(files: string, diff?: string, lensSummary?: string): string {
  return `${lensSummary ? `The learner just read this lesson summary:\n${lensSummary}\n\n` : ""}${
    diff ? `THE CHANGE (unified diff):\n${diff}\n\n` : ""
  }CODE:
${files}`;
}

export function gradeSystem(): string {
  return `TASK: grade
You grade a learner's free-text answers about code. Be fair and lenient on wording: if the core idea is right,
it is "right"; if part is right, "partial"; a wrong conclusion is "wrong". Feedback: 1-3 sentences, name the
line that settles it. modelAnswer: the best short answer, 1-3 sentences.
${STYLE}

JSON shape:
{ "grades": [{"qid": "q1", "verdict": "right|partial|wrong", "feedback": "...", "modelAnswer": "..."}] }`;
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
