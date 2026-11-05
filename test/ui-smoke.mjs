// Browser smoke test: drives every page end to end against a running server with GROKLAB_AGENT=fake.
//
//   GROKLAB_HOME=$(mktemp -d) GROKLAB_AGENT=fake node dist/cli.js . --port 4799 --no-open &
//   node test/ui-smoke.mjs [--url http://127.0.0.1:4799] [--shots DIR] [--dark]
//
// Needs a Chromium: CHROME=/path/to/chrome, else the newest one in ~/.cache/ms-playwright.
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
};
const url = arg("--url", "http://127.0.0.1:4799");
const shots = arg("--shots", "");
const dark = process.argv.includes("--dark");

function chrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), ".cache", "ms-playwright");
  const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium-")).sort().reverse() : [];
  for (const d of dirs) {
    const p = join(cache, d, "chrome-linux64", "chrome");
    if (existsSync(p)) return p;
  }
  throw new Error("no Chromium found; set CHROME");
}

const errors = [];
let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failed++;
};

const browser = await chromium.launch({ executablePath: chrome() });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: dark ? "dark" : "light" });
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.request().method()} ${r.url()}`));
const shot = async (name) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `${name}${dark ? "-dark" : ""}.png`) });
};

// Projects
await page.goto(url);
await page.getByRole("heading", { name: "groklab" }).waitFor();
ok(await page.getByText("Open a folder").isVisible(), "projects page shows 'Open a folder'");
await shot("1-projects");
const projects = await (await page.request.get(`${url}/api/projects`)).json();
ok(projects.length > 0, "a project is listed");
const pid = projects[0].id;

// Explore: open a file, make a lens
await page.goto(`${url}/p/${pid}/explore`);
await page.getByPlaceholder("Filter files").fill("prompts.ts");
await page.getByText("prompts.ts", { exact: true }).click();
await page.locator(".code-view .line").first().waitFor();
ok((await page.locator(".code-view .line").count()) > 50, "file opens in the viewer with lines");
await shot("2-explore");
await page.getByRole("button", { name: "Data flow" }).click();
await page.getByRole("button", { name: "Make the lens" }).click();
await page.getByText(/Reading the files|Finding the core idea/).waitFor();
ok(true, "job progress shows");
await page.waitForURL(/\/lens\//, { timeout: 30000 });
await page.getByText("Deep dives").waitFor();
ok(await page.getByText("How src/core/prompts.ts works").isVisible(), "lens page shows the title");
await page.locator(".prose-g svg").first().waitFor({ timeout: 15000 }).catch(() => {});
ok((await page.locator(".prose-g svg").count()) > 0, "mermaid diagram rendered");
await page.getByRole("button", { name: /The main logic/ }).click();
await page.locator(".code-view .line.hl").waitFor();
ok(true, "deep dive opens the code at the line");
await shot("3-lens");

// Quiz from the lens
await page.getByRole("button", { name: "Quiz me on this" }).click();
await page.waitForURL(/\/quiz\//, { timeout: 30000 });
const boxes = page.getByPlaceholder("Your answer, in your own words");
await boxes.first().waitFor();
const n = await boxes.count();
ok(n >= 1, `quiz shows ${n} questions`);
for (let i = 0; i < n; i++) await boxes.nth(i).fill(i === 0 ? "short" : "a long enough answer to count as right");
await page.getByRole("button", { name: "Sure" }).first().click();
await shot("4-quiz");
await page.getByRole("button", { name: /Grade my answers/ }).click();
await page.getByText("Score").waitFor({ timeout: 30000 });
ok(await page.getByText("A good answer:").first().isVisible(), "grades show a model answer");
await shot("5-graded");

// Practice
await page.goto(`${url}/p/${pid}/explore`);
await page.getByRole("button", { name: "Practice" }).click();
await page.getByRole("button", { name: "Make the practice" }).click();
await page.waitForURL(/\/practice\//, { timeout: 30000 });
await page.locator(".cm-content").waitFor();
ok(await page.getByText("HOLE 1", { exact: true }).isVisible(), "practice shows hole 1");
await page.getByText("Show a hint").click();
ok(await page.getByText("Look at the names.").isVisible(), "a hint opens");
await page.locator(".cm-content").click();
await page.keyboard.type("// my try");
await page.getByText("saved").waitFor();
await page.getByRole("button", { name: "Check my work" }).click();
await page.getByText("Fake review.").waitFor({ timeout: 30000 });
ok(true, "review shows");
await page.getByRole("button", { name: "Show original" }).click();
await page.locator(".code-view .line.hole").first().waitFor();
ok(true, "original shows with holes marked");
await shot("6-practice");

// Library, Progress, Changes, Settings
await page.goto(`${url}/p/${pid}/library`);
await page.getByText("How src/core/prompts.ts works").first().waitFor();
ok(true, "library lists the lens");
await shot("7-library");
await page.goto(`${url}/p/${pid}/progress`);
await page.getByRole("cell", { name: "src/core/prompts.ts" }).waitFor();
ok(true, "progress lists the file");
await shot("8-progress");
await page.goto(`${url}/p/${pid}/changes`);
await page.getByText(/files$/).first().waitFor();
ok(true, "changes page loads");
if (process.env.SMOKE_DIFF_DIR) {
  await page.getByText(process.env.SMOKE_DIFF_DIR, { exact: true }).waitFor();
  ok(true, "changed files show as a tree with folded folders");
}
await page.getByRole("button", { name: /^Working tree/ }).click();
await page.getByPlaceholder("Type to filter").fill("groklab 0.1");
ok((await page.locator("[data-i]").count()) === 1, "typing filters the ref list");
await page.keyboard.press("Enter");
await page.getByRole("button", { name: /groklab 0\.1\.0/ }).waitFor();
ok(true, "Enter picks the filtered ref");
await page.getByRole("button", { name: /groklab 0\.1\.0/ }).click();
await page.getByPlaceholder("Type to filter").waitFor();
await shot("12-combobox");
await page.keyboard.press("Escape");
await shot("9-changes");
// Fold the file tree, peek it by hovering the rail, pin it back
await page.goto(`${url}/p/${pid}/explore`);
await page.getByPlaceholder("Filter files").waitFor();
await page.locator("[title^='Fold this pane']").first().click({ force: true });
ok(!(await page.getByPlaceholder("Filter files").isVisible()), "tree folds away");
await page.locator("[title^='Hover to peek, click to pin open']").first().hover();
await page.getByPlaceholder("Filter files").waitFor({ state: "visible" });
ok(true, "hovering the rail peeks the tree");
await page.locator("[title^='Hover to peek, click to pin open']").first().click();
await page.mouse.move(800, 400);
await page.waitForTimeout(400);
ok(await page.getByPlaceholder("Filter files").isVisible(), "click pins it open again");

await page.keyboard.press("[");
ok(!(await page.getByPlaceholder("Filter files").isVisible()), "[ folds the tree");
await page.keyboard.press("[");
ok(await page.getByPlaceholder("Filter files").isVisible(), "[ again brings it back");

// Add context from the picker; chips fold after 5
await page.getByRole("button", { name: "Lens" }).first().click();
await page.getByTitle(/Add files from the project/).click();
await page.getByRole("heading", { name: "Add context" }).waitFor();
const dialog = page.locator(".card", { has: page.getByRole("heading", { name: "Add context" }) });
await dialog.getByPlaceholder("Filter files").fill("src/core");
await dialog.locator("input[type=checkbox]").first().check();
await dialog.getByRole("button", { name: /^Use \d+ files$/ }).click();
await page.getByRole("button", { name: /^\+\d+ more$/ }).waitFor();
ok(true, "picker adds files; chips fold after 5");
await page.getByRole("button", { name: /^\+\d+ more$/ }).click();
ok(await page.getByRole("button", { name: "show less" }).isVisible(), "chips expand");
await shot("11-context");

await page.goto(`${url}/settings`);
await page.getByText("Model ready: fake").waitFor();
ok(true, "settings shows the model");
await shot("10-settings");

await browser.close();
const real = errors.filter((e) => !/favicon/.test(e));
ok(real.length === 0, `no console errors${real.length ? ":\n  " + real.join("\n  ") : ""}`);
process.exit(failed ? 1 : 0);
