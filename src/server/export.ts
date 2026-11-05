import type { Lens, Quiz } from "../core/types.js";
import type { Workspace } from "../core/workspace.js";

/**
 * Markdown exports, in the same Concepts / Intuition / Deep dives shape as session explainers,
 * so a lens can go into a notes folder or a PR.
 */

export function lensMarkdown(l: Lens, ws: Workspace): string {
  const out: string[] = [`# ${l.title}`, "", `> ${l.question}`, "", `Covers: ${l.files.map((f) => ws.rel(f)).join(", ")}`, ""];
  if (l.summary) out.push(l.summary, "");
  if (l.sketch) {
    out.push("## Your take first", "", l.sketch, "");
    if (l.differences?.length) out.push("### Differences", "", ...l.differences.map((d) => `- ${d}`), "");
  }
  if (l.concepts.length) out.push("## Concepts", "", ...l.concepts.map((c) => `- **${c.term}**: ${c.explain}`), "");
  if (l.intuition) out.push("## Intuition", "", l.intuition, "");
  if (l.trace) {
    out.push("## Trace", "", `Input: \`${l.trace.input}\``, "", "| # | Line | State | Note |", "|---|---|---|---|");
    l.trace.steps.forEach((s, i) => {
      const state = Object.entries(s.state).map(([k, v]) => `${k}=${v}`).join(", ").replace(/\|/g, "\\|");
      out.push(`| ${i + 1} | ${s.file ? ws.rel(s.file) : ""}${s.line ? `:${s.line}` : ""} | ${state} | ${s.note.replace(/\|/g, "\\|")} |`);
    });
    out.push("");
  }
  if (l.deepDives.length) {
    out.push("## Deep dives", "");
    for (const d of l.deepDives) out.push(`### ${d.title}${d.file ? ` (${ws.rel(d.file)}${d.line ? `:${d.line}` : ""})` : ""}`, "", d.body, "");
  }
  return out.join("\n");
}

export function quizMarkdown(q: Quiz, ws: Workspace): string {
  const out: string[] = [`# ${q.title}`, "", `Covers: ${q.files.map((f) => ws.rel(f)).join(", ")}`, ""];
  const last = q.attempts[q.attempts.length - 1];
  if (last) out.push(`Result: ${Math.round(last.score * 100)}% on ${last.at.slice(0, 16).replace("T", " ")}`, "");
  q.questions.forEach((qq, i) => {
    out.push(`## Q${i + 1}. ${qq.prompt}`, "");
    const g = last?.grades.find((x) => x.qid === qq.id);
    const a = last?.answers.find((x) => x.qid === qq.id);
    if (a?.answer) out.push(`**Your answer** (${a.sure ? "sure" : "guess"}): ${a.answer}`, "");
    if (g) out.push(`**Verdict:** ${g.verdict}. ${g.feedback}`, "", `**A good answer:** ${g.modelAnswer}`, "");
  });
  return out.join("\n");
}
