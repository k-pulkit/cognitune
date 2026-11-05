import type { Lens, Quiz } from "../core/types.js";
import type { Workspace } from "../core/workspace.js";

/**
 * Markdown exports, in the same Concepts / Intuition / Deep dives shape as session explainers,
 * so a lens can go into a notes folder or a PR.
 */

export function lensMarkdown(l: Lens, ws: Workspace): string {
  const out: string[] = [`# ${l.title}`, "", `> ${l.question}`, "", `Covers: ${l.files.map((f) => ws.rel(f)).join(", ")}`, ""];
  if (l.tldr) out.push(`**TL;DR:** ${l.tldr}`, "");
  if (l.whyItMatters) out.push(`*Why it matters:* ${l.whyItMatters}`, "");
  if (l.summary) out.push(l.summary, "");
  if (l.sketch) {
    out.push("## Your take first", "", l.sketch, "");
    if (l.differences?.length) out.push("### Differences", "", ...l.differences.map((d) => `- ${d}`), "");
  }
  if (l.concepts.length) out.push("## Concepts", "", ...l.concepts.map((c) => `- **${c.term}**: ${c.explain}${c.example ? ` *Example:* ${c.example}` : ""}`), "");
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
    for (const d of l.deepDives) {
      const where = d.file ? ` (${ws.rel(d.file)}${d.startLine ? `:${d.startLine}-${d.endLine}` : d.line ? `:${d.line}` : ""})` : "";
      out.push(`### ${d.title}${where}`, "", d.body, "");
      if (d.pitfall) out.push(`> **Pitfall:** ${d.pitfall}`, "");
      if (d.check) out.push(`<details><summary>Check yourself: ${d.check.q}</summary>\n\n${d.check.a}\n</details>`, "");
    }
  }
  if (l.gotchas?.length) out.push("## Gotchas", "", ...l.gotchas.map((g) => `- ${g}`), "");
  if (l.nextSteps?.length) out.push("## Read next", "", ...l.nextSteps.map((n) => `- \`${ws.rel(n.file)}\`: ${n.why}`), "");
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
