# Changelog

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
