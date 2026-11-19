import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { isAbsolute, join } from "node:path";
import * as vscode from "vscode";

/**
 * cognitune in VS Code: the same app the `cognitune` CLI serves, shown in a panel.
 *
 * The extension finds a cognitune server on the configured port (127.0.0.1:4711 by default) or
 * starts the bundled one with VS Code's own Node. Reusing a running server matters: two servers
 * would write the same ~/.cognitune files. The panel is a webview holding the app in an iframe;
 * messages go both ways through the webview: "go to this page" in, "open this file" out.
 */

let out: vscode.OutputChannel;
let child: ChildProcess | undefined;
let panel: vscode.WebviewPanel | undefined;
let status: vscode.StatusBarItem;
let poll: NodeJS.Timeout | undefined;
/** Project id per folder, so a second command for the same folder skips the API call. */
const projectIds = new Map<string, string>();

/** The activity bar view: the commands as one-click rows, with the current file and cards due. */
class Actions implements vscode.TreeDataProvider<vscode.TreeItem> {
  due: number | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  refresh() {
    this.changed.fire();
  }
  getTreeItem(item: vscode.TreeItem) {
    return item;
  }
  getChildren(): vscode.TreeItem[] {
    const row = (label: string, icon: string, command: string, description?: string, tooltip?: string) => {
      const t = new vscode.TreeItem(label);
      t.iconPath = new vscode.ThemeIcon(icon);
      t.command = { title: label, command };
      t.description = description;
      t.tooltip = tooltip;
      return t;
    };
    const file = fileEditor()?.document.uri;
    const name = file?.scheme === "file" ? file.path.split("/").pop() : undefined;
    const folder = vscode.workspace.workspaceFolders?.[0]?.name;
    return [
      row("Today", "home", "cognitune.open", folder, "What to review, what changed, where to go next"),
      row("Explain this file", "lightbulb", "cognitune.explain", name ?? "open a file first", "A lens on the open file; the result opens in the panel"),
      row("Quiz me on this file", "checklist", "cognitune.quiz", name, "Questions that check you understood the open file"),
      row("Open this file in cognitune", "eye", "cognitune.lensFile", undefined, "Every lens and activity for the open file"),
      row("Quiz me on uncommitted changes", "git-compare", "cognitune.quizChanges", undefined, "The diff of your working tree, ready for a lens or a quiz"),
      row("Review cards", "mortar-board", "cognitune.review", this.due ? `${this.due} due` : this.due === 0 ? "none due" : undefined, "Spaced review of what you learned"),
    ];
  }
}
const actions = new Actions();

/**
 * The last file editor. With the cognitune panel focused there is no active text editor, but
 * "Lens this file" from the sidebar should still mean the file you were just in.
 */
let lastEditor: vscode.TextEditor | undefined;
const fileEditor = () => {
  const e = vscode.window.activeTextEditor;
  return e?.document.uri.scheme === "file" ? e : lastEditor;
};

const port = () => vscode.workspace.getConfiguration("cognitune").get<number>("port", 4711);
const base = () => `http://127.0.0.1:${port()}`;

async function fetchJson<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const r = await fetch(base() + path, { ...init, signal: AbortSignal.timeout(init?.timeoutMs ?? 5000) });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error || `${r.status} ${r.statusText}`);
  return data;
}

async function alive(timeoutMs = 3000): Promise<boolean> {
  try {
    return (await fetchJson<{ ok?: boolean }>("/api/health", { timeoutMs })).ok === true;
  } catch {
    return false;
  }
}

/**
 * A server on the port: the one already running, or the bundled one started now. The sidebar,
 * the status bar and a command can all ask at once, so they share one start.
 */
let starting: Promise<void> | undefined;
function ensureServer(ctx: vscode.ExtensionContext): Promise<void> {
  starting ??= startServer(ctx).finally(() => (starting = undefined));
  return starting;
}

async function startServer(ctx: vscode.ExtensionContext): Promise<void> {
  if (await alive()) return;
  // Our server is still running, so it is busy, not gone: a big folder can keep it from
  // answering for a while. Wait for it; killing it here would drop work it is doing.
  if (child && child.exitCode === null) {
    for (let i = 0; i < 8; i++) if (await alive(5000)) return;
    throw new Error("the cognitune server is running but not answering (see Output > cognitune)");
  }
  const cli = join(ctx.extensionPath, "server", "cli.mjs");
  out.appendLine(`starting ${cli} on port ${port()}`);
  // ELECTRON_RUN_AS_NODE turns VS Code's own binary into plain Node, so the user needs no Node install.
  child = spawn(process.execPath, [cli, "--port", String(port()), "--no-open"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d) => out.append(String(d)));
  child.stderr?.on("data", (d) => out.append(String(d)));
  const started = child;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("cognitune server did not start within 20s (see Output > cognitune)")), 20_000);
    const done = (err?: Error) => {
      clearTimeout(timer);
      started.stdout?.off("data", onData);
      if (err) reject(err);
      else resolve();
    };
    const onData = (d: Buffer) => String(d).includes("cognitune running at") && done();
    started.stdout?.on("data", onData);
    started.on("error", (e) => done(e));
    started.on("exit", (code, signal) =>
      done(new Error(`cognitune server stopped (${signal ?? `exit ${code}`}). Is port ${port()} used by something else? Change cognitune.port, or see Output > cognitune.`)));
  });
}

/** The folder to open as a project: the one holding `uri`, else the only (or a picked) workspace folder. */
async function folderFor(uri?: vscode.Uri): Promise<string | undefined> {
  if (uri) {
    const f = vscode.workspace.getWorkspaceFolder(uri);
    if (f) return f.uri.fsPath;
  }
  const all = vscode.workspace.workspaceFolders ?? [];
  if (all.length <= 1) return all[0]?.uri.fsPath;
  return (await vscode.window.showWorkspaceFolderPick({ placeHolder: "Open which folder in cognitune?" }))?.uri.fsPath;
}

async function projectId(root: string): Promise<string> {
  const known = projectIds.get(root);
  if (known) return known;
  const p = await fetchJson<{ id: string }>("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ root }),
  });
  projectIds.set(root, p.id);
  return p.id;
}

/** Show the app at `path` (e.g. /p/<id>/today): move the open panel there, or open a new one. */
async function show(ctx: vscode.ExtensionContext, path: string) {
  if (panel) {
    panel.reveal(undefined, true);
    void panel.webview.postMessage({ cognitune: { type: "navigate", to: path } });
    return;
  }
  // asExternalUri maps the port when VS Code runs remote (WSL, SSH, containers); locally it is a no-op.
  const origin = (await vscode.env.asExternalUri(vscode.Uri.parse(base()))).toString(true).replace(/\/$/, "");
  panel = vscode.window.createWebviewPanel("cognitune", "cognitune", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false }, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [],
  });
  panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "icon.png");
  panel.webview.html = page(origin, path);
  panel.onDidDispose(() => (panel = undefined));
  panel.webview.onDidReceiveMessage((m) => onAppMessage(m?.cognitune));
}

/** The webview: one full-size iframe, and a relay between it and the extension. */
function page(origin: string, path: string): string {
  const nonce = randomBytes(16).toString("base64");
  const src = origin + path;
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
<style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100%;overflow:hidden;display:block}</style>
</head><body>
<iframe id="app" src="${src}" allow="clipboard-read; clipboard-write"></iframe>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  window.addEventListener("message", (e) => {
    if (!e.data || !e.data.cognitune) return;
    // From the app (the iframe): pass up to the extension. Anything else came from the extension.
    if (e.source === app.contentWindow) vscode.postMessage(e.data);
    else if (e.origin.startsWith("vscode-webview:")) app.contentWindow.postMessage(e.data, ${JSON.stringify(origin)});
  });
</script>
</body></html>`;
}

/** "Open this file at this line", sent by the app's "open in editor" buttons. */
async function onAppMessage(m: { type?: string; path?: unknown; line?: unknown } | undefined) {
  if (m?.type !== "reveal" || typeof m.path !== "string" || !isAbsolute(m.path)) return;
  const line = typeof m.line === "number" && m.line > 0 ? m.line - 1 : 0;
  const pos = new vscode.Position(line, 0);
  try {
    await vscode.window.showTextDocument(vscode.Uri.file(m.path), {
      viewColumn: vscode.ViewColumn.One,
      selection: new vscode.Range(pos, pos),
      preview: false,
    });
  } catch (e) {
    void vscode.window.showErrorMessage(`cognitune: could not open ${m.path}: ${(e as Error).message}`);
  }
}

/** Status bar: review cards due in the current project; click to review. */
function watchDue(ctx: vscode.ExtensionContext, id: string) {
  const update = async () => {
    try {
      const due = await fetchJson<unknown[]>(`/api/projects/${id}/cards/due`);
      actions.due = due.length;
      actions.refresh();
      status.text = due.length ? `$(mortar-board) ${due.length} due` : "$(mortar-board) cognitune";
      status.tooltip = due.length ? `${due.length} review card${due.length === 1 ? "" : "s"} due. Click to review.` : "Open cognitune";
      status.command = { title: "Review", command: "cognitune.review" };
      status.show();
    } catch {
      status.hide(); // server gone; the next command starts it again
    }
  };
  if (poll) clearInterval(poll);
  void update();
  poll = setInterval(update, 5 * 60_000);
  ctx.subscriptions.push({ dispose: () => poll && clearInterval(poll) });
}

/** Run a command body with the server up and the folder's project open; errors become a message. */
function command(ctx: vscode.ExtensionContext, body: (id: string, arg?: unknown, all?: unknown) => Promise<string | undefined>) {
  // From the Explorer, VS Code passes the clicked item and then every selected item.
  return async (arg?: unknown, all?: unknown) => {
    try {
      const uri = arg instanceof vscode.Uri ? arg : (arg as { rootUri?: vscode.Uri })?.rootUri ?? fileEditor()?.document.uri;
      const root = await folderFor(uri);
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "cognitune" }, () => ensureServer(ctx));
      if (!root) return show(ctx, "/");
      const id = await projectId(root);
      watchDue(ctx, id);
      const path = await body(id, arg, all);
      if (path) await show(ctx, path);
    } catch (e) {
      void vscode.window.showErrorMessage(`cognitune: ${(e as Error).message}`, "Show log").then((a) => a && out.show());
    }
  };
}

/** Most files one activity takes; more would not fit a model's context. */
const MAX_FILES = 200;
/** Folders expand to their files, minus what is never worth reading (on top of files.exclude). */
const SKIP = "**/{node_modules,.git,dist,build,out,.venv,venv,__pycache__,.next,coverage,target}/**";

/** The files a menu command is about: the Explorer selection (folders expanded), or the active file. */
async function filesOf(arg: unknown, all: unknown): Promise<string[]> {
  const uris = (Array.isArray(all) && all.length ? all : [arg instanceof vscode.Uri ? arg : fileEditor()?.document.uri])
    .filter((u): u is vscode.Uri => u instanceof vscode.Uri && u.scheme === "file");
  const files: string[] = [];
  for (const u of uris) {
    const stat = await vscode.workspace.fs.stat(u);
    if (stat.type & vscode.FileType.Directory) {
      const found = await vscode.workspace.findFiles(new vscode.RelativePattern(u, "**/*"), SKIP, MAX_FILES);
      files.push(...found.map((f) => f.fsPath).sort());
    } else files.push(u.fsPath);
  }
  return [...new Set(files)].slice(0, MAX_FILES);
}

interface Job { id: string; status: "running" | "done" | "failed"; resultId?: string; error?: string }

/**
 * Start a model job the way the app does (POST, then poll), with progress in a notification,
 * and open the result in the panel when it is done. Cancel stops waiting, not the job: the app
 * shows it in its status bar when it finishes.
 */
async function runJob(ctx: vscode.ExtensionContext, id: string, what: string, path: string, body: object, route: string) {
  const job = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `cognitune: ${what}`, cancellable: true },
    async (progress, cancel) => {
      let j = await fetchJson<Job>(`/api/projects/${id}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        timeoutMs: 30_000,
      });
      const t0 = Date.now();
      while (j.status === "running" && !cancel.isCancellationRequested) {
        await new Promise((r) => setTimeout(r, 1500));
        j = await fetchJson<Job>(`/api/jobs/${j.id}`);
        progress.report({ message: `${Math.round((Date.now() - t0) / 1000)}s` });
      }
      return j;
    },
  );
  if (job.status === "failed") throw new Error(job.error ?? `${what} failed`);
  if (job.status === "done" && job.resultId) await show(ctx, `/p/${id}/${route}/${job.resultId}`);
}

const plural = (n: number) => (n === 1 ? "1 file" : `${n} files`);

export function activate(ctx: vscode.ExtensionContext) {
  out = vscode.window.createOutputChannel("cognitune");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  ctx.subscriptions.push(out, status);

  const reg = (name: string, fn: (arg?: unknown) => Promise<void>) => ctx.subscriptions.push(vscode.commands.registerCommand(name, fn));

  const view = vscode.window.createTreeView("cognitune.actions", { treeDataProvider: actions });
  lastEditor = fileEditor();
  ctx.subscriptions.push(view, vscode.window.onDidChangeActiveTextEditor((e) => {
    if (e?.document.uri.scheme === "file") lastEditor = e;
    actions.refresh();
  }));
  // Opening the view shows cards due, but only from a server that is already running: just
  // looking at the sidebar should not start one.
  const quietDue = async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || !(await alive())) return;
    try {
      watchDue(ctx, await projectId(root));
    } catch {
      /* the next command reports errors */
    }
  };
  ctx.subscriptions.push(view.onDidChangeVisibility((e) => e.visible && void quietDue()));
  if (view.visible) void quietDue();
  reg("cognitune.refresh", async () => {
    actions.refresh();
    await quietDue();
  });

  reg("cognitune.open", command(ctx, async (id) => `/p/${id}/today`));
  reg("cognitune.review", command(ctx, async (id) => `/p/${id}/review`));

  // From the editor (title or context menu), the Explorer, or the palette (the active editor).
  reg("cognitune.lensFile", command(ctx, async (id, arg) => {
    const editor = fileEditor();
    const uri = arg instanceof vscode.Uri ? arg : editor?.document.uri;
    if (!uri || uri.scheme !== "file") {
      void vscode.window.showInformationMessage("cognitune: open a file first.");
      return undefined;
    }
    const line = editor && editor.document.uri.toString() === uri.toString() ? editor.selection.active.line + 1 : undefined;
    return `/p/${id}/explore?open=${encodeURIComponent(uri.fsPath)}${line ? `&line=${line}` : ""}`;
  }));

  // Explorer, several items selected or a folder: all of them become the lens context (a folder
  // means the files under it). The app resolves folders against its own file tree.
  reg("cognitune.lensSelection", command(ctx, async (id, arg, all) => {
    const picked = (Array.isArray(all) && all.length ? all : [arg]).filter((u): u is vscode.Uri => u instanceof vscode.Uri && u.scheme === "file");
    if (!picked.length) return undefined;
    const q = new URLSearchParams();
    for (const u of picked) q.append("pick", u.fsPath);
    return `/p/${id}/explore?${q}`;
  }));

  // ---- The right-click "cognitune" menu: start an activity on the selected files directly. ----
  /** A menu command: resolve the files, run `start` (which starts a job), errors as a message. */
  const act = (name: string, start: (id: string, files: string[]) => Promise<void>) =>
    reg(name, command(ctx, async (id, arg, all) => {
      const files = await filesOf(arg, all);
      if (!files.length) {
        void vscode.window.showInformationMessage("cognitune: select a file or folder first.");
        return undefined;
      }
      await start(id, files);
      return undefined;
    }));
  const lens = (kind: string, label: string, extra: object = {}) => (id: string, files: string[]) =>
    runJob(ctx, id, `${label} · ${plural(files.length)}`, "lenses", { files, kind, ...extra }, "lens");

  act("cognitune.explain", lens("explain", "Explain"));
  act("cognitune.flow", lens("flow", "Data flow"));
  act("cognitune.failure", lens("failure", "Failure modes"));
  act("cognitune.lensPick", async (id, files) => {
    const kinds = await fetchJson<{ id: string; label: string; blurb: string }[]>("/api/lens-kinds");
    const own = { label: "$(comment) Ask your own question…", id: "custom", detail: "The lens answers one question you write" };
    const pick = await vscode.window.showQuickPick(
      [own, ...kinds.filter((k) => k.id !== "change").map((k) => ({ label: k.label, id: k.id, detail: k.blurb }))],
      { title: `Lens on ${plural(files.length)}`, placeHolder: "Pick a lens" },
    );
    if (!pick) return;
    if (pick.id !== "custom") return lens(pick.id, pick.label)(id, files);
    const question = await vscode.window.showInputBox({ title: "Your question", placeHolder: "e.g. What happens when a job fails twice?" });
    if (question?.trim()) await lens("custom", "Lens", { question: question.trim() })(id, files);
  });
  act("cognitune.quiz", (id, files) => runJob(ctx, id, `Quiz · ${plural(files.length)}`, "quizzes", { files }, "quiz"));
  act("cognitune.tutor", async (id, files) => {
    const text = await vscode.window.showInputBox({ title: "Ask the tutor", placeHolder: "What do you want to understand? It answers with hints, not the answer." });
    if (text?.trim()) await runJob(ctx, id, "Tutor", "threads", { files, text: text.trim() }, "tutor");
  });
  act("cognitune.teach", async (id, files) => {
    const text = await vscode.window.showInputBox({
      title: `Teach it back: explain ${plural(files.length)} in your own words`,
      placeHolder: "What it does, how, and why. The grader marks what you got right and what you missed.",
      validateInput: (v) => (v.trim().length < 20 ? "A sentence or two at least (20+ characters)" : undefined),
    });
    if (text?.trim()) await runJob(ctx, id, "Teach-back", "teachbacks", { files, text: text.trim() }, "teach");
  });
  act("cognitune.walk", (id, files) => runJob(ctx, id, "Walkthrough", "walks", { file: files[0] }, "walk"));
  act("cognitune.hunt", (id, files) => runJob(ctx, id, "Bug hunt", "hunts", { file: files[0], level: 1 }, "hunt"));
  act("cognitune.practice", (id, files) => runJob(ctx, id, `Practice · ${plural(files.length)}`, "practice", { files, level: 2 }, "practice"));

  // From the Source Control title bar: the arg is the repo's SourceControl, with its root.
  reg("cognitune.quizChanges", command(ctx, async (id, arg) => {
    const repo = (arg as { rootUri?: vscode.Uri })?.rootUri?.fsPath;
    return `/p/${id}/changes${repo ? `?repo=${encodeURIComponent(repo)}` : ""}`;
  }));
}

export function deactivate() {
  // Only the server this window started; one the user runs from a terminal stays up.
  if (child && child.exitCode === null) child.kill();
}
