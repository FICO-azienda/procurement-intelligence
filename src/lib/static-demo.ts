/**
 * The read-only demo on GitHub Pages (scripts/snapshot.mjs): saved HTML, no
 * server. Set at build time by the Pages workflow; empty everywhere else.
 * A plain module, so that server and client components read the same values.
 */
export const STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO === "1";
/** The app's base path (next.config.ts): plain links and fetches need it, `<Link>` adds it by itself. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
/** Where each language of the demo is published: the English pages at the root, the Italian ones under /it. */
export const DEMO_ROOT = process.env.NEXT_PUBLIC_DEMO_ROOT ?? "";
/** The repository the demo is built from: where to read how to run the app with one's own data. */
export const DEMO_REPO = process.env.NEXT_PUBLIC_DEMO_REPO ?? "";
/** Where the demo keeps what the search box looks through (written by the snapshot). */
export const DEMO_SEARCH_FILE = "/search-data.json";

/**
 * Where the demo keeps a file the server makes on request (an export): one
 * file per address, what follows "?" in its name, and the extension of what
 * the route answers. scripts/snapshot.mjs saves each one at this path.
 *
 *   /export/comparison?product=abc → /export/comparison-abc.csv
 */
export function demoFile(href: string): string {
  const [path, query = ""] = href.split("?");
  const ext = path.startsWith("/export/market/") ? ".xlsx" : path === "/export/data" ? ".ndjson" : ".csv";
  const values = [...new URLSearchParams(query).values()].filter(Boolean);
  return `${path}${values.length ? `-${values.join("-")}` : ""}${ext}`;
}

/**
 * A filter that is a choice (a select's option, a button), not a link: in the
 * demo it carries the address it leads to, so the snapshot can save that page
 * too. Nothing anywhere else.
 */
export function demoHref(pathname: string, params: URLSearchParams): { "data-demo-href"?: string } {
  if (!STATIC_DEMO) return {};
  const query = params.toString();
  return { "data-demo-href": `${BASE_PATH}${pathname}${query ? `?${query}` : ""}` };
}

/** The address with one parameter set (or taken off when empty). */
export function withParam(params: URLSearchParams | { toString(): string }, key: string, value: string | null): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}
