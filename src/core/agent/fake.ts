import type { Agent, AgentRequest } from "./index.js";

/**
 * Canned replies, keyed on the `TASK:` line of the system prompt. Used by tests and by
 * `GROKLAB_AGENT=fake` to try the UI without a model. Uses the first file and line it sees.
 */
export class FakeAgent implements Agent {
  readonly name = "fake";

  async complete(req: AgentRequest): Promise<string> {
    const task = /^TASK: (\w+)/m.exec(req.system)?.[1] ?? "";
    const file = /=== FILE (\S+)/.exec(req.prompt)?.[1] ?? "file";
    if (process.env.GROKLAB_FAKE_FAIL === task) throw new Error(`fake failure for ${task}`);
    const delay = Number(process.env.GROKLAB_FAKE_DELAY_MS ?? 0);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return "```json\n" + JSON.stringify(this.reply(task, file, req.prompt, req.system), null, 2) + "\n```";
  }

  private reply(task: string, file: string, prompt: string, system: string): unknown {
    switch (task) {
      case "lens": {
        const sketch = /SKETCH/.test(prompt) ? { differences: ["Your sketch is close; you missed the error path at line 3."] } : {};
        const traceInput = /TRACE INPUT: (.*)/.exec(prompt)?.[1];
        const trace = /"trace":/.test(system)
          ? {
              trace: {
                input: traceInput && !traceInput.startsWith("(") ? traceInput : "n = 3",
                steps: [1, 2, 3].map((i) => ({ file, line: i, state: { n: String(3 - i + 1), total: String(i * 2) }, note: `Step ${i}: line ${i} runs.` })),
              },
            }
          : {};
        return {
          ...sketch,
          ...trace,
          tldr: `The one idea: ${file} turns input into output in a single pass.`,
          whyItMatters: "Without this model you will change the wrong line.",
          gotchas: ["Line 3 runs even when the input is empty."],
          nextSteps: [{ file, why: "Read it again with the steps in mind." }],
          title: `How ${file} works`,
          summary: `This is a fake lesson about ${file}. It shows the shape of a real one.`,
          concepts: [
            { term: "Entry point", explain: "Where the work starts.", example: "Like the front door of a house.", file, line: 1 },
            { term: "Side effect", explain: "A change outside the function, like a file write." },
          ],
          intuition: "Input flows to output:\n\n```mermaid\nflowchart LR\n  A[input] --> B[transform] --> C[output]\n```",
          deepDives: [
            { title: "The top of the file sets up what the rest needs", file, line: 1, startLine: 1, endLine: 4, body: "Imports and setup.", check: { q: "What does line 1 bring in?", a: "The types the rest uses." } },
            { title: "The main logic", file, line: 3, startLine: 3, endLine: 8, body: "Where the work happens.", pitfall: "Changing the order here breaks the output." },
          ],
        };
      }
      case "walkPlan":
        return { blocks: [1, 2].map((i) => ({ startLine: i, endLine: i + 2, title: `Block ${i} does one thing`, covers: ["a fact"], example: "n = 3", question: "what happens for n = 3?" })) };
      case "walkBlocks": {
        const m = /WRITE BLOCKS (\d+)-(\d+)/.exec(prompt);
        const [a, b] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
        return {
          blocks: Array.from({ length: b - a + 1 }, (_, k) => ({
            index: a + k, why: `Block ${a + k} follows the last one.`, explain: `Fake explanation for block ${a + k}.`,
            example: "With `n = 3`:\n\n```\nresult = f(3)  # 6\n```", question: `Fake question ${a + k}: what does f(3) give?`,
          })),
        };
      }
      case "plan":
        return { outline: "1. Start with the entry point.\n2. Cover the main branch.\n3. End with the error path." };
      case "lensPlan":
        return {
          title: `How ${file} works`,
          tldr: `The one idea: ${file} turns input into output in a single pass.`,
          whyItMatters: "Without this model you will change the wrong line.",
          concepts: [{ term: "Entry point", note: "Where the work starts.", file, line: 1 }],
          intuition: { example: "n = 3", diagram: "input to output" },
          steps: [1, 2, 3, 4].map((i) => ({
            title: `Step ${i} is one idea about ${file}`, file, startLine: i, endLine: i + 3, line: i,
            covers: [`Fact ${i}`], example: "n = 3", edge: "", why: "It keeps the output stable.", pitfall: "", check: "what if empty?",
          })),
          gotchas: ["Line 3 runs even when the input is empty."],
          nextSteps: [{ file, why: "Read it again with the steps in mind." }],
        };
      case "lensIntro": {
        const sketch = /SKETCH/.test(prompt) ? { differences: ["Your sketch is close; you missed the error path at line 3."] } : {};
        const traceInput = /TRACE INPUT: (.*)/.exec(prompt)?.[1];
        const trace = /"trace":/.test(system)
          ? { trace: { input: traceInput && !traceInput.startsWith("(") ? traceInput : "n = 3", steps: [1, 2, 3].map((i) => ({ file, line: i, state: { n: String(i) }, note: `Step ${i}: line ${i} runs.` })) } }
          : {};
        return {
          ...sketch, ...trace,
          summary: `This is a fake lesson about ${file}. It shows the shape of a real one.`,
          concepts: [
            { term: "Entry point", explain: "Where the work starts.", example: "Like the front door of a house.", file, line: 1 },
            { term: "Side effect", explain: "A change outside the function, like a file write." },
          ],
          intuition: "Input flows to output:\n\n```mermaid\nflowchart LR\n  A[input] --> B[transform] --> C[output]\n```",
          gotchas: ["Line 3 runs even when the input is empty."],
          nextSteps: [{ file, why: "Read it again with the steps in mind." }],
        };
      }
      case "lensSteps": {
        const m = /WRITE STEPS (\d+)-(\d+)/.exec(prompt);
        const [a, b] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
        return {
          steps: Array.from({ length: b - a + 1 }, (_, k) => ({
            index: a + k, body: `Fake body for step ${a + k}. It explains the idea with real values.`,
            pitfall: "Changing the order here breaks the output.", check: { q: `What does step ${a + k} do?`, a: "It does the thing." },
          })),
        };
      }
      case "quiz": {
        const n = Number(/exactly (\d+) items/.exec(system)?.[1] ?? 3);
        const weak = [...prompt.matchAll(/^\[(\w+)\] /gm)].map((m) => m[1]);
        return {
          title: weak.length ? "Your weak spots" : `Quiz on ${file}`,
          questions: Array.from({ length: n || 3 }, (_, i) => ({
            targets: weak[i],
            prompt: `Fake question ${i + 1}: what does line ${i + 1} of ${file} do?`,
            file,
            line: i + 1,
            focus: "line purpose",
          })),
        };
      }
      case "grade": {
        const ids = [...prompt.matchAll(/^\[(q\d+)\] Q:/gm)].map((m) => m[1]);
        const answers = [...prompt.matchAll(/^A: (.*)$/gm)].map((m) => m[1]);
        return {
          grades: ids.map((qid, i) => {
            const a = answers[i] ?? "";
            const verdict = a.length > 20 ? "right" : a.length > 3 && a !== "(no answer)" ? "partial" : "wrong";
            return {
              qid, verdict, feedback: `Fake grade (${a.length} chars).`, modelAnswer: "The model answer.",
              ...(verdict === "right" ? {} : { misconception: `You think question ${qid} is about names, but it is about behaviour.` }),
            };
          }),
        };
      }
      case "practice":
        // Two lines of real code (from line 2 on) in the first file, so the trivial-hole filter keeps them.
        const block = prompt.split("=== FILE ")[1] ?? "";
        const body = [...block.matchAll(/^\s*(\d+)\| (.*)$/gm)].map((m) => ({ n: Number(m[1]), text: m[2] }));
        const real = (t: string) => !!t.trim() && !/^\s*(\/\/|#|\*|\/\*|import\b|from\b|[{}()\[\];,]+\s*$)/.test(t);
        const at = body.findIndex((l, i) => l.n >= 2 && real(l.text) && real(body[i + 1]?.text ?? ""));
        const start = at >= 0 ? body[at].n : 2;
        return { concept: "Fake concept.", holes: [{ file: /=== FILE (\S+)/.exec(prompt)?.[1], startLine: start, endLine: start + 1, intent: "Do the main step.", hints: ["Look at the names.", "Return the result."] }] };
      case "review": {
        const ids = [...prompt.matchAll(/^hole (\d+):/gm)].map((m) => Number(m[1]));
        return { summary: "Fake review.", holes: ids.map((id) => ({ id, verdict: "partial", feedback: "Close." })) };
      }
      case "teachback": {
        const text = /THE LEARNER'S EXPLANATION:\n([\s\S]*?)\n\nCODE:/.exec(prompt)?.[1] ?? "";
        const score = text.length > 120 ? 4 : text.length > 40 ? 3 : 2;
        return {
          score, summary: "Fake teach-back grade.", right: ["You name the main step."], missing: ["The error path."],
          wrong: score < 4 ? ["You say it retries, but it gives up after one try (line 3)."] : [],
        };
      }
      case "tutor": {
        const tell = /tell them/.test(system);
        return { reply: tell ? "Here is the answer: line 2 does the work. What would change if it were missing?" : "What do you see on line 2? What does it return?" };
      }
      case "walk":
        return {
          blocks: [
            { startLine: 1, endLine: 2, title: "Setup", why: "Where it starts.", question: "What does the first line bring in?" },
            { startLine: 3, endLine: 4, title: "Main step", why: "The work.", question: "What does the main step return?" },
          ],
        };
      case "walkcheck": {
        const a = /^ANSWER: (.*)$/m.exec(prompt)?.[1] ?? "";
        const v = a.length > 20 ? "right" : a.length > 3 && a !== "(no answer)" ? "partial" : "wrong";
        return { verdict: v, feedback: `Fake check (${a.length} chars).`, ...(v === "right" ? {} : { misconception: "You think the block sets up state, but it returns a value." }) };
      }
      case "hunt": {
        // Plant one bug on the first non-empty line we can see.
        const m = /^\s*(\d+)\| (.*\S.*)$/m.exec(prompt);
        const line = Number(m?.[1] ?? 1);
        const original = m?.[2] ?? "";
        return { bugs: [{ line, original, buggy: `${original} // changed`, what: "The fake bug changes the first line." }] };
      }
      case "huntgrade": {
        const found = [...prompt.matchAll(/-> bug line (\d+)/g)].map((m) => ({ line: Number(m[1]), feedback: "Right line, right reason." }));
        const fa = /FALSE ALARMS:\n([\s\S]*?)\n\nTHE FILE/.exec(prompt)?.[1] ?? "";
        const falseAlarms = [...fa.matchAll(/^line (\d+):/gm)].map((m) => ({ line: Number(m[1]), feedback: "This line is fine." }));
        return { found, falseAlarms };
      }
      case "path": {
        const files = (/ALL FILES:\n([\s\S]*?)(\n\n|$)/.exec(prompt)?.[1] ?? "").split("\n").filter(Boolean);
        const pick = files.filter((f) => /\.(ts|js|py|md)$/.test(f)).slice(0, 3);
        return {
          title: "Fake onboarding path",
          stops: pick.map((f, i) => ({ title: `Stop ${i + 1}: ${f}`, files: [f], why: "Fake reason.", activity: i === 2 ? "quiz" : "lens" })),
        };
      }
      default:
        return {};
    }
  }
}
