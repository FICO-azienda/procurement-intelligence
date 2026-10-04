/**
 * Reading a supplier's own page: does it state the product, does it state
 * the specification, and what does the company say it is. Words on a page —
 * nothing is inferred beyond them. A page that names the product but not the
 * grade gives a "possible" supplier whose exact specification must be
 * confirmed; a page that does not name the product gives nothing.
 */
import { withoutPackNotes } from "../catalog/attributes";
import { categorize } from "../catalog/taxonomy";
import { companyKey, normalizeKey } from "../import/normalize/text";
import { hostOf, neutralName } from "../sourcing/discovery";
import type { PageContent } from "../sourcing/providers";
import type { CompanyType, TechnicalFit } from "../sourcing/types";

export interface ProductTerms {
  /** Word beginnings that name the product in the languages it is sold in: "paraffin", "contenitor", "container". */
  words: string[];
  /** Specification values that can be looked for on a page without ambiguity: "52/54", "35x200". */
  specs: string[];
}

const STOP = new Set(["art", "articolo", "cod", "codice", "per", "con", "the", "and", "for", "tipo", "mod"]);

/** What to look for on a page, from what the product's name says. */
export function productTerms(input: { name: string; knownSuppliers?: string[]; companyName?: string | null }): ProductTerms {
  // The buyer's own name in a product's name says who it is made for, not what it is.
  const own = new Set(companyKey(input.companyName).split(" "));
  const core = withoutPackNotes(neutralName(input));
  const hit = categorize(input.name);
  const words = new Set<string>();
  if (hit) {
    words.add(hit.word.stem);
    for (const w of normalizeKey(hit.sub.noun).split(" ")) if (w.length >= 4) words.add(w);
  }
  // No known word: a name normally opens with what the thing is ("Viti M8x40"). A word further in is a brand or a code — not looked for.
  if (!hit) {
    const first = normalizeKey(core).split(" ")[0] ?? "";
    if (first.length >= 4 && !/\d/.test(first) && !STOP.has(first) && !own.has(first)) words.add(first.length > 5 ? first.slice(0, -1) : first);
  }
  // Only figures that can't be mistaken for anything else: two numbers together ("52/54", "420x310"), not part of an article code ("F60/8N").
  const specs = [...new Set((core.match(/(?<![\p{L}\d])\d+(?:[.,]\d+)?(?:\s?[/x×]\s?\d+(?:[.,]\d+)?)+(?![\p{L}\d])/giu) ?? []).map((s) => s.replace(/\s+/g, "").replace(/×/g, "x")))];
  return { words: [...words], specs };
}

const MAKER = ["manufactur", "producer", "we produce", "our production", "production plant", "produttor", "produciamo", "nostra produzione", "stabilimento", "hersteller", "wir produzieren", "produktion", "fabricante", "fabricamos", "fabricacion", "fabricant", "nous fabriquons", "producent", "produkujemy"];
const DISTRIBUTOR = ["distributor", "distribution of", "distributore", "distribuzione di", "distribuidor", "distributeur", "vertrieb", "dystrybutor", "trading company", "trader"];
const WHOLESALER = ["wholesal", "grossist", "ingrosso", "grosshandel", "mayorista", "grossiste", "hurtownia"];

const count = (text: string, stems: string[]) => stems.reduce((n, stem) => n + (text.split(` ${stem}`).length - 1), 0);

export interface PageFinding {
  companyName: string;
  companyType: CompanyType | null;
  /** The product words found on the page. */
  product: string[];
  confirmed: string[];
  missing: string[];
  /** The page's own words around the product. */
  excerpt: string | null;
  /** A contact address written on the page: the site's own domain first. */
  email: string | null;
  /** high: product and specification stated. partial: product stated, specification to confirm. null: the page does not state the product. */
  fit: TechnicalFit | null;
}

/** The company's name as its site gives it: the declared site name, or the part of the title that matches the domain. */
function companyNameOf(page: PageContent): string {
  const host = hostOf(page.url) ?? "";
  const label = host.split(".")[0];
  if (page.siteName) return page.siteName;
  const parts = (page.title ?? "").split(/\s+[|–—-]\s+|:\s+/).map((s) => s.trim()).filter(Boolean);
  const match = parts.find((part) => normalizeKey(part).replace(/ /g, "").includes(label.replace(/[^a-z0-9]/g, "")));
  return match ?? (label ? label.charAt(0).toUpperCase() + label.slice(1) : host);
}

export function inspectPage(page: PageContent, terms: ProductTerms): PageFinding {
  const text = ` ${normalizeKey(`${page.title ?? ""} ${page.text}`)} `;
  const product = terms.words.filter((w) => text.includes(` ${w}`));
  const stated = (spec: string) => text.includes(` ${normalizeKey(spec.replace(/x/g, " "))} `) || text.includes(` ${normalizeKey(spec)} `);
  const confirmed = product.length ? terms.specs.filter(stated) : [];
  const missing = terms.specs.filter((s) => !confirmed.includes(s));
  const [maker, distributor, wholesaler] = [count(text, MAKER), count(text, DISTRIBUTOR), count(text, WHOLESALER)];
  const top = Math.max(maker, distributor, wholesaler);
  // The same words for two kinds of company: the page does not settle it.
  const companyType: CompanyType | null = top === 0 || [maker, distributor, wholesaler].filter((n) => n === top).length > 1 ? null : maker === top ? "manufacturer" : distributor === top ? "distributor" : "wholesaler";
  let excerpt: string | null = null;
  if (product.length) {
    const plain = page.text.replace(/\s+/g, " ");
    const lower = plain.toLowerCase();
    const at = Math.min(...product.map((w) => lower.indexOf(w)).filter((i) => i >= 0), Number.POSITIVE_INFINITY);
    if (Number.isFinite(at)) {
      // The words around the product, cut at whole words: abbreviations ("S.A.") make sentence ends unreliable.
      const from = at > 140 ? plain.indexOf(" ", at - 140) + 1 : 0;
      const to = plain.length > at + 200 ? plain.lastIndexOf(" ", at + 200) : plain.length;
      excerpt = `${from > 0 ? "… " : ""}${plain.slice(from, to).trim()}${to < plain.length ? " …" : ""}`;
    }
  }
  const host = hostOf(page.url) ?? "";
  const emails = [...new Set((page.text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) ?? []).map((e) => e.toLowerCase()))].filter((e) => !/\.(png|jpe?g|gif|svg|webp)$/.test(e));
  const email = emails.find((e) => host.endsWith(e.split("@")[1])) ?? emails[0] ?? null;
  return { companyName: companyNameOf(page), companyType, product, confirmed, missing, excerpt, email, fit: !product.length ? null : terms.specs.length > 0 && missing.length === 0 ? "high" : "partial" };
}
