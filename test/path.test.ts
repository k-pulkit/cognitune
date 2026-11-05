import { expect, it } from "vitest";
import { shortPath } from "../web/src/lib/path";

it("shortPath keeps short paths and folds long ones zsh style", () => {
  expect(shortPath("src/cli.ts")).toBe("src/cli.ts");
  expect(shortPath("services/billing-api/packages/my_app/pyproject.toml")).toBe("s/b/p/m/pyproject.toml");
  expect(shortPath("/home/dev/repos/.github/workflows/build.yml", 10)).toBe("/h/d/r/.g/w/build.yml");
});
