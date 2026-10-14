/**
 * Static snapshot of the running app for GitHub Pages (read-only demo).
 *
 *   NEXT_PUBLIC_STATIC_DEMO=1 NEXT_BASE_PATH=/procurement-intelligence npm run build
 *   NEXT_PUBLIC_STATIC_DEMO=1 NEXT_BASE_PATH=/procurement-intelligence npm start &
 *   NEXT_BASE_PATH=/procurement-intelligence node scripts/snapshot.mjs
 *
 * Crawls every page reachable from the home page (demo data) and writes it to
 * ./out (or SNAPSHOT_OUT) as <path>/index.html, with .next/static and public/
 * alongside. The workflow runs it once per language: English at the root,
 * Italian under /it.
 *
 * GitHub Pages ignores what follows "?" in an address, and every filter of the
 * app lives there (/products?status=action). So each filtered page reached by
 * a link — or by a choice that says where it leads (`data-demo-href`, see
 * lib/static-demo.ts) — is saved apart, at <path>/__q/<hash>/index.html, and
 * every page gets a small script at the top of its head: when the address asks
 * for filters, it shows the saved page that has them (the closest one when the
 * exact combination was not saved; StaticDemoView says so). The words of a
 * search are never saved: StaticDemoView filters the rows in the browser.
 *
 * Also saved: the exports (`data-demo-file`, at the path `demoFile()` gives)
 * and what the search box looks through (/search/data → search-data.json).
 * Forms and imports need the server: they don't work in the snapshot.
 */
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.NEXT_BASE_PATH ?? "";
const ORIGIN = process.env.SNAPSHOT_ORIGIN ?? "http://localhost:3100";
const OUT = path.resolve(process.env.SNAPSHOT_OUT ?? "out");
const MAX_PAGES = Number(process.env.SNAPSHOT_MAX_PAGES ?? 1000);
/** Filtered pages: how many in all, and how many filters at once (a status and a view, a view and a supplier…). */
const MAX_VARIANTS = Number(process.env.SNAPSHOT_MAX_VARIANTS ?? 1500);
const MAX_FILTERS = Number(process.env.SNAPSHOT_MAX_FILTERS ?? 2);
// Route handlers and data endpoints: not pages. The supplier portal and the sign-in page need a server: not in the demo.
const SKIP = [/^\/export\//, /^\/documents\//, /^\/search(\/|$)/, /^\/_next\//, /^\/portal(\/|$)/, /^\/login(\/|$)/];
/** Parameters never saved as pages: the words of a search (filtered in the browser) and dates typed by hand. */
const UNSAVED = new Set(["q", "from", "to"]);

/** The name of a saved filtered page: the same function runs here and in the pages' script. */
function demoHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** A query as one key: parameters sorted, empty ones dropped. */
function keyOf(search) {
  const pairs = [...new URLSearchParams(search)].filter(([, v]) => v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return new URLSearchParams(pairs).toString();
}

/**
 * Runs at the top of every saved page, before anything else: the page the
 * address asks for is the saved page whose filters are all asked for, the
 * most of them. When that is not the page being read, it is loaded in its place.
 */
function demoView(known, loaded, route) {
  window.__demoLoaded = loaded;
  var want = {};
  new URLSearchParams(location.search).forEach(function (v, k) {
    if (v && k !== "q") want[k] = v;
  });
  var best = "", size = -1;
  for (var i = 0; i < known.length; i++) {
    var ok = true, n = 0;
    new URLSearchParams(known[i]).forEach(function (v, k) {
      n++;
      if (want[k] !== v) ok = false;
    });
    if (ok && n > size) {
      best = known[i];
      size = n;
    }
  }
  if (best === loaded) return;
  // The rest of this page becomes inert text (no script runs, nothing loads), and the page asked for takes its place.
  // Not window.stop(): after it, Chrome ignores document.open().
  document.write('<plaintext style="display:none">');
  fetch(route + (best ? "/__q/" + demoHash(best) : "") + "/")
    .then(function (r) {
      return r.text();
    })
    .then(function (html) {
      document.open();
      document.write(html);
      document.close();
    });
}

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

/** Every address of the app in a page: links, and choices that say where they lead. */
function addressesOf(html) {
  const found = [];
  for (const [, href] of html.matchAll(/(?:href|data-demo-href)="([^"]+)"/g)) {
    const url = href.replaceAll("&amp;", "&");
    if (!url.startsWith(`${BASE}/`)) continue;
    const [route, search = ""] = url.slice(BASE.length).split("#")[0].split("?");
    if (!SKIP.some((re) => re.test(route || "/"))) found.push({ route: route.replace(/\/$/, "") || "/", search });
  }
  return found;
}

/** The exports a page offers: where the demo serves them, and the address the app answers. */
function exportsOf(html) {
  return [...html.matchAll(/href="([^"]+)"[^>]*?data-demo-file="([^"]+)"/g)].map(([, file, source]) => ({ file: file.replaceAll("&amp;", "&"), source: source.replaceAll("&amp;", "&") }));
}

const fileOf = (route, key) => path.join(OUT, route === "/" ? "" : decodeURIComponent(route), key ? path.join("__q", demoHash(key)) : "", "index.html");

await waitForServer();
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// Start from every page without parameters, then follow links to the others.
const pages = (await readdir("src/app", { recursive: true }))
  .filter((f) => path.basename(f) === "page.tsx" && !f.includes("["))
  // A folder in brackets groups routes and is no part of the address: "(workspace)/products" is "/products".
  .map((f) => "/" + path.dirname(f).split(path.sep).filter((part) => part !== "." && !/^\(.*\)$/.test(part)).join("/"))
  .map((route) => route.replace(/\/$/, "") || "/")
  .filter((route) => !SKIP.some((re) => re.test(route)));
const seen = new Set(pages.map((route) => `${route}?`));
const queue = pages.map((route) => ({ route, key: "" }));
/** Per route, the filtered pages saved: what each page's script chooses from. */
const saved = new Map();
const exports = new Map();
let count = 0;
let variants = 0;
while (queue.length && count < MAX_PAGES + MAX_VARIANTS) {
  const { route, key } = queue.shift();
  const res = await fetch(`${ORIGIN}${BASE}${route === "/" ? "/" : route}${key ? `?${key}` : ""}`);
  if (!res.ok || !res.headers.get("content-type")?.includes("text/html")) {
    console.warn(`skip ${route}${key ? `?${key}` : ""} (${res.status})`);
    continue;
  }
  const html = await res.text();
  const file = fileOf(route, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html);
  saved.set(route, [...(saved.get(route) ?? []), key]);
  count++;
  for (const e of exportsOf(html)) exports.set(e.file, e.source);
  for (const next of addressesOf(html)) {
    const nextKey = keyOf(next.search);
    const params = [...new URLSearchParams(nextKey).keys()];
    if (params.some((p) => UNSAVED.has(p)) || params.length > MAX_FILTERS) continue;
    const id = `${next.route}?${nextKey}`;
    if (seen.has(id)) continue;
    if (nextKey && variants >= MAX_VARIANTS) continue;
    if (!nextKey && count >= MAX_PAGES) continue;
    seen.add(id);
    if (nextKey) variants++;
    queue.push({ route: next.route, key: nextKey });
  }
}

// The script at the top of each page, with the filtered pages of its route.
for (const [route, keys] of saved) {
  const known = JSON.stringify(keys);
  const at = JSON.stringify(`${BASE}${route === "/" ? "" : route}`);
  for (const key of keys) {
    const file = fileOf(route, key);
    const html = await readFile(file, "utf8");
    const script = `<script>${demoHash.toString()}${demoView.toString()}demoView(${known},${JSON.stringify(key)},${at});</script>`;
    await writeFile(file, html.replace(/<head[^>]*>/, (head) => head + script));
  }
}

// Exports: one file each, where the pages link them.
for (const [file, source] of exports) {
  const res = await fetch(`${ORIGIN}${BASE}${source}`);
  if (!res.ok) {
    console.warn(`skip export ${source} (${res.status})`);
    continue;
  }
  const target = path.join(OUT, decodeURIComponent(file.slice(BASE.length)));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(await res.arrayBuffer()));
}

// What the search box looks through.
const corpus = await fetch(`${ORIGIN}${BASE}/search/data`);
if (corpus.ok) await writeFile(path.join(OUT, "search-data.json"), await corpus.text());
else console.warn(`skip search data (${corpus.status})`);

const notFound = await fetch(`${ORIGIN}${BASE}/__snapshot_404__`);
await writeFile(path.join(OUT, "404.html"), await notFound.text());
await cp(".next/static", path.join(OUT, "_next/static"), { recursive: true });
await cp("public", OUT, { recursive: true });
await writeFile(path.join(OUT, ".nojekyll"), "");
const filtered = [...saved.values()].flat().filter(Boolean).length;
console.log(`Snapshot: ${count - filtered} pages, ${filtered} filtered pages, ${exports.size} exports in ${OUT}`);
