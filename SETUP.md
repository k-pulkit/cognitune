# Setup

## 1. Install

```bash
# No install — always runs the latest published version
npx cognitune ./my-repo

# Or install once, then just run `cognitune` from anywhere
npm install -g cognitune
```

Needs Node >= 20 (`node -v` to check).

## 2. Pick a model backend

cognitune drives a coding CLI you already use — it never asks for or stores a key itself. It
picks the first one it finds, in this order, or you can pin one in Settings:

| Backend | One-time setup | Used as |
|---|---|---|
| Claude Code (default) | already logged into `claude` | `claude -p`, read-only tools |
| OpenAI Codex | `codex login` | `codex exec -`, sandboxed read-only |
| GitHub Copilot | Copilot login, or `export COPILOT_GITHUB_TOKEN=...` | `copilot -p -s`, read-only |
| Anthropic API directly | `export ANTHROPIC_API_KEY=...` | Messages API |

No model set up yet? Run with `--demo` first — canned answers, no login needed, good for a
first look at every page.

## 3. Run it on a project

Say your code lives under a workspace folder, like:

```
~/repos/
├── awesome-app/
│   ├── src/
│   └── package.json
└── another-project/
```

Point cognitune at the one you want to understand:

```bash
cd ~/repos/awesome-app
cognitune .                 # opens the browser automatically at http://127.0.0.1:4711

# or from anywhere, without cd'ing in first:
cognitune ~/repos/awesome-app
```

Your source files are only ever read, never written — practice and bug-hunt exercises work on
a throwaway copy.

### CLI flags

```
cognitune [folder] [--port 4711] [--host 127.0.0.1] [--no-open] [--demo]
```

## 4. Shell shortcut

The CLI is already just `cognitune`, so the shortcut worth having is "run it on wherever I
currently am":

```bash
# ~/.bashrc (or ~/.zshrc)
alias cg='cognitune .'
```

```bash
cd ~/repos/awesome-app && cg
```

## 5. Where your data lives

Everything cognitune makes is plain JSON files under one home folder — nothing is written
anywhere else on disk:

```
~/.cognitune/                      (change with COGNITUNE_HOME)
├── settings.json                  model backend, storage limits
├── projects.json                  known projects (path, id, last opened)
├── cache/                         model replies, reused on an unchanged file
├── archive/                       forgotten projects (kept storage.archiveDays, default 30)
└── projects/
    └── <project-id>/
        ├── lenses/                one file per lens you've made
        ├── quizzes/
        ├── practice/
        ├── teachbacks/
        ├── hunts/                 bug-hunt exercises
        ├── walks/                 walkthrough progress
        ├── threads/               tutor chat history
        ├── cards/                 spaced-repetition review cards
        ├── misconceptions/        weak-spot beliefs behind wrong answers
        ├── notes/                 margin notes pinned to lines
        ├── paths/                 learning-path progress
        ├── contexts/              extra folders added to this project
        └── archive/               this project's own deleted items
```

Settings > Storage shows the size of each folder and has a one-click cleanup; nothing grows
without a cap (see the README's "Your files are safe" section for the exact limits).

## Troubleshooting

- **Port already in use** — `cognitune --port 4799` (or whatever's free).
- **"No model found"** — none of the four backends above are set up; use `--demo` to confirm
  the UI itself works, then set one up.
- **Try it with no real project yet** — `cognitune --demo` opens a small bundled sample repo.
