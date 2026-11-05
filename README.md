# groklab

Understand any codebase, and prove to yourself that you do.

AI makes code faster to write and easier to not understand. groklab turns the model around: instead of
writing code for you, it helps you build the model of the code in your own head.

```bash
npx groklab ./my-repo
```

## What it does

| | |
|---|---|
| **Lenses** | See code through one question: *Explain*, *Data flow*, *State over time*, *Failure modes*, *Contracts*, *Concepts*, *The change*, or your own. A lens is a short lesson: summary, concepts, an intuition (with a diagram), then deep dives that open the code at the line. |
| **Quizzes** | Free-text questions about behaviour and reasons, not names. Mark each answer *sure* or *guess*. Graded with feedback that names the line, and a good answer to compare with. |
| **Practice** | The key logic is cut out of a copy of your file (4 levels). Write it back in the browser editor, open hints one at a time, then "check my work". Pseudo-code with the right logic counts. |
| **Changes** | Pick two git refs, or HEAD vs your working tree. Read the split diff, then make a lens or a quiz about the change itself. |
| **Progress** | Per file: *seen*, *understood* (a quiz passed), *stale* (passed, then the code changed). Only a passed quiz counts. |

Context is what you pick: tick files in the tree, or add extra folders (docs, notes, design files) to a
project as context. The model reads only what you give it.

## Model access

groklab makes one model call per lens, quiz, grade, practice or review (about 15 s to 2 min).

- **Claude Code installed** (`claude` on your PATH): used by default, with your existing login. It runs
  headless with read-only tools (`Read`, `Grep`, `Glob`) in the project folder.
- **Else `ANTHROPIC_API_KEY`**: calls the API directly; the picked files go in the prompt.
- **Demo:** `GROKLAB_AGENT=fake npx groklab .` gives canned answers, to try the UI without a model.

Pick the mode and the model in Settings.

## Your files are safe

- groklab never writes to your folders. Practice works on a copy.
- Everything it makes lives in `~/.groklab` (change with `GROKLAB_HOME`), as plain JSON files:

```
~/.groklab/
  settings.json
  projects.json
  projects/<id>/lenses/<id>.json
  projects/<id>/quizzes/<id>.json
  projects/<id>/practice/<id>.json
  projects/<id>/archive/...        "Archive" moves files here, it never erases
```

- The server binds to `127.0.0.1` only. There is no login: it is a local, one-person tool.

## CLI

```
groklab [folder] [--port 4711] [--host 127.0.0.1] [--no-open]
```

## Develop

```bash
npm install
npm run dev          # API on :4711 (tsx watch) + Vite on :5173 with hot reload
npm test             # API tests (vitest, fake model, temp git repos)
npm run typecheck
npm run build        # dist/web (Vite) + dist/cli.js (tsup)

# Browser smoke test over every page (needs a Chromium; set CHROME or have one in ~/.cache/ms-playwright)
GROKLAB_HOME=$(mktemp -d) GROKLAB_AGENT=fake node dist/cli.js . --port 4799 --no-open &
node test/ui-smoke.mjs [--dark] [--shots DIR]
```

Layout:

```
src/cli.ts              CLI: serves the API and the built web app
src/server/app.ts       Hono routes under /api
src/core/               no HTTP here: workspace (files, git), store, prompts, services, jobs, agent adapters
web/src/                React + Vite + Tailwind: pages/, components/, lib/
```

Stack: TypeScript everywhere. Hono on Node 20+. React 18, React Router, TanStack Query, Tailwind,
Shiki (code), CodeMirror (practice editor), Mermaid (diagrams).

## License

MIT
