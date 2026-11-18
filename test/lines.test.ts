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
