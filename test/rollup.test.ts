import { expect, it } from "vitest";
import type { FileLevel, FileProgress } from "../src/core/types";
import { rollup, touched } from "../web/src/lib/rollup";

const R = "/w";
const files = [
  `${R}/CLAUDE.md`,
  `${R}/frameworks/cot/src/a.py`,
  `${R}/frameworks/cot/src/b.py`,
  `${R}/frameworks/cot/README.md`,
  `${R}/frameworks/core/x.ts`,
  `${R}/notes/deep/only/child.md`,
];
const repos = [
  { path: `${R}/frameworks/cot`, name: "frameworks/cot", branch: "main" },
  { path: `${R}/frameworks/core`, name: "frameworks/core", branch: "main" },
];
const fp = (path: string, level: FileLevel, lastRetrieval: string | null = null): FileProgress =>
  ({ path, level, lenses: 1, quizzes: 0, bestScore: null, practices: 0, other: 0, lastRetrieval });
const progress = new Map([
  [`${R}/frameworks/cot/src/a.py`, fp(`${R}/frameworks/cot/src/a.py`, "understood", "2026-11-10")],
  [`${R}/frameworks/cot/src/b.py`, fp(`${R}/frameworks/cot/src/b.py`, "seen")],
  [`${R}/CLAUDE.md`, fp(`${R}/CLAUDE.md`, "stale", "2026-11-12")],
]);

it("at the workspace root, each git repo is one row with its levels rolled up", () => {
  const rows = rollup(R, files, progress, repos);
  expect(rows.map((r) => [r.kind, r.label])).toEqual([
    ["repo", "frameworks/cot"], // touched most, so first
    ["repo", "frameworks/core"],
    ["dir", "notes/deep/only"], // single-child chain merged
    ["file", "CLAUDE.md"],
  ]);
  const cot = rows[0];
  expect(cot.total).toBe(3);
  expect(touched(cot)).toBe(2);
  expect(cot.counts).toMatchObject({ understood: 1, seen: 1, new: 1 });
  expect(cot.lastRetrieval).toBe("2026-11-10");
  expect(rows[3].file?.level).toBe("stale");
});

it("inside a repo, rows are its folders then its files, labelled relative to the scope", () => {
  const rows = rollup(`${R}/frameworks/cot`, files, progress, repos);
  expect(rows.map((r) => [r.kind, r.label, r.total])).toEqual([
    ["dir", "src", 2],
    ["file", "README.md", 1],
  ]);
  expect(rows[1].file).toBeUndefined();
});
