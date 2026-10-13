/**
 * Supplier and product matching.
 *
 * Results:
 *   exact    → certain (same VAT/SKU, the supplier's code when it names one
 *              product and the description does not say otherwise, a
 *              description this supplier wrote before). Used without asking.
 *   probable → a suggestion with a confidence. The user confirms or corrects,
 *              and the confirmation is saved as an alias (the system learns).
 *   none     → nothing credible. The user picks one or creates a new record.
 *
 * Nothing here writes to the database.
 */
import { classify } from "../../catalog/classify";
import { sameNumbers } from "../../catalog/specs";
import { compareIdentity, identityOf, type Identity } from "../../catalog/identity";
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
  /**
   * Products of the same kind that are not this one: another grade or size, or the same thing with no grade said.
   * Never a match — what the line is shown next to, so that a new product is not created without seeing its family.
   */
  related?: Candidate[];
}

export interface MatchContext {
  /** Every name a company is known by: a record merged into another comes with the id of the one it is read as. */
  suppliers: { id: string; name: string; vatNumber: string | null; taxCode?: string | null }[];
  supplierAliases: { supplierId: string; normalized: string }[];
  /** `kind`: what the product is for the company's spend; absent = a product of the catalogue. */
  products: { id: string; sku: string; name: string; description: string | null; kind?: string | null }[];
  /** `supplierId`: who writes the product this way (absent on aliases saved before suppliers were recorded). */
  /** `alias`: the description as written, when on file — where the supplier's own codes can still be read. */
  productAliases: { productId: string; normalized: string; supplierId?: string | null; alias?: string | null; supplierSku?: string | null }[];
  supplierProducts: { supplierId: string; productId: string; supplierSku: string | null; supplierProductName: string | null }[];
}

/** What each catalogue product is, read once per context from its name and from every description on file for it. */
const IDENTITIES = new WeakMap<MatchContext, { id: string; identity: Identity; suppliers: Set<string> }[]>();
function catalogueIdentities(ctx: MatchContext) {
  let all = IDENTITIES.get(ctx);
  if (all) return all;
  all = [];
  for (const p of ctx.products) {
    if (!isStrategic(p.kind)) continue;
    const links = ctx.supplierProducts.filter((sp) => sp.productId === p.id);
    const suppliers = new Set(links.map((l) => l.supplierId));
    const seller = { names: ctx.suppliers.filter((s) => suppliers.has(s.id)).map((s) => s.name), skus: links.map((l) => l.supplierSku) };
    const texts = new Map<string, string>();
    for (const text of [p.name, ...ctx.productAliases.filter((a) => a.productId === p.id).map((a) => a.alias)]) if (text && !texts.has(normalizeKey(text))) texts.set(normalizeKey(text), text);
    for (const text of texts.values()) all.push({ id: p.id, identity: identityOf(text, seller), suppliers });
  }
  IDENTITIES.set(ctx, all);
  return all;
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

  const texts = [input.name, input.description].map((t) => tidy(t)).filter(Boolean);

  // 2. The supplier's own code. A code is not an identity by itself: one supplier can use the same code for a whole
  //    range ("CLA" for altar candles of every size). It settles the product only when, for this supplier, it names
  //    one product and the description does not state another size or grade; otherwise the description decides, or
  //    the user is asked.
  const supplierSku = codeKey(input.supplierSku);
  if (supplierSku) {
    const links = ctx.supplierProducts.filter((sp) => codeKey(sp.supplierSku) === supplierSku);
    const own = new Set(supplierId ? links.filter((sp) => sp.supplierId === supplierId).map((sp) => sp.productId) : []);
    // The codes kept with each description this supplier wrote say the same thing, also where the link kept only one.
    if (supplierId) for (const a of ctx.productAliases) if (a.supplierId === supplierId && codeKey(a.supplierSku) === supplierSku) own.add(a.productId);
    const keys = new Set(texts.map((text) => productKey(text)));
    /** This supplier wrote this very description for the product before. */
    const written = (id: string) => ctx.productAliases.some((a) => a.productId === id && a.supplierId === supplierId && keys.has(a.normalized)) || keys.has(productKey(product(id)?.name));
    if (own.size === 1) {
      const [id] = [...own];
      if (!inCatalogue(id) || !texts.length || written(id) || !otherSpec(texts[0], id, supplierId, input.supplierSku, ctx)) return exact(id, "Supplier's product code");
      return { status: "probable", id, confidence: 0.6, reason: "Same supplier code, but the description states another size or grade — check that it is this product", alternatives: [] };
    }
    if (own.size > 1) {
      const named = [...own].filter(written);
      if (named.length === 1) return exact(named[0], "Supplier's product code and description");
      const fitting = [...own].filter((id) => inCatalogue(id) && texts.length > 0 && sameSpec(texts[0], id, supplierId, input.supplierSku, ctx));
      const shared = [...own].filter(inCatalogue).map((id) => ({ id, confidence: 0.5, reason: "Shares this supplier code" as Msg }));
      if (fitting.length === 1) return { status: "probable", id: fitting[0], confidence: 0.75, reason: "The supplier uses this code for several products: this one has the same size or grade — check", alternatives: shared.filter((c) => c.id !== fitting[0]).slice(0, 3) };
      // Several products under one code and none written this way: a question, or a new product of that range — never the first one found.
      if (shared.length) return { ...none(shared.slice(0, 3)), reason: "The supplier uses this code for several products, and none of them is written this way", related: shared.slice(0, 5) };
    }
    // The same code at another supplier is a clue only for products: spend items carry codes that mean nothing ("FOB", "3").
    const ids = [...new Set(links.map((l) => l.productId).filter(inCatalogue))];
    if (!own.size && ids.length === 1) {
      return { status: "probable", id: ids[0], confidence: 0.85, reason: "Same code used by another supplier", alternatives: [] };
    }
  }

  if (!texts.length) return none();
  /** A product this supplier already sells, or one no supplier is tied to yet (the user's own entry): its name is its identity. */
  const ours = (id: string) => {
    const sellers = new Set([...ctx.supplierProducts.filter((sp) => sp.productId === id).map((sp) => sp.supplierId), ...ctx.productAliases.filter((a) => a.productId === id && a.supplierId).map((a) => a.supplierId as string)]);
    return sellers.size === 0 || (!!supplierId && sellers.has(supplierId));
  };
  /** The same words from someone else: likely the same product, but an article of another supplier is confirmed by a person, never filed by itself. */
  const elsewhereMatch = (id: string): MatchResult => ({ status: "probable", id, confidence: 0.85, reason: "Written like a product you buy from another supplier — confirm it is the same article", alternatives: [] });

  // 3. Known alias or same normalized name
  for (const text of texts) {
    const key = productKey(text);
    const aliases = ctx.productAliases.filter((a) => a.normalized === key);
    const own = aliases.find((a) => a.supplierId != null && a.supplierId === supplierId);
    if (own) return exact(own.productId, "Recognised from a previous confirmation");
    // Written the same way by someone else: one product when everyone who writes it means one — the user's own, or to confirm.
    const elsewhere = [...new Set(aliases.map((a) => a.productId).filter(inCatalogue))];
    if (elsewhere.length === 1) return ours(elsewhere[0]) ? exact(elsewhere[0], "Recognised from a previous confirmation") : elsewhereMatch(elsewhere[0]);
    const byName = ctx.products.find((p) => productKey(p.name) === key && isStrategic(p.kind));
    if (byName) return ours(byName.id) ? exact(byName.id, "Same name") : elsewhereMatch(byName.id);
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

  // 4b. The same product by what it is, whoever wrote it: the seller's own name and codes set aside, the same thing
  //     in the same grade. From the same seller with the same code it is the product; from anyone else it is a
  //     question — the user links it or keeps it apart. Another grade is another product, and is never suggested.
  const otherGrade = new Set<string>();
  const mine = identityOf(texts[0], { names: supplierId ? ctx.suppliers.filter((s) => s.id === supplierId).map((s) => s.name) : [], skus: [input.supplierSku] });
  {
    const same = new Set<string>();
    const likely = new Set<string>();
    const byCode = new Set<string>();
    const written = new Set(texts[0].split(/\s+/).map((word) => codeKey(word)).filter((word) => word.length >= 3));
    for (const c of catalogueIdentities(ctx)) {
      const r = mine.subKey ? compareIdentity(mine, c.identity).match : "unrelated";
      if (r === "other_spec") otherGrade.add(c.id);
      if (r === "same") same.add(c.id);
      else if (r === "likely") likely.add(c.id);
      // The seller's own code, read before on one of its descriptions and written again — in brackets or not — with no other grade next to it.
      const gradeOk = r !== "other_spec" && (!mine.numbers.length || !c.identity.numbers.length || sameNumbers(mine.numbers, c.identity.numbers));
      if (supplierId && gradeOk && c.suppliers.has(supplierId) && c.identity.codes.some((code) => written.has(codeKey(code)))) byCode.add(c.id);
    }
    for (const id of [...same, ...likely]) otherGrade.delete(id);
    if (byCode.size === 1) return exact([...byCode][0], "Supplier's own code in the description");
    if (same.size === 1) return { status: "probable", id: [...same][0], confidence: 0.9, reason: "Same product by what it is: the same thing in the same grade, the supplier's name and codes aside", alternatives: [] };
    if (!same.size && likely.size === 1) return { status: "probable", id: [...likely][0], confidence: 0.8, reason: "Looks like a product you already have: the same thing in the same grade, described with other words", alternatives: [] };
  }

  // 5–6. Product code written in the text, then fuzzy name/description (products only: spend items are not looked up by name)
  const cands: Candidate[] = [];
  for (const [i, text] of texts.entries()) {
    const weight = i === 0 ? 1 : 0.9; // description counts a little less than the name
    const tokens = productTokens(text);
    const compact = codeKey(text);
    for (const p of ctx.products) {
      if (!isStrategic(p.kind) || otherGrade.has(p.id)) continue;
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
      if (!inCatalogue(a.productId) || otherGrade.has(a.productId)) continue;
      const score = tokenSimilarity(tokens, a.normalized.split(" ")) * weight * 0.95;
      if (score > 0) cands.push({ id: a.productId, confidence: score, reason: "Similar to a known alias" });
    }
  }
  const found = fromCandidates(cands);
  if (found.status !== "none") return found;
  // Nothing to tie it to. What it is shown next to: the catalogue's products of the same kind — another grade or size
  // (never the same product), or the same thing where one of the two says no grade.
  const related: Candidate[] = [];
  if (mine.subKey) {
    for (const c of catalogueIdentities(ctx)) {
      if (c.identity.subKey !== mine.subKey || related.some((r) => r.id === c.id)) continue;
      related.push({ id: c.id, confidence: 0, reason: otherGrade.has(c.id) ? "Same kind of product, another grade or size" : "Same kind of product" });
    }
  }
  return related.length ? { ...found, related: related.slice(0, 5) } : found;
}

/** What the catalogue knows a product as — its name and every description on file — read for what each says. */
function identitiesOf(productId: string, ctx: MatchContext) {
  return catalogueIdentities(ctx).filter((c) => c.id === productId).map((c) => c.identity);
}
const lineIdentity = (text: string, supplierId: string | null, supplierSku: string | null | undefined, ctx: MatchContext) =>
  identityOf(text, { names: supplierId ? ctx.suppliers.filter((s) => s.id === supplierId).map((s) => s.name) : [], skus: [supplierSku] });
/** The description states sizes or grades, and none of the product's own descriptions states the same ones. */
function otherSpec(text: string, productId: string, supplierId: string | null, supplierSku: string | null | undefined, ctx: MatchContext): boolean {
  const mine = lineIdentity(text, supplierId, supplierSku, ctx);
  const known = identitiesOf(productId, ctx).filter((k) => k.numbers.length);
  return mine.numbers.length > 0 && known.length > 0 && !known.some((k) => sameNumbers(mine.numbers, k.numbers));
}
/** The description states sizes or grades, and one of the product's own descriptions states exactly those. */
function sameSpec(text: string, productId: string, supplierId: string | null, supplierSku: string | null | undefined, ctx: MatchContext): boolean {
  const mine = lineIdentity(text, supplierId, supplierSku, ctx);
  return mine.numbers.length > 0 && identitiesOf(productId, ctx).some((k) => sameNumbers(mine.numbers, k.numbers));
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
