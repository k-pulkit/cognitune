import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createApi } from "./server/app.js";
import { Store } from "./core/store.js";

const HELP = `groklab - understand any codebase

Usage: groklab [folder] [options]

  folder           Folder to open (default: show the project list)
  --port <n>       Port (default 4711, or GROKLAB_PORT)
  --host <addr>    Address to bind (default 127.0.0.1)
  --no-open        Do not open the browser
  -h, --help       Show this help

Data lives in ~/.groklab (GROKLAB_HOME). Your folders are never written.
Model: the claude CLI if installed, else ANTHROPIC_API_KEY. GROKLAB_AGENT=fake for a demo without a model.`;

function parseArgs(argv: string[]) {
  const out = { folder: "", port: Number(process.env.GROKLAB_PORT) || 4711, host: "127.0.0.1", open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      console.log(HELP);
      process.exit(0);
    } else if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--host") out.host = argv[++i];
    else if (a === "--no-open") out.open = false;
    else if (!a.startsWith("-")) out.folder = a;
    else {
      console.error(`unknown option: ${a}\n\n${HELP}`);
      process.exit(2);
    }
  }
  return out;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

/** Built web app: dist/web next to this file when installed, or ../dist/web when run from source. */
function webDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const d of [join(here, "web"), join(here, "..", "dist", "web")]) if (existsSync(join(d, "index.html"))) return d;
  return null;
}

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    /* no browser; the URL is printed */
  }
}

const opts = parseArgs(process.argv.slice(2));
const store = new Store();
const app = new Hono();
app.route("/api", createApi(store));

const web = webDir();
app.get("*", (c) => {
  if (!web) return c.text("Web app not built. Run `npm run build`, or `npm run dev` and open http://localhost:5173.", 503);
  const rel = decodeURIComponent(new URL(c.req.url).pathname).replace(/^\/+/, "");
  const file = resolve(web, rel);
  // Unknown paths are client routes: serve index.html.
  const target = file.startsWith(web) && existsSync(file) && statSync(file).isFile() ? file : join(web, "index.html");
  const type = MIME[extname(target)] ?? "application/octet-stream";
  const cache = target.includes(`${join(web, "assets")}`) ? "public, max-age=31536000, immutable" : "no-cache";
  return c.body(readFileSync(target), 200, { "content-type": type, "cache-control": cache });
});

let path = "/";
if (opts.folder) {
  const root = resolve(opts.folder);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`not a folder: ${root}`);
    process.exit(2);
  }
  path = `/p/${store.openProject(root).id}/explore`;
}

serve({ fetch: app.fetch, port: opts.port, hostname: opts.host }, (info) => {
  const url = `http://${opts.host === "0.0.0.0" ? "localhost" : opts.host}:${info.port}${path}`;
  console.log(`groklab running at ${url}\ndata: ${store.home}\nCtrl+C to stop.`);
  if (opts.open && web) openBrowser(url);
});
