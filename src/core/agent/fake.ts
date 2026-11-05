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
    const delay = Number(process.env.GROKLAB_FAKE_DELAY_MS ?? 0);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return "```json\n" + JSON.stringify(this.reply(task, file, req.prompt, req.system), null, 2) + "\n```";
  }

  private reply(task: string, file: string, prompt: string, system: string): unknown {
    switch (task) {
      case "lens":
        return {
          title: `How ${file} works`,
          summary: `This is a fake lesson about ${file}. It shows the shape of a real one.`,
          concepts: [
            { term: "Entry point", explain: "Where the work starts." },
            { term: "Side effect", explain: "A change outside the function, like a file write." },
          ],
          intuition: "Input flows to output:\n\n```mermaid\nflowchart LR\n  A[input] --> B[transform] --> C[output]\n```",
          deepDives: [
            { title: "The top of the file", file, line: 1, body: "Imports and setup." },
            { title: "The main logic", file, line: 3, body: "Where the work happens." },
          ],
        };
      case "quiz": {
        const n = Number(/exactly (\d+) items/.exec(system)?.[1] ?? 3);
        return {
          title: `Quiz on ${file}`,
          questions: Array.from({ length: n || 3 }, (_, i) => ({
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
            return { qid, verdict, feedback: `Fake grade (${a.length} chars).`, modelAnswer: "The model answer." };
          }),
        };
      }
      case "practice":
        return { holes: [{ startLine: 2, endLine: 3, intent: "Do the main step.", hints: ["Look at the names.", "Return the result."] }] };
      case "review": {
        const ids = [...prompt.matchAll(/^hole (\d+):/gm)].map((m) => Number(m[1]));
        return { summary: "Fake review.", holes: ids.map((id) => ({ id, verdict: "partial", feedback: "Close." })) };
      }
      default:
        return {};
    }
  }
}
