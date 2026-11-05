import { expect, it } from "vitest";
import { shortPath } from "../web/src/lib/path";

it("shortPath keeps short paths and folds long ones zsh style", () => {
  expect(shortPath("src/cli.ts")).toBe("src/cli.ts");
  expect(shortPath("frameworks/cot-frameworks/packages/castellum_next/pyproject.toml")).toBe("f/c/p/c/pyproject.toml");
  expect(shortPath("/home/pkapoor/repos/.github/workflows/build.yml", 10)).toBe("/h/p/r/.g/w/build.yml");
});
