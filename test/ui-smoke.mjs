// Browser smoke test: drives every page end to end against a running server with LEARNFORGE_AGENT=fake.
//
//   LEARNFORGE_HOME=$(mktemp -d) LEARNFORGE_AGENT=fake node dist/cli.js . --port 4799 --no-open &
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
await page.getByRole("heading", { name: "learnforge" }).waitFor();
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
await page.getByText(/^Walkthrough/).waitFor();
ok(await page.getByText("How src/core/prompts.ts works").isVisible(), "lens page shows the title");
ok(await page.getByText("In one sentence").isVisible(), "lens opens with the one-sentence idea");
await page.getByText("Think first, then show the answer").first().click();
await page.getByText("It does the thing.").waitFor();
ok(true, "a step's check-yourself answer reveals");
ok((await page.locator("li.lens-step .code-view .line").count()) > 0, "steps show their own lines of code");
await page.getByRole("button", { name: "One at a time" }).click();
await page.getByText("Step 1 of 4").waitFor();
ok(true, "one-step-at-a-time mode");
await page.getByRole("button", { name: "All steps" }).click();
await page.locator(".prose-g svg").first().waitFor({ timeout: 15000 }).catch(() => {});
ok((await page.locator(".prose-g svg").count()) > 0, "mermaid diagram rendered");
await page.getByRole("button", { name: "open file" }).nth(1).click();
await page.locator(".code-view .line.hl").first().waitFor();
ok(true, "a step opens the whole file at its line");
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
// The ref list loads in the background (a git log read); give it real time on a loaded CI runner.
for (let i = 0; i < 300 && (await page.locator("[data-i]").count()) !== 1; i++) await page.waitForTimeout(100);
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


// ---- learning features -------------------------------------------------
const P = `${url}/p/${pid}`;
const openExplore = async (act) => {
  await page.goto(`${P}/explore${act ? `?do=${act}` : ""}`);
  await page.getByPlaceholder("Filter files").first().waitFor();
};
const pickFile = async (name) => {
  await page.getByPlaceholder("Filter files").first().fill(name);
  await page.getByText(name, { exact: true }).first().click();
  await page.locator(".code-view .line").first().waitFor();
};

// Today
await page.goto(`${P}/today`);
await page.getByRole("heading", { name: "Today" }).waitFor();
ok(await page.getByText("Review cards").first().isVisible(), "today shows the review card box");
await shot("13-today");

// Review: the quiz misses above became cards
await page.goto(`${P}/review`);
await page.getByRole("button", { name: /Reveal/ }).waitFor();
ok(true, "review shows a due card from a quiz miss");
await page.keyboard.press("Space");
await page.getByRole("button", { name: /^Good/ }).waitFor();
await shot("14-review");
await page.getByRole("button", { name: /^Good/ }).click();
await page.waitForTimeout(300);
ok(true, "rating a card moves on");

// Lens with my take first, then the trace lens
await openExplore();
await pickFile("backoff.ts").catch(async () => pickFile("prompts.ts"));
await page.getByText("My take first").click();
await page.getByPlaceholder(/In 2-3 lines/).fill("It builds prompts for each task.");
await page.getByRole("button", { name: "Make the lens" }).click();
await page.waitForURL(/\/lens\//, { timeout: 30000 });
await page.getByText(/where it differs/).waitFor();
ok(await page.getByText(/you missed the error path/).isVisible(), "sketch-first lens shows the differences");
await openExplore();
await page.getByRole("button", { name: /Trace a run/ }).click();
await page.getByPlaceholder(/e\.g\. add\(3\)/).fill("n = 3");
await page.getByRole("button", { name: "Make the lens" }).click();
await page.waitForURL(/\/lens\//, { timeout: 30000 });
await page.getByText("Step 1: line 1 runs.").waitFor();
await page.getByRole("button", { name: "Next step" }).click();
await page.getByText("Step 2: line 2 runs.").waitFor();
ok(true, "trace lens steps forward");
await shot("15-trace");

// Teach back
await openExplore("teach");
await page.getByPlaceholder(/What does this code do, how/).fill("It builds the system and user prompts for each model task and parses the JSON reply from the last fence.");
await page.getByRole("button", { name: "Grade my explanation" }).click();
await page.waitForURL(/\/teach\//, { timeout: 30000 });
await page.getByText("Fake teach-back grade.").waitFor();
ok(true, "teach-back is graded");
await shot("16-teach");

// Tutor
await openExplore("tutor");
await page.getByPlaceholder(/Why does this return early/).fill("Why is the last fence used?");
await page.getByRole("button", { name: "Ask the tutor" }).click();
await page.waitForURL(/\/tutor\//, { timeout: 30000 });
await page.getByText("What do you see on line 2?").first().waitFor();
await page.getByRole("button", { name: "Just tell me" }).click();
await page.getByText(/Here is the answer/).waitFor({ timeout: 30000 });
ok(true, "tutor hints first, tells on request");
await shot("17-tutor");

// Walk
await openExplore("walk");
await page.getByRole("button", { name: "Walk me through it" }).click();
await page.waitForURL(/\/walk\//, { timeout: 30000 });
await page.getByPlaceholder(/Your answer, from the block/).fill("it imports the shared types it needs");
await page.getByRole("button", { name: "Check" }).click();
await page.getByText(/Fake check/).waitFor({ timeout: 30000 });
ok(true, "walk block is checked");
await shot("18-walk");

// Bug hunt
await openExplore("hunt");
await page.getByRole("button", { name: "Start the hunt" }).click();
await page.waitForURL(/\/hunt\//, { timeout: 30000 });
await page.locator(".code-view .line").first().click();
await page.getByPlaceholder(/What is wrong/).fill("the first line changed");
await page.getByRole("button", { name: "Check my hunt" }).click();
await page.getByRole("heading", { name: "Found" }).waitFor({ timeout: 30000 });
ok(true, "bug hunt finds the planted bug");
await shot("19-hunt");

// Notes: click a line, add a note
await openExplore("notes");
await page.locator(".code-view .line").nth(4).click();
await page.getByPlaceholder(/Click a line in the code/).fill("my note");
await page.getByRole("button", { name: "Add note" }).click();
await page.getByText("line 5").first().waitFor();
ok(true, "a note pins to the clicked line");

// Weak spots quiz
await openExplore("quiz");
await page.getByRole("button", { name: "Quiz my weak spots" }).click();
await page.waitForURL(/\/quiz\//, { timeout: 30000 });
await page.getByText("weak spots").first().waitFor();
ok(true, "weak-spot quiz opens");

// Map, paths, glossary, heatmap, palette
await page.goto(`${P}/map`);
await page.getByText("Most depended on").waitFor({ timeout: 30000 });
const allNodes = await page.locator("svg circle").count();
ok(allNodes > 5, "map draws the import graph");
await page.getByPlaceholder("Filter files").fill("agent");
await page.locator("input[type=checkbox][title^='Tick all']").first().check();
await page.getByText(/files ticked/).waitFor();
await page.waitForTimeout(300);
const fewer = await page.locator("svg circle").count();
ok(fewer > 0 && fewer < allNodes, `ticking a folder narrows the map (${allNodes} -> ${fewer})`);
await page.getByRole("button", { name: "clear" }).click();
await shot("20-map");
await page.goto(`${P}/paths`);
await page.getByRole("button", { name: "Make a path" }).click();
await page.waitForURL(/\/paths\/[a-z0-9]+$/, { timeout: 30000 });
await page.getByText("Stop 1", { exact: false }).first().waitFor();
ok(true, "a learning path is made");
await shot("21-path");
await page.goto(`${P}/library?tab=glossary`);
await page.getByText("Entry point").first().waitFor();
ok(true, "glossary lists lens concepts");
await page.goto(`${P}/progress`);
await page.getByRole("button", { name: "Whole repo" }).click();
await page.locator("button[title*='understood'], button[title*='seen']").first().waitFor();
ok(true, "progress heatmap shows the repo");
await shot("22-heatmap");
await page.keyboard.press("Control+k");
await page.getByPlaceholder(/Type a page/).fill("map");
await page.keyboard.press("Enter");
await page.waitForURL(/\/map$/);
ok(true, "command palette jumps to a page");

await page.goto(`${url}/settings`);
await page.getByRole("button", { name: "Clean up now" }).click();
await page.getByText(/Removed \d+ item/).waitFor();
ok(true, "storage cleanup runs from settings");
await shot("23-storage");

await page.goto(`${url}/settings`);
await page.getByText("Model ready: fake").waitFor();
ok(true, "settings shows the model");
await shot("10-settings");

await browser.close();
const real = errors.filter((e) => !/favicon/.test(e));
ok(real.length === 0, `no console errors${real.length ? ":\n  " + real.join("\n  ") : ""}`);
process.exit(failed ? 1 : 0);
