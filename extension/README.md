# cognitune for VS Code

Understand the code you, or an AI, just wrote. cognitune explains code through one question at a
time, then checks that you got it: quizzes, teach-back, a tutor that gives hints instead of
answers, and spaced review so it stays. This extension shows the cognitune app in a panel beside
your code.

![A lens explaining a file, with the code beside it](https://raw.githubusercontent.com/k-pulkit/cognitune/main/assets/screenshots/lens.png)

## Commands

| Command | Where | What it does |
|---|---|---|
| **cognitune: Open** | Command palette | Opens the Today page for this folder: what to review, what changed, where to go next. |
| **cognitune: Lens this file** | Editor title, editor and Explorer right-click menus | Opens the file in cognitune with the lens list beside it. |
| **cognitune: Quiz me on uncommitted changes** | Source Control title bar | Opens the diff of your working tree, ready for a lens or a quiz on the change. |
| **cognitune: Review due cards** | Status bar (`N due`) | Your review cards for today. |

In the app, **open in editor** on a file opens it here at that line.

![Quiz on a change in the working tree](https://raw.githubusercontent.com/k-pulkit/cognitune/main/assets/screenshots/changes.png)

## What you need

A model. cognitune uses the first one it finds:

1. the Claude Code CLI (`claude`), with its own login,
2. the Codex CLI (`codex`),
3. the GitHub Copilot CLI (`copilot`),
4. or an `ANTHROPIC_API_KEY` in the environment.

No key is asked for or stored by cognitune.

## How it runs

The extension starts the cognitune server bundled inside it, on `127.0.0.1:4711` (setting
`cognitune.port`). If a cognitune server is already running there, for example one you started
with `npx cognitune`, the extension uses that one instead, so both share the same progress.

Your data stays in `~/.cognitune` on the machine with the code (in WSL, SSH or a container, that
is the remote side). Your folders are never written.

The same app runs without VS Code: `npx cognitune ./your-repo`. More in the
[project README](https://github.com/k-pulkit/cognitune#readme).
