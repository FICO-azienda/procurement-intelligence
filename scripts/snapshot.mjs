/**
 * Static snapshot of the running app for GitHub Pages (read-only demo).
 *
 *   NEXT_BASE_PATH=/procurement-intelligence npm run build
 *   NEXT_BASE_PATH=/procurement-intelligence npm start &
 *   NEXT_BASE_PATH=/procurement-intelligence node scripts/snapshot.mjs
 *
 * Crawls every page reachable from the home page (demo data) and writes it to
 * ./out (or SNAPSHOT_OUT) as <path>/index.html, with .next/static and public/
 * alongside. The workflow runs it once per language: English at the root,
 * Italian under /it.
 * Forms, imports and downloads need the server: they don't work in the snapshot.
 */
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.NEXT_BASE_PATH ?? "";
const ORIGIN = process.env.SNAPSHOT_ORIGIN ?? "http://localhost:3100";
const OUT = path.resolve(process.env.SNAPSHOT_OUT ?? "out");
const MAX_PAGES = Number(process.env.SNAPSHOT_MAX_PAGES ?? 1000);
// Route handlers and data endpoints: not pages.
const SKIP = [/^\/export\//, /^\/documents\//, /^\/search(\/|$)/, /^\/_next\//];

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${ORIGIN}${BASE}/`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server not reachable at ${ORIGIN}${BASE}/`);
}

function linksOf(html) {
  const found = new Set();
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    const url = href.replaceAll("&amp;", "&");
    if (!url.startsWith(`${BASE}/`)) continue;
    const route = url.slice(BASE.length).split(/[?#]/)[0] || "/";
    if (!SKIP.some((re) => re.test(route))) found.add(route);
  }
  return found;
}

async function save(route, html) {
  const file = route === "/" ? path.join(OUT, "index.html") : path.join(OUT, decodeURIComponent(route), "index.html");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html);
}

await waitForServer();
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// Start from every page without parameters, then follow links to the others.
const pages = (await readdir("src/app", { recursive: true }))
  .filter((f) => path.basename(f) === "page.tsx" && !f.includes("["))
  .map((f) => "/" + path.dirname(f).split(path.sep).join("/").replace(/^\.$/, ""));
const seen = new Set(pages);
const queue = [...seen];
let saved = 0;
while (queue.length && saved < MAX_PAGES) {
  const route = queue.shift();
  const res = await fetch(`${ORIGIN}${BASE}${route}`);
  if (!res.ok || !res.headers.get("content-type")?.includes("text/html")) {
    console.warn(`skip ${route} (${res.status})`);
    continue;
  }
  const html = await res.text();
  await save(route, html);
  saved++;
  for (const next of linksOf(html)) {
    if (!seen.has(next)) {
      seen.add(next);
      queue.push(next);
    }
  }
}

const notFound = await fetch(`${ORIGIN}${BASE}/__snapshot_404__`);
await writeFile(path.join(OUT, "404.html"), await notFound.text());
await cp(".next/static", path.join(OUT, "_next/static"), { recursive: true });
await cp("public", OUT, { recursive: true });
await writeFile(path.join(OUT, ".nojekyll"), "");
console.log(`Snapshot: ${saved} pages in ${OUT}`);
