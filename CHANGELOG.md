# Changelog

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
