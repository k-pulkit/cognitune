import { z } from "zod";

/**
 * The minimum shape each task's reply must have. Services still clean every field (cut lengths,
 * drop bad paths); these schemas only decide "usable or ask again". Loose on purpose: extra
 * fields pass, numbers may come as strings.
 */

const text = z.string();
const line = z.coerce.number().int().positive();
const verdict = z.enum(["right", "partial", "wrong"]);

export const SCHEMAS = {
  lens: z.object({
    title: text,
    tldr: text.min(10),
    summary: text,
    concepts: z.array(z.object({ term: text, explain: text })).optional(),
    intuition: text.optional(),
    deepDives: z.array(z.object({ title: text, body: text })).min(1),
  }),
  lensPlan: z.object({
    title: text,
    tldr: text.min(10),
    steps: z.array(z.object({ title: text })).min(1),
  }),
  lensIntro: z.object({ summary: text, intuition: text.optional() }),
  lensSteps: z.object({ steps: z.array(z.object({ body: text })).min(1) }),
  plan: z.object({ outline: text.min(10) }),
  lensSketch: z.object({ differences: z.array(text).min(1) }),
  lensTrace: z.object({
    trace: z.object({ input: text, steps: z.array(z.object({ note: text, state: z.record(z.unknown()).optional() })).min(1) }),
  }),
  quiz: z.object({ questions: z.array(z.object({ prompt: text })).min(1) }),
  grade: z.object({ grades: z.array(z.object({ qid: text, verdict })).min(1) }),
  practice: z.object({ holes: z.array(z.object({ startLine: line, endLine: line, intent: text })).min(1) }),
  review: z.object({ holes: z.array(z.object({ id: z.coerce.number(), verdict })) }),
  teachback: z.object({ score: z.coerce.number().min(1).max(5), right: z.array(text), missing: z.array(text), wrong: z.array(text) }),
  tutor: z.object({ reply: text.min(1) }),
  walk: z.object({ blocks: z.array(z.object({ startLine: line, endLine: line, question: text })).min(2) }),
  walkPlan: z.object({ blocks: z.array(z.object({ startLine: line, endLine: line, title: text })).min(2) }),
  walkBlocks: z.object({ blocks: z.array(z.object({ question: text })).min(1) }),
  walkcheck: z.object({ verdict, feedback: text }),
  hunt: z.object({ bugs: z.array(z.object({ line, original: text, buggy: text, what: text })).min(1) }),
  huntgrade: z.object({ found: z.array(z.object({ line })), falseAlarms: z.array(z.object({ line })) }),
  path: z.object({ title: text, stops: z.array(z.object({ title: text, files: z.array(text).min(1), why: text })).min(2) }),
} satisfies Record<string, z.ZodTypeAny>;

export type TaskName = keyof typeof SCHEMAS;

/** null when usable; else a short message to send back to the model. */
export function problems(task: TaskName, value: unknown): string | null {
  const r = SCHEMAS[task].safeParse(value);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 6)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}
