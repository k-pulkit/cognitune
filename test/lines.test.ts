import { expect, it } from "vitest";
import { linkifyLines } from "../web/src/lib/lines";

it("links single lines, ranges and lists, keeping the words between them", () => {
  expect(linkifyLines("see line 50.")).toBe("see line [50](codeline:50-50).");
  expect(linkifyLines("lines 64-71 do it")).toBe("lines [64-71](codeline:64-71) do it");
  expect(linkifyLines("lines 27 and 29")).toBe("lines [27](codeline:27-27) and [29](codeline:29-29)");
  expect(linkifyLines("lines 27, 29 and 31")).toBe("lines [27](codeline:27-27), [29](codeline:29-29) and [31](codeline:31-31)");
});

it("keeps the separator after a range (was dropped: '41-4858-60')", () => {
  expect(linkifyLines("lines 41-48 and 58-60")).toBe("lines [41-48](codeline:41-48) and [58-60](codeline:58-60)");
  expect(linkifyLines("lines 1-3, 7")).toBe("lines [1-3](codeline:1-3), [7](codeline:7-7)");
});

it("leaves line numbers inside code alone", () => {
  expect(linkifyLines("`line 5` and line 6")).toBe("`line 5` and line [6](codeline:6-6)");
});

// ---- lens code citations ----
import { linkifyCode, parseCodeHref } from "../web/src/lib/lines";

const R = "/repo";
const files = [`${R}/macros/get_latest_bronze_data.sql`, `${R}/macros/deduplicate.sql`, `${R}/models/a/deduplicate.sql`];
// Like the lens page: exact relative path, else a unique base-name match.
const resolve = (p: string) => files.find((f) => f === `${R}/${p}`) ?? (() => {
  const hits = files.filter((f) => f.endsWith(`/${p}`));
  return hits.length === 1 ? hits[0] : undefined;
})();
const hrefs = (md: string) => [...md.matchAll(/\]\((code:[^)]+)\)/g)].map((m) => parseCodeHref(m[1]));

it("links `file:line` spans by base name, and a bare `:n` to the file named before it", () => {
  const out = linkifyCode("Read it (`get_latest_bronze_data.sql:58`), then `run_query` (`:93`) and `:148-169`.", resolve);
  expect(hrefs(out)).toEqual([
    { file: files[0], from: 58, to: 58 },
    { file: files[0], from: 93, to: 93 },
    { file: files[0], from: 148, to: 169 },
  ]);
  expect(out).toContain("`run_query`"); // not a file: left alone
});

it("leaves an ambiguous base name as text, but takes a full relative path", () => {
  expect(linkifyCode("`deduplicate.sql:9`", resolve)).toBe("`deduplicate.sql:9`");
  expect(hrefs(linkifyCode("`models/a/deduplicate.sql:9`", resolve))).toEqual([{ file: files[2], from: 9, to: 9 }]);
});

it("in a step, 'lines 65-79' and `:12` mean the step's own file", () => {
  const out = linkifyCode("Lines 65-79 build it; `:93` runs it.", resolve, files[1]);
  expect(hrefs(out)).toEqual([{ file: files[1], from: 65, to: 79 }, { file: files[1], from: 93, to: 93 }]);
});

it("links file:line in plain text, and never touches fenced code", () => {
  const out = linkifyCode("see get_latest_bronze_data.sql:186-194\n```sql\nselect 1 -- deduplicate.sql:9\n```", resolve);
  expect(hrefs(out)).toEqual([{ file: files[0], from: 186, to: 194 }]);
  expect(out).toContain("```sql\nselect 1 -- deduplicate.sql:9\n```");
});

it("without a known file, bare lines stay text", () => {
  expect(linkifyCode("line 12 and `:4`", resolve)).toBe("line 12 and `:4`");
});

it("in a step, 'lines N' stays on the step's file even after another file is named", () => {
  const out = linkifyCode("Compare `get_latest_bronze_data.sql:58`. Lines 48-62 set it; `:9` is there.", resolve, files[1]);
  expect(hrefs(out)).toEqual([
    { file: files[0], from: 58, to: 58 },
    { file: files[1], from: 48, to: 62 }, // the step's own file
    { file: files[0], from: 9, to: 9 }, // a bare `:9` follows the file just named
  ]);
});

it("shows a long cited path as its file name", () => {
  const out = linkifyCode("(`macros/get_latest_bronze_data.sql:55-91`)", resolve);
  expect(out.startsWith("([`get_latest_bronze_data.sql:55-91`](code:")).toBe(true);
});
