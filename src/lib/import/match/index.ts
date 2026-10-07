/**
 * Supplier and product matching.
 *
 * Results:
 *   exact    → certain (same VAT/SKU/supplier code, a confirmed alias, same
 *              normalized name). Used without asking.
 *   probable → a suggestion with a confidence. The user confirms or corrects,
 *              and the confirmation is saved as an alias (the system learns).
 *   none     → nothing credible. The user picks one or creates a new record.
 *
 * Nothing here writes to the database.
 */
import { classify } from "../../catalog/classify";
import { isStrategic } from "../../catalog/kinds";
import type { Msg } from "../../i18n";
import { codeKey, companyKey, normalizeKey, productKey, productTokens, tidy, vatKey } from "../normalize/text";
import { ratio, tokenSimilarity } from "./similarity";

export type MatchStatus = "exact" | "probable" | "none";

export interface Candidate {
  id: string;
  confidence: number;
  /** Why it was suggested — a message, shown in the reader's language. */
  reason: Msg;
}

export interface MatchResult {
  status: MatchStatus;
  /** Best candidate (confirmed for exact, suggested for probable). */
  id: string | null;
  confidence: number;
  reason: Msg;
  /** Other plausible candidates, best first. */
  alternatives: Candidate[];
}

export interface MatchContext {
  /** Every name a company is known by: a record merged into another comes with the id of the one it is read as. */
  suppliers: { id: string; name: string; vatNumber: string | null; taxCode?: string | null }[];
  supplierAliases: { supplierId: string; normalized: string }[];
  /** `kind`: what the product is for the company's spend; absent = a product of the catalogue. */
  products: { id: string; sku: string; name: string; description: string | null; kind?: string | null }[];
  /** `supplierId`: who writes the product this way (absent on aliases saved before suppliers were recorded). */
  productAliases: { productId: string; normalized: string; supplierId?: string | null }[];
  supplierProducts: { supplierId: string; productId: string; supplierSku: string | null; supplierProductName: string | null }[];
}

/** Below this, a similarity is not worth suggesting. */
export const SUGGEST_THRESHOLD = 0.6;

const none = (alternatives: Candidate[] = []): MatchResult => ({
  status: "none",
  id: null,
  confidence: 0,
  reason: "No similar record",
  alternatives,
});

const exact = (id: string, reason: Msg): MatchResult => ({ status: "exact", id, confidence: 1, reason, alternatives: [] });

function fromCandidates(cands: Candidate[]): MatchResult {
  const sorted = cands.filter((c) => c.confidence >= SUGGEST_THRESHOLD).sort((a, b) => b.confidence - a.confidence);
  // Keep one entry per id.
  const unique = sorted.filter((c, i) => sorted.findIndex((x) => x.id === c.id) === i);
  if (!unique.length) return none();
  const [best, ...rest] = unique;
  let confidence = Math.min(best.confidence, 0.95);
  let reason: Msg = best.reason;
  if (rest[0] && best.confidence - rest[0].confidence < 0.05) {
    confidence = Math.min(confidence, 0.7);
    reason = "Several similar records — check which one";
  }
  return { status: "probable", id: best.id, confidence: round(confidence), reason, alternatives: rest.slice(0, 3) };
}

const round = (n: number) => Math.round(n * 100) / 100;

// ---------------- Suppliers ----------------

/**
 * Who a name on a document is. The hierarchy: VAT number, tax code, the very
 * same name, a name confirmed before, then similar names — which are only
 * ever suggestions. A name alone never wins over a VAT number that says
 * otherwise: two companies can share a name.
 */
export function matchSupplier(input: { name: string | null; vat?: string | null; taxCode?: string | null }, ctx: MatchContext): MatchResult {
  const vat = vatKey(input.vat);
  const hasVat = vat.length >= 8;
  if (hasVat) {
    const byVat = ctx.suppliers.find((s) => vatKey(s.vatNumber) === vat);
    if (byVat) return exact(byVat.id, "Same VAT number");
  }
  const tax = codeKey(input.taxCode);
  if (tax.length >= 8) {
    // A company's tax code is often its VAT number: either may be written in either field.
    const byTax = ctx.suppliers.find((s) => codeKey(s.taxCode) === tax || vatKey(s.vatNumber) === vatKey(tax));
    if (byTax) return exact(byTax.id, "Same tax code");
  }
  const name = tidy(input.name);
  if (!name) return none();
  /** The document states a VAT number and the record has another: not the same company, whatever the name. */
  const otherVat = (s: { vatNumber: string | null }) => hasVat && vatKey(s.vatNumber).length >= 8 && vatKey(s.vatNumber) !== vat;

  const cands: Candidate[] = [];
  const lower = name.toLowerCase();
  const same = ctx.suppliers.filter((s) => tidy(s.name).toLowerCase() === lower);
  const sameOk = same.find((s) => !otherVat(s));
  if (sameOk) return exact(sameOk.id, "Same name");
  for (const s of same) cands.push({ id: s.id, confidence: 0.7, reason: "Same name, but a different VAT number" });

  const key = companyKey(name);
  const alias = ctx.supplierAliases.find((a) => a.normalized === key);
  if (alias) {
    const target = ctx.suppliers.find((s) => s.id === alias.supplierId);
    if (!target || !otherVat(target)) return exact(alias.supplierId, "Recognised from a previous confirmation");
    cands.push({ id: alias.supplierId, confidence: 0.7, reason: "Same name, but a different VAT number" });
  }

  for (const s of ctx.suppliers) {
    const sKey = companyKey(s.name);
    if (!sKey || !key || same.includes(s)) continue;
    if (sKey === key) {
      cands.push(otherVat(s) ? { id: s.id, confidence: 0.65, reason: "Same name, but a different VAT number" } : { id: s.id, confidence: 0.92, reason: "Same name, different spelling or legal form" });
      continue;
    }
    if (otherVat(s)) continue;
    const sim = Math.max(ratio(sKey, key), 0.6 * containment(key, sKey) + 0.4 * dice(key, sKey));
    if (sim >= 0.8) cands.push({ id: s.id, confidence: sim * 0.9, reason: "Similar name" });
  }
  return fromCandidates(cands);
}

function containment(doc: string, ref: string) {
  const d = new Set(doc.split(" "));
  const r = ref.split(" ");
  return r.filter((t) => d.has(t)).length / r.length;
}
function dice(a: string, b: string) {
  const A = a.split(" ");
  const B = new Set(b.split(" "));
  return (2 * A.filter((t) => B.has(t)).length) / (A.length + B.size);
}

// ---------------- Products ----------------

export interface ProductInput {
  sku?: string | null;
  supplierSku?: string | null;
  name?: string | null;
  description?: string | null;
}

export function matchProduct(input: ProductInput, supplierId: string | null, ctx: MatchContext): MatchResult {
  const product = (id: string) => ctx.products.find((p) => p.id === id);
  /** Spend that is not a product (transport, a utility…) is kept per supplier: its names mean nothing elsewhere. */
  const inCatalogue = (id: string) => isStrategic(product(id)?.kind);

  // 1. Our own SKU
  const sku = codeKey(input.sku);
  if (sku) {
    const bySku = ctx.products.find((p) => codeKey(p.sku) === sku);
    if (bySku) return exact(bySku.id, "Same SKU");
  }

  // 2. The supplier's own code
  const supplierSku = codeKey(input.supplierSku);
  if (supplierSku) {
    const links = ctx.supplierProducts.filter((sp) => codeKey(sp.supplierSku) === supplierSku);
    const own = supplierId ? links.find((sp) => sp.supplierId === supplierId) : undefined;
    if (own) return exact(own.productId, "Supplier's product code");
    // The same code at another supplier is a clue only for products: spend items carry codes that mean nothing ("FOB", "3").
    const ids = [...new Set(links.map((l) => l.productId).filter(inCatalogue))];
    if (ids.length === 1) {
      return { status: "probable", id: ids[0], confidence: 0.85, reason: "Same code used by another supplier", alternatives: [] };
    }
  }

  const texts = [input.name, input.description].map((t) => tidy(t)).filter(Boolean);
  if (!texts.length) return none();

  // 3. Known alias or same normalized name
  for (const text of texts) {
    const key = productKey(text);
    const aliases = ctx.productAliases.filter((a) => a.normalized === key);
    const own = aliases.find((a) => a.supplierId != null && a.supplierId === supplierId);
    if (own) return exact(own.productId, "Recognised from a previous confirmation");
    // Written the same way by someone else: the same product, when everyone who writes it means one product.
    const elsewhere = [...new Set(aliases.map((a) => a.productId).filter(inCatalogue))];
    if (elsewhere.length === 1) return exact(elsewhere[0], "Recognised from a previous confirmation");
    const byName = ctx.products.find((p) => productKey(p.name) === key && isStrategic(p.kind));
    if (byName) return exact(byName.id, "Same name");
    const byLink = supplierId
      ? ctx.supplierProducts.find((sp) => sp.supplierId === supplierId && productKey(sp.supplierProductName) === key)
      : undefined;
    if (byLink) return exact(byLink.productId, "Supplier's product name");
  }

  // 4. Spend that is not a product, from a supplier we already keep such an item for:
  //    this month's transport lines are last month's transport, whatever shipment they name.
  if (supplierId) {
    const linked = ctx.supplierProducts.filter((sp) => sp.supplierId === supplierId).map((sp) => product(sp.productId)).filter((p): p is NonNullable<typeof p> => !!p);
    const kinds = [...new Set(linked.map((p) => p.kind ?? null))];
    const supplierKind = kinds.length === 1 && kinds[0] && !isStrategic(kinds[0]) ? kinds[0] : null;
    const c = classify({ text: texts[0], supplierName: ctx.suppliers.find((s) => s.id === supplierId)?.name, supplierKind: supplierKind as never });
    if (c.by !== "none" && !isStrategic(c.kind)) {
      const same = linked.filter((p) => p.kind === c.kind);
      if (same.length === 1) return exact(same[0].id, "Same kind of spend from this supplier");
    }
  }

  // 5–6. Product code written in the text, then fuzzy name/description (products only: spend items are not looked up by name)
  const cands: Candidate[] = [];
  for (const [i, text] of texts.entries()) {
    const weight = i === 0 ? 1 : 0.9; // description counts a little less than the name
    const tokens = productTokens(text);
    const compact = codeKey(text);
    for (const p of ctx.products) {
      if (!isStrategic(p.kind)) continue;
      const pSku = codeKey(p.sku);
      if (pSku.length >= 4 && (compact === pSku || codeTokens(text).includes(pSku))) {
        cands.push({ id: p.id, confidence: 0.9, reason: "Contains the product code" });
        continue;
      }
      const byName = tokenSimilarity(tokens, productTokens(p.name));
      const byDesc = p.description ? tokenSimilarity(tokens, productTokens(p.description)) * 0.85 : 0;
      const score = Math.max(byName, byDesc) * weight;
      if (score > 0) cands.push({ id: p.id, confidence: score, reason: byName >= byDesc ? "Similar name" : "Similar description" });
    }
    for (const a of ctx.productAliases) {
      if (!inCatalogue(a.productId)) continue;
      const score = tokenSimilarity(tokens, a.normalized.split(" ")) * weight * 0.95;
      if (score > 0) cands.push({ id: a.productId, confidence: score, reason: "Similar to a known alias" });
    }
  }
  return fromCandidates(cands);
}

/** Code-like chunks of a text, compacted: "Art. PAR 5860 paraffina" → ["PAR5860", …]. */
function codeTokens(text: string): string[] {
  const words = normalizeKey(text).toUpperCase().split(" ");
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    out.push(words[i]);
    if (i + 1 < words.length) out.push(words[i] + words[i + 1]);
  }
  return out.filter((w) => /[A-Z]/.test(w) && /\d/.test(w));
}
