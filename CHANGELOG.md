# Changelog

## 0.3.8 (2026-11-19)

Release check, no feature changes:

- The Marketplace publish runs in its own release job, in the `production` environment that its trusted
  publishing policy requires.

## 0.3.7 (2026-11-19)

Release check, no feature changes:

- The VS Code extension now publishes to the Marketplace from the release workflow (trusted publishing),
  on the same tag as npm.

## 0.3.6 (2026-11-19)

New: **cognitune for VS Code** (`k-pulkit.cognitune`, also attached to each GitHub Release as a `.vsix`).

- Right-click files, a folder or the editor: **cognitune > Explain, Data flow, Failure modes, More lenses,
  Quiz me, Ask the tutor, Teach it back, Walk me through, Bug hunt, Practice**. It starts right away on
  those files, shows progress in a notification and opens the result in a panel beside your code.
- A cognitune sidebar (activity bar icon) with Today, Explain / Quiz me on this file, Quiz me on
  uncommitted changes and Review cards; "Quiz me on uncommitted changes" also sits in the Source Control
  title bar.
- A status bar item: server off / starting / ready, running jobs with a timer, and cards due.
- Commands: Open, Stop server, Restart server. The extension reuses a cognitune server already running on
  its port (`cognitune.port`, default 4711), else starts the one bundled inside it with VS Code's own Node.
- In the panel, "open in editor" on a file opens it in VS Code at that line.

The web app gets `?open=`, `?pick=` and `?repo=` on Explore and Changes for the extension; `npx cognitune`
works as before.

## 0.3.5 (2026-11-18)

Fixes:

- Lens diagrams: "click to enlarge" opened an empty box. The enlarged diagram is now sized from the
  diagram itself, up to 1.6x its size on the page, and fits the window.

## 0.3.4 (2026-11-18)

Fixes:

- Model calls no longer fill your own session lists. Claude Code, Codex and Copilot used to start
  in the project folder, so every lens, quiz and tutor turn showed up in that folder's
  `claude --resume` list. They now run from `~/.cognitune/agent` with the project as a readable
  folder, and Claude Code runs with session saving off.

## 0.3.3 (2026-11-18)

Fixes:

- Split diff: the column divider ran through hunk headers ("@@ -40,10 +42,11 @@ export class
  Queue<T> {"); headers now span both columns above the divider.

## 0.3.2 (2026-11-18)

Map:

- All nodes are circles: a folder has a ring and its file count, a file is a small dot.
- A calmer layout: spacing leaves room for each label, and arrowheads keep a fixed size however
  thick the arrow.
- Text keeps its real size: the map draws 1:1 in pixels, so a small graph is no longer blown up, and
  labels stay readable when a big one is shrunk to fit.
- Drag a dot to move it; + / - / fit buttons (fit also puts dragged dots back).
- Click a file to read its code in a pane beside the map; Ctrl/Cmd+click opens it in Explore.

## 0.3.1 (2026-11-18)

New:

- **Progress rolls up by repo and folder.** At a folder of many repos, each repo is one row with a
  coverage bar; click to go into its folders, then files. A scope bar (breadcrumb with a repo picker)
  narrows the cards, table and heatmap, and search filters the touched files in it. The scope lives
  in the address, so it can be bookmarked. Untouched rows fold into one "show N untouched" line.
- **Map shows repos and folders, not ~2,000 files.** Nodes are repos, then folders, then files at
  the current scope; a folder of 8 code files or fewer shows its files. Imports between two folders
  are one arrow, thicker for more imports, so a Python package's `__init__.py` no longer looks like a
  hub. Click a folder to go in. The layout runs off the main thread behind a placeholder map, and the
  server keeps the graph until you press Refresh (it used to rebuild every minute).
- README: a banner, the Read / Prove / Keep loop, and screenshots cropped to be readable.

Fixes:

- Tutor links dropped the word between two ranges: "lines 41-48 and 58-60" showed as "41-4858-60".
- The Today page's path card said "Do this stop"; it now names the activity ("Start the lens"),
  like the Paths page.
- The Library's tab strip stretches to fill its row instead of ending in an empty block.

## 0.3.0 (2026-11-18)

New:

- **Lens follow-ups.** "Ask more about this" at the end of a lens adds the answer to the same
  lens instead of making a new one. Ticked files can come along as extra context; new terms and
  gotchas join the lens's lists, and the markdown export includes the follow-ups.
- **Weak spots page.** A Weak spots tab in the Library: quiz yourself on one weak spot, or
  dismiss one the grader got wrong. Today links to it.
- **Walk "Try again".** A block you didn't get right can be answered again; a right answer
  clears its weak spot.
- **Jobs in the status bar.** Running jobs show at the bottom of the window, and a job that
  finishes after you left its page shows a "ready · open" link.
- **Tutor chat** is restyled as chat bubbles with timestamps, and "line 42" / "lines 64-71" in a
  hint jump the code pane to those lines.
- Teach-back and the tutor, started from the Changes page, now see the diff (only lens and quiz
  did before). The tutor sees it on every turn.
- A review card links back to the lens or quiz it came from.
- `.claude` folders show in the Explore file tree, so session notes can be ticked as context.

Fixes:

- The tutor's replies rendered at 17px next to 14px user messages: the serif reading-font rule
  out-ranked the chat styles. Both now match.
- The lens page flickered while a job ran: every mermaid diagram and code block was remounted
  twice a second. Markdown rendering now keeps them mounted.
- Syntax highlighting now works in the Changes diff view, in fenced code blocks inside lens and
  quiz prose, and in bug hunt's code copy (each was plain text before, for different reasons).
- File-chip lists on the quiz, teach-back and tutor pages collapse to 6 + "N more", like the
  lens page.
- The Library's tabs fit on one row instead of scrolling sideways (a narrow window wraps them),
  and a path stop's button says what it starts ("Start the lens") instead of "Do this stop".

## 0.2.2 (2026-11-10)

Release workflow fix, no feature changes:

- `npm publish` is now followed by a check against the registry: if it reports failure but the
  version is actually live (seen once, as a retry conflict with a leftover staged version), the
  release still completes instead of falsely failing before the GitHub Release step.

## 0.2.1 (2026-11-10)

Repo housekeeping, no feature changes:

- Renamed the project (groklab -> learnforge -> cognitune): package name, CLI, env vars, storage dir.
- Public GitHub repo, CI and a tag-triggered npm release workflow (trusted publishing, no stored token).
- README screenshots.

## 0.2.0 (2026-11-10)

Learning features on top of 0.1:

- Review cards with spaced repetition (FSRS); quiz misses become cards on their own.
- Weak spots: wrong answers saved as the belief behind them; "Quiz my weak spots" aims new questions at them.
- My take first / Predict first on lenses, with a "where you differ" section.
- New lens kinds: Trace a run (step-through with variables) and History (from git log).
- Teach-back, Socratic tutor with a hint ladder, walkthrough with per-block checks, bug hunt.
- Map (import graph for TS/JS with tsconfig aliases, and Python), learning paths, glossary, margin notes.
- Today page, fading level and whole-repo heatmap in Progress, command palette (Ctrl/Cmd+K), `?` shortcuts.
- Lens freshness banner with refresh; markdown export of lenses and quizzes; JSON export of a project.
- Model replies checked against schemas with one retry; lens, walkthrough and path replies cached.
- Storage stays bounded: archive expiry, cache size cap, quiz attempt cap, capped histories, crash-file cleanup,
  removed projects archived then expired; Settings > Storage with usage and "Clean up now".
- Jobs persist across restarts (capped), with a history in Settings.
- `--demo` flag: a sample repo with canned answers and temp data.

## 0.1.0

Lenses, quizzes, practice, changes and progress over any folder. Claude Code, Codex and Copilot CLIs, or an API key.
