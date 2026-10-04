/**
 * Reads one public page — a supplier's own site — and returns its text.
 * It opens the page it is given and nothing else: no links followed, no
 * forms, no login. Scripts, styles and markup are dropped.
 */
import type { PageContent, PageReader } from "@/lib/sourcing/providers";
import { SourceError, httpGet } from "./http";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", egrave: "è", eacute: "é", agrave: "à", ograve: "ò", ugrave: "ù", igrave: "ì", uuml: "ü", ouml: "ö", auml: "ä", szlig: "ß", ntilde: "ñ", oacute: "ó", aacute: "á", iacute: "í" };
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);

/** The text a reader would see on an HTML page, with its title and the site's declared name. */
export function readHtml(html: string, url: string): PageContent {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const meta = (name: string) => new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i").exec(html)?.[1] ?? new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, "i").exec(html)?.[1];
  const description = meta("description") ?? meta("og:description");
  const body = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decode([description, body].filter(Boolean).join("\n"))
    .replace(/[ \t\r\f]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return { url, title: title ? decode(title).replace(/\s+/g, " ").trim() : null, siteName: meta("og:site_name") ? decode(meta("og:site_name")!).trim() : null, text: text.slice(0, 80_000) };
}

export const webPageReader: PageReader = {
  key: "web_page",
  name: "Supplier websites",
  async read(url) {
    const res = await httpGet("Website", url, { headers: { accept: "text/html,application/xhtml+xml" }, timeoutMs: 12_000, maxBytes: 1_500_000 });
    if (!/html|text\/plain/i.test(res.contentType)) throw new SourceError("Website", "not a web page");
    return readHtml(res.text, res.url);
  },
};
