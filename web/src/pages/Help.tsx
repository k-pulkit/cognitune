import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Search } from "lucide-react";
import { useLocation, useSearchParams } from "react-router-dom";

/**
 * The help page. Ctrl/Cmd+H opens it from anywhere, scrolled to the part that matches the page
 * you were on. Every section says what it is for, how to use it, and gives an example you can copy.
 */

interface Section {
  id: string;
  title: string;
  /** One line: what is this for. */
  what: string;
  /** Numbered steps. */
  steps?: string[];
  /** Things to type or try, copied as is. */
  examples?: string[];
  /** Extra facts that save a guess. */
  notes?: string[];
}

interface Group {
  title: string;
  sections: Section[];
}

const GROUPS: Group[] = [
  {
    title: "Start here",
    sections: [
      {
        id: "start",
        title: "The idea in one minute",
        what: "cognitune helps you understand code, not just read it. It asks a model to explain, then makes you answer, explain back and find bugs, and it brings things back when you are about to forget them.",
        steps: [
          "Open a folder (Projects page). cognitune only reads it. It never changes your files.",
          "Go to Explore. Tick the files you want to understand.",
          "Pick an activity on the right: Lens to read, Quiz or Teach to test yourself.",
          "Wrong answers become Weak spots and review cards. Today shows what to do next.",
        ],
        examples: [
          "First visit: Projects > Open a folder > Explore > tick src/queue.ts > Lens > Explain > Make lens.",
          "Then: Quiz on the same file. Miss a question, and it shows up on Today under Weak spots.",
        ],
        notes: [
          "Each model call takes about 20 to 90 seconds. A bar shows progress; you can keep browsing.",
          "The model reads only the files you tick, plus the notes and context you add. Nothing else leaves your machine.",
        ],
      },
      {
        id: "projects",
        title: "Projects",
        what: "A project is one folder on your disk. Everything you make (lenses, quizzes, cards) is stored under that project.",
        steps: [
          "Open a folder with Open folder. Type a path or browse.",
          "Click a project card to enter it. The rail on the left changes to the project pages.",
          "Remove (the button on the project card) takes it off the list. Its data moves to an archive and is deleted after the keep time (Settings > Storage). Opening the same folder again restores it.",
        ],
        examples: ["Try the built-in sample: run cognitune with --demo. It opens a tiny queue project with a fake model."],
      },
      {
        id: "keys",
        title: "Keyboard shortcuts",
        what: "The short list. Press ? anywhere (outside a text box) to see it in a window.",
        examples: [
          "Ctrl/Cmd + K : go to a page, file or project, or start an activity on the open file",
          "Ctrl/Cmd + H : this help, opened at the section for the page you are on",
          "?            : shortcut list",
          "[ and ]      : fold or show the left and right panes",
          "Space        : Review, show the answer",
          "1 2 3 4      : Review, rate again / hard / good / easy",
          "Ctrl + Enter : Tutor, send the message",
          "← →          : Trace, step back and forward",
        ],
      },
      {
        id: "palette",
        title: "Quick jump (Ctrl K)",
        what: "One box to go anywhere or start anything without the mouse.",
        steps: [
          "Press Ctrl K (Cmd K on Mac).",
          "Type a few letters. Pages, files in this project, other projects and activities are matched.",
          "Press Enter to go. Esc closes.",
        ],
        examples: ["Type: rev  → Review", "Type: queue  → files with queue in the path", "Type: quiz  → start a quiz on the open file"],
      },
    ],
  },
  {
    title: "Learn a codebase",
    sections: [
      {
        id: "today",
        title: "Today",
        what: "What to do now. The page picks the most useful next step so you do not have to decide.",
        steps: [
          "Read the Suggested next card at the top. Start runs it.",
          "Review cards: how many are due. Start review opens the flashcards.",
          "Weak spots: things you got wrong. Quiz my weak spots builds a quiz from them.",
          "Needs a refresh: files you passed a while ago, or that changed since. Click a file to quiz yourself on it.",
          "Learning path: the next stop of a path you made.",
        ],
        notes: ["The flame badge counts days in a row with any practice. Missing a day resets it; one review is enough to keep it."],
      },
      {
        id: "explore",
        title: "Explore: choose files and an activity",
        what: "The main workspace. File tree on the left, code in the middle, activities on the right.",
        steps: [
          "Click a file name to open it and read it.",
          "Tick the box beside a file or a folder to add it to the Context. The model reads only what is in Context.",
          "Use the filter box above the tree to find a file by name.",
          "Pick an activity (Lens, Quiz, Teach, Tutor, Walk, Practice, Bug hunt, Notes) in the right pane.",
                  ],
        examples: [
          "Understand one module: tick only src/queue.ts, Lens > Explain.",
          "Understand how two files connect: tick both, Lens > Data flow.",
          "A folder is ticked in one click; keep the selection small (1 to 5 files) for sharper answers.",
        ],
        notes: [
          "Context · 3 means three files are selected. Add lets you pick files from the project or from a context folder (docs, notes, a session folder).",
          "[ and ] fold the side panes to give the code more room.",
        ],
      },
      {
        id: "lens",
        title: "Lens: read an explanation through one question",
        what: "A lens is a written explanation of your selected files, built around one question. It is like a short blog post about the code, with a walkthrough, pitfalls and a check for each step.",
        steps: [
          "Tick files in Explore. Open the Lens tab.",
          "Pick a kind of lens (see the list below).",
          "Choose depth: Overview (about 1.5 screens, 3 to 4 steps), Standard (at least 3 screens, enough to change the code safely), Deep (5 to 6 screens, like a long blog post: every branch and failure path). Deep takes several minutes because it is planned first, then written in parts.",
          "Optional: type your own question for the lens to answer.",
          "Click Make lens. A planner model first outlines the lesson, then a writer model writes it in parts. When it is ready, you land on the lens page.",
        ],
        examples: [
          "Explain: \"The tour: purpose, main pieces, how they connect.\" Best first lens for any file.",
          "Data flow: follow one value from where it enters to where it leaves. Try on a request handler.",
          "State over time: what is stored, who changes it, in which order. Try on a class with fields.",
          "Failure modes: bad input, timeouts, partial writes, retries. Try before changing error handling.",
          "Contracts: inputs, outputs and invariants between parts. Try on an API or a module boundary.",
          "Concepts: the vocabulary first, with the line where each term shows up. Try when the code uses words you do not know.",
          "The change: pick it in Changes with a diff; gives intent, risk and what to check.",
          "Trace a run: step by step through one example input, with the state at each line. Use the arrows to step.",
          "History: what changed over time and why, from the commits.",
        ],
        notes: [
          "On the lens page: Words you need first (click a term to see where it shows up), the walkthrough (each step has a code card, a pitfall and a check question), then gotchas and next steps.",
          "Click open file on a step to jump the code pane to that range. The same file pane stays on the right.",
          "Refresh rebuilds a lens when the code changed. A banner tells you when it did.",
        ],
      },
      {
        id: "quiz",
        title: "Quiz: answer in your own words",
        what: "Questions about your selected files. You type answers; the model grades each one and says what was missing.",
        steps: [
          "Tick files. Open the Quiz tab. Choose how many questions (Default, 3, 5 or 8).",
          "Click Make quiz. Answer every question in the box beneath it. Short answers are fine; the core idea is what counts.",
          "Click Grade. Each answer gets a verdict, an explanation and the line it came from.",
          "A wrong answer is saved as a Weak spot and turns into a review card.",
        ],
        examples: [
          "Question: \"What happens when pop() is called on an empty queue?\"  Answer: \"It raises IndexError, the caller must catch it.\"",
          "Retake: open the quiz from Library > Quizzes. Your best score is kept; at most 20 attempts are stored.",
        ],
        notes: ["Empty answers are not counted as misconceptions. They are just unanswered."],
      },
      {
        id: "teach",
        title: "Teach: explain it back",
        what: "You write an explanation as if teaching a colleague. The model grades it for what is right, what is missing and what is wrong.",
        steps: [
          "Tick files. Open Teach.",
          "Write your explanation in your own words. Do not look at the code more than you need.",
          "Submit. You get strengths, gaps and corrections tied to lines.",
          "Gaps become Weak spots, so they come back later.",
        ],
        examples: ["\"A queue stores items in order. push adds at the tail; pop removes the head. When it is empty, pop raises.\" Short and specific beats long and vague."],
      },
      {
        id: "tutor",
        title: "Tutor: get hints, not answers",
        what: "A chat that helps you reach the answer yourself. Hints come in steps. Ask for the answer when you are stuck.",
        steps: [
          "Tick files. Open Tutor and type a question.",
          "The tutor replies with a question or a small hint (level 1). Ask again for more help: level 2 is a stronger hint, level 3 nearly gives it away.",
          "At level 4 it tells you directly. Use that when you are really stuck.",
          "Ctrl + Enter sends the message.",
        ],
        examples: ["You: \"Why does flush() hold the lock while it writes?\"  Tutor: \"What could happen to the buffer if another thread called push() in the middle?\""],
        notes: ["Only the last 200 messages of a chat are kept."],
      },
      {
        id: "walk",
        title: "Walk: one block at a time",
        what: "A guided tour of one file in small blocks. After each block you answer a short check before moving on.",
        steps: [
          "Open a file, tick it, open Walk, click Make walk.",
          "Read the block. Answer the check below it. Press Check.",
          "A right answer unlocks the next block. A wrong one explains and keeps you on the block.",
        ],
        examples: ["Use it for a file you must understand fully before changing it, such as a parser or a state machine."],
      },
      {
        id: "practice",
        title: "Practice: write the key lines back",
        what: "The code with some lines removed. You type them from memory and get feedback.",
        steps: [
          "Choose a level: 1 one short hole, 2 a condition and a computation, 3 core logic, 4 whole function bodies.",
          "Click Make practice. Fill the gaps in the editor.",
          "Submit. You see your version next to the real one, with differences explained.",
          "The eye button hides or shows the original. Reset restores the gaps.",
        ],
        examples: ["Start at level 1 on a function you read today. Move to level 3 a week later."],
      },
      {
        id: "hunt",
        title: "Bug hunt: find the planted bugs",
        what: "cognitune plants bugs in a copy of the code (your files are not touched). You mark the lines you think are wrong.",
        steps: [
          "Choose difficulty: Easy (one visible bug), Medium (two, one needs the logic), Hard (two or three subtle ones).",
          "Click Make hunt. Read the copy and click lines you think are buggy.",
          "Press Grade. The real bugs show up, with what was wrong and how you did.",
        ],
        notes: ["The bugs are hidden until you grade. Reloading the page does not reveal them."],
      },
      {
        id: "notes",
        title: "Notes",
        what: "Your own notes on a file or a line. They can be included in prompts so answers match what you already know.",
        steps: [
          "Open a file. Click a line number, add a note, save.",
          "A mark appears in the margin. Click it to read or edit.",
          "Turn on Settings > Notes in prompts to let the model see your notes.",
        ],
        examples: ["\"I keep mixing up head and tail here. Head is where pop reads.\""],
      },
      {
        id: "changes",
        title: "Changes: learn from a diff",
        what: "Understand a commit, a branch or uncommitted work before you review or merge it.",
        steps: [
          "Choose a repo, then what to compare (for example a branch against main, or a single commit).",
          "Tick the changed files you care about.",
          "Use the activity panel: Lens > The change gives intent, risk and what to check.",
        ],
        examples: ["Before reviewing a colleague's branch: Changes > main..feature/x > tick the three biggest files > Lens > The change."],
      },
    ],
  },
  {
    title: "Remember it",
    sections: [
      {
        id: "review",
        title: "Review: flashcards that come back on time",
        what: "Cards are spaced: easy ones return later, hard ones sooner (FSRS). Ten minutes a day beats an hour once.",
        steps: [
          "Open Review (the badge shows how many are due).",
          "Read the question. Say or type your answer in your head. Press Space to show the answer.",
          "Rate yourself: 1 Again (forgot), 2 Hard, 3 Good, 4 Easy. The buttons show when each will return.",
        ],
        examples: [
          "Forgot it completely → 1. It returns in minutes.",
          "Got it but had to think → 2 or 3.",
          "Got it instantly → 4. It goes weeks out.",
        ],
        notes: [
          "Cards come from wrong quiz answers, teach-back gaps and weak spots (Settings > Cards from misses). You can also add a card from the file view with the card button.",
          "Only the last 50 reviews of each card are kept.",
        ],
      },
      {
        id: "library",
        title: "Library: everything you made",
        what: "One place for every lens, quiz, practice, teach-back, walk, hunt, tutor chat, card, glossary term and note in this project.",
        steps: [
          "Pick a tab. Use Search this tab to filter.",
          "Click an item to open it. Items you delete go to an archive and are removed after the keep time.",
          "Glossary is the list of terms the lenses defined, across all lenses.",
        ],
        examples: ["Looking for the lens you made last week on the scheduler: Library > Lenses > search: scheduler."],
      },
      {
        id: "progress",
        title: "Progress",
        what: "A heatmap of when you practised and a level per file.",
        steps: [
          "Levels: new, seen, understood, fading, stale. A file turns fading after a few weeks without practice, and stale when the code changed since you studied it (Settings > fade days).",
          "Click a file to open it in Explore.",
        ],
      },
    ],
  },
  {
    title: "See the shape",
    sections: [
      {
        id: "map",
        title: "Map: how files connect",
        what: "A graph of which files import which. Big dots are files many others depend on.",
        steps: [
          "Open Map. Drag to move, scroll to zoom, click a node to open that file.",
          "Use the selector at the top (same tree as Explore) to narrow the map to a folder or a few files.",
          "Dot colours show your level on each file, so the new ones are what you have not studied.",
        ],
        examples: ["Pick src/server only to see how the server files connect, ignoring the rest."],
        notes: ["Import links are found by reading import lines (TypeScript, JavaScript and Python). Aliases from tsconfig paths are followed."],
      },
      {
        id: "paths",
        title: "Paths: an ordered tour",
        what: "A learning path is an ordered list of stops: where to start, what next, and how to check each stop.",
        steps: [
          "Open Paths. Describe your goal, or leave it blank for a general tour.",
          "Click Make a path. Each stop has files, why it matters and an activity.",
          "Do this stop opens Explore with the files ticked and the activity ready.",
          "Tick a stop off when done. Today shows the next stop.",
        ],
        examples: ["Goal: \"I need to add retries to the job runner.\" The path walks queue, worker, then error handling."],
      },
    ],
  },
  {
    title: "Settings and storage",
    sections: [
      {
        id: "settings",
        title: "Settings",
        what: "Which model runs, how text looks, and what cognitune keeps.",
        steps: [
          "Planning model (default claude-opus-5-5) plans lenses, quizzes, walks, practice, bug hunts and paths; the model above (default claude-sonnet-5-5) writes them. Plan first can be turned off for one-shot answers.",
          "Model: choose the agent (Auto, Claude Code CLI, Codex CLI, GitHub Copilot CLI, an Anthropic API key, or Demo). Auto uses the first one installed.",
          "Reading font: sans (default) or serif for lens pages.",
          "Cards, progress and notes: switches for turning wrong answers into cards, how fast files fade, and whether notes go to the model.",
          "Recent model calls: the last calls with how long they took and any error.",
        ],
      },
      {
        id: "storage",
        title: "Storage: keeping it small",
        what: "Everything is plain JSON files in your cognitune folder (shown in Settings). It stays bounded on its own and you can also remove things by hand.",
        steps: [
          "Automatic: archived items and forgotten projects are removed after the keep time (30 days by default). The reply cache keeps to its size (50 MB). Quiz attempts, card history, tutor chats and the job log are capped.",
          "Clean up now applies those limits at once.",
          "Choose what to remove: open the list, filter by kind, tick the items, press Remove selected, then confirm. Select all shown ticks every row in the current filter.",
        ],
        examples: [
          "Free space fast: Choose what to remove > kind: reply cache > Select all shown > Remove selected. Nothing you made is lost; answers are just asked again later.",
          "Remove one old lens: kind: lenses > tick it > Remove selected.",
        ],
        notes: ["Removing is permanent (no archive step). Your project folders are never touched."],
      },
    ],
  },
];

/** Which help section matches the page you were on. */
function sectionFor(path: string): string | null {
  const m = path.match(/^\/p\/[^/]+\/([^/]+)/);
  const page = m?.[1];
  if (path === "/settings") return "settings";
  if (path === "/") return "projects";
  if (!page) return null;
  const map: Record<string, string> = {
    today: "today", explore: "explore", review: "review", map: "map", paths: "paths", path: "paths", library: "library",
    progress: "progress", changes: "changes", lens: "lens", quiz: "quiz", teach: "teach", tutor: "tutor", walk: "walk",
    practice: "practice", hunt: "hunt",
  };
  return map[page] ?? null;
}

export { sectionFor };

export function HelpPage() {
  const [params] = useSearchParams();
  const loc = useLocation();
  const [q, setQ] = useState("");
  const target = params.get("s");
  const [active, setActive] = useState(target ?? "start");

  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return GROUPS;
    return GROUPS.map((g) => ({
      ...g,
      sections: g.sections.filter((s) =>
        [s.title, s.what, ...(s.steps ?? []), ...(s.examples ?? []), ...(s.notes ?? [])].join(" ").toLowerCase().includes(t)),
    })).filter((g) => g.sections.length);
  }, [q]);

  useEffect(() => {
    if (!target) return;
    setActive(target);
    requestAnimationFrame(() => document.getElementById(`help-${target}`)?.scrollIntoView({ block: "start" }));
  }, [target, loc.key]);

  const go = (id: string) => {
    setActive(id);
    document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-6xl gap-10 px-8 py-10">
        <nav className="sticky top-0 hidden h-fit w-56 shrink-0 lg:block">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
            <input className="input h-9 pl-8 text-[14px]" placeholder="Search help" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="mt-4 space-y-4">
            {groups.map((g) => (
              <div key={g.title}>
                <div className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.title}</div>
                <ul className="mt-1">
                  {g.sections.map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => go(s.id)}
                        className={clsx("w-full rounded-md px-2 py-1.5 text-left text-[14px] hover:bg-raised", active === s.id ? "bg-accent/10 font-medium text-accent" : "text-ink")}
                      >
                        {s.title.split(":")[0]}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <main className="min-w-0 flex-1">
          <h1 className="text-3xl font-semibold tracking-tight">Help</h1>
          <p className="mt-2 max-w-2xl text-[16px] leading-relaxed text-muted">
            What every part does, how to use it, and something to try. Press <span className="kbd">Ctrl H</span> on any page to open this at the matching part.
          </p>
          <div className="mt-4 lg:hidden">
            <input className="input" placeholder="Search help" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          {groups.map((g) => (
            <div key={g.title}>
              <h2 className="mt-12 border-b border-line pb-2 text-sm font-semibold uppercase tracking-wide text-muted">{g.title}</h2>
              {g.sections.map((s) => (
                <section key={s.id} id={`help-${s.id}`} className="scroll-mt-6 pt-8">
                  <h3 className="text-2xl font-semibold tracking-tight">{s.title}</h3>
                  <p className="mt-2 max-w-3xl text-[17px] leading-[1.65]">{s.what}</p>

                  {s.steps && (
                    <>
                      <div className="mt-5 text-xs font-semibold uppercase tracking-wide text-accent">How to use it</div>
                      <ol className="mt-2 max-w-3xl list-decimal space-y-2 pl-6 text-[16px] leading-[1.6] marker:text-muted">
                        {s.steps.map((x) => <li key={x}>{x}</li>)}
                      </ol>
                    </>
                  )}

                  {s.examples && (
                    <>
                      <div className="mt-5 text-xs font-semibold uppercase tracking-wide text-accent">Try this</div>
                      <div className="mt-2 max-w-3xl space-y-2">
                        {s.examples.map((x) => (
                          <div key={x} className="rounded-lg border border-line bg-raised px-4 py-2.5 text-[15px] leading-[1.55]">{x}</div>
                        ))}
                      </div>
                    </>
                  )}

                  {s.notes && (
                    <>
                      <div className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">Good to know</div>
                      <ul className="mt-2 max-w-3xl list-disc space-y-1.5 pl-6 text-[15px] leading-[1.6] text-muted marker:text-line">
                        {s.notes.map((x) => <li key={x}>{x}</li>)}
                      </ul>
                    </>
                  )}
                </section>
              ))}
            </div>
          ))}
          {!groups.length && <p className="mt-10 text-muted">Nothing matches "{q}".</p>}
          <div className="h-24" />
        </main>
      </div>
    </div>
  );
}
