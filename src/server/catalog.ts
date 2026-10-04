/**
 * Product normalisation for an import: what the lines without a known product
 * are (lib/catalog/propose.ts), and the decisions that turn the proposal into
 * products, aliases and classified spend.
 *
 * Nothing is created by looking: products appear only when the user confirms
 * — everything the engine is sure of in one click, the doubts one at a time.
 * Every description found becomes an alias of its product, kept as written,
 * so the next import recognises it without asking.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { importItems, importSessions, products, supplierProducts, suppliers, type ImportItemRecord } from "@/db/schema";
import { isProductKind, isStrategic, type ProductKind } from "@/lib/catalog/kinds";
import { proposeProducts, splitDraft, type Analysis, type CatalogLine, type Draft } from "@/lib/catalog/propose";
import { en, type T } from "@/lib/i18n";
import type { MatchResult } from "@/lib/import/match";
import { tidy } from "@/lib/import/normalize/text";
import { normalizeUnit } from "@/lib/import/normalize/units";
import type { CurrentData, ExtractedData } from "@/lib/import/types";
import { uniqueSku } from "@/lib/sku";
import { refreshSession, rematchOpenSessions, saveAlias } from "./imports";

type Item = ImportItemRecord;

/** Lines waiting for a product, as the engine reads them. Lines with a suggestion to confirm are left to that question. */
function toLines(items: Item[], supplierName: Map<string, string>): CatalogLine[] {
  const lines: CatalogLine[] = [];
  for (const i of items) {
    if (i.status !== "ready" && i.status !== "attention") continue;
    if (i.productId || !i.supplierId || (i.productMatch as MatchResult | null)?.status === "probable") continue;
    if ((i.extracted as ExtractedData).parseIssues?.some((x) => x.excludes) && !i.acknowledged) continue;
    const d = i.data as CurrentData;
    const fx = d.currency === "EUR" ? 1 : d.fxRate;
    const amount = d.total ?? (d.quantity != null && d.unitPrice != null ? d.quantity * d.unitPrice : 0);
    lines.push({
      id: i.id,
      supplierId: i.supplierId,
      supplierName: supplierName.get(i.supplierId) ?? d.supplierName ?? "",
      text: tidy(d.productName ?? d.description) || d.supplierSku || d.sku || "",
      category: d.category,
      supplierSku: d.supplierSku,
      ownSku: d.sku,
      ean: d.ean ?? null,
      unit: normalizeUnit(d.unit),
      unitPrice: d.unitPrice,
      amount: fx != null ? amount * fx : 0,
    });
  }
  return lines;
}

/**
 * What each supplier is known to sell: when all its products in the catalogue
 * are one kind (labels are packaging, wicks are components), a new line of
 * its that says nothing is that kind too. The user said it once.
 */
async function knownKinds(db: DB): Promise<Map<string, ProductKind>> {
  const rows = await db.select({ supplierId: supplierProducts.supplierId, kind: products.kind }).from(supplierProducts).innerJoin(products, eq(products.id, supplierProducts.productId));
  const bySupplier = new Map<string, Set<ProductKind>>();
  for (const r of rows) {
    if (!isProductKind(r.kind) || r.kind === "needs_review" || !isStrategic(r.kind)) continue;
    if (!bySupplier.has(r.supplierId)) bySupplier.set(r.supplierId, new Set());
    bySupplier.get(r.supplierId)!.add(r.kind);
  }
  return new Map([...bySupplier.entries()].filter(([, kinds]) => kinds.size === 1).map(([id, kinds]) => [id, [...kinds][0]]));
}

async function load(db: DB, sessionId: string) {
  const [items, names, known] = await Promise.all([
    db.select().from(importItems).where(eq(importItems.sessionId, sessionId)),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers),
    knownKinds(db),
  ]);
  return { items, lines: toLines(items, new Map(names.map((s) => [s.id, s.name]))), known };
}

/** What the import's unknown products are: groups to confirm together, and the doubts. */
export async function analyzeSession(db: DB, sessionId: string, t: T = en, kindBySupplier?: Map<string, ProductKind>): Promise<Analysis> {
  const { lines, known } = await load(db, sessionId);
  return proposeProducts(lines, { t, kindBySupplier: new Map([...known, ...(kindBySupplier ?? [])]) });
}

export interface DraftEdit {
  name?: string;
  kind?: ProductKind;
}

/**
 * Creates the products of these drafts, with every description as an alias
 * and the supplier's code remembered, and gives their lines the product.
 */
async function createFromDrafts(db: DB, sessionId: string, drafts: Draft[], items: Item[], opts: { confidence: "high" | "medium"; edits?: Record<string, DraftEdit> }): Promise<number> {
  if (!drafts.length) return 0;
  const byId = new Map(items.map((i) => [i.id, i]));
  const taken = new Set((await db.select({ sku: products.sku }).from(products)).map((x) => x.sku.toUpperCase()));
  let created = 0;
  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    for (const draft of drafts) {
      const edit = opts.edits?.[draft.key];
      const name = tidy(edit?.name) || draft.name;
      const kind = edit?.kind && isProductKind(edit.kind) ? edit.kind : draft.kind;
      // Our own code when the supplier prints it on the invoice; otherwise one made from the name.
      const own = draft.sku?.toUpperCase();
      const sku = own && !taken.has(own) ? own : uniqueSku(name, taken);
      // Spend that is not a product is one item per supplier and kind: more of it joins the item already there.
      const existing =
        !isStrategic(kind) && draft.supplierIds.length === 1
          ? await tx
              .select({ id: products.id })
              .from(supplierProducts)
              .innerJoin(products, eq(products.id, supplierProducts.productId))
              .where(and(eq(supplierProducts.supplierId, draft.supplierIds[0]), eq(products.kind, kind)))
          : [];
      let p = existing.length === 1 ? existing[0] : null;
      if (!p) {
        taken.add(sku.toUpperCase());
        [p] = await tx
          .insert(products)
          .values({ name, sku, unit: draft.unit, kind, currentSupplierId: draft.supplierIds.length === 1 ? draft.supplierIds[0] : null })
          .returning({ id: products.id });
        created++;
      }
      for (const m of draft.mentions) {
        const sample = byId.get(m.itemIds[0]);
        const d = sample?.data as CurrentData | undefined;
        for (const text of m.texts) {
          await saveAlias(txDb, { productId: p.id, alias: text, supplierId: m.supplierId, supplierSku: d?.supplierSku ?? null, ean: d?.ean ?? null, confidence: opts.confidence, confirmedByUser: true, sessionId });
        }
        // The supplier's code identifies the product only when it has one code for it.
        await tx
          .insert(supplierProducts)
          .values({ supplierId: m.supplierId, productId: p.id, supplierSku: m.codes.length === 1 ? (d?.supplierSku ?? null) : null, supplierProductName: m.text || null })
          .onConflictDoNothing({ target: [supplierProducts.supplierId, supplierProducts.productId] });
        await tx.update(importItems).set({ productId: p.id, productResolution: existing.length === 1 ? "confirmed" : "created", updatedAt: new Date() }).where(inArray(importItems.id, m.itemIds));
      }
    }
    await tx.update(importSessions).set({ newProducts: sql`${importSessions.newProducts} + ${created}` }).where(eq(importSessions.id, sessionId));
  });
  await refreshSession(db, sessionId);
  await rematchOpenSessions(db, sessionId);
  return created;
}

/** Confirms the groups the engine is sure of — all of them, or the ones named. */
export async function confirmDrafts(
  db: DB,
  sessionId: string,
  opts: { keys?: string[]; edits?: Record<string, DraftEdit>; /** Keys of groups to create as one product per description. */ separate?: string[]; t?: T } = {},
): Promise<{ created: number; lines: number }> {
  const { items, lines, known } = await load(db, sessionId);
  const analysis = proposeProducts(lines, { t: opts.t, kindBySupplier: known });
  const chosen = opts.keys ? analysis.confident.filter((d) => opts.keys!.includes(d.key)) : analysis.confident;
  const drafts = chosen.flatMap((d) => (opts.separate?.includes(d.key) ? splitDraft(d, opts.t) : [d]));
  const created = await createFromDrafts(db, sessionId, drafts, items, { confidence: "high", edits: opts.edits });
  return { created, lines: drafts.reduce((s, d) => s + d.lines, 0) };
}

/** "They may be the same product": one product for all of them, or one each. */
export async function answerSame(db: DB, sessionId: string, questionKey: string, decision: "merge" | "separate", opts: { name?: string; t?: T } = {}): Promise<{ created: number; error?: string }> {
  const { items, lines, known } = await load(db, sessionId);
  const q = proposeProducts(lines, { t: opts.t, kindBySupplier: known }).questions.find((x) => x.key === questionKey && x.type === "same");
  if (!q) return { created: 0, error: "This question is no longer open." };
  if (decision === "separate") return { created: await createFromDrafts(db, sessionId, q.drafts, items, { confidence: "medium" }) };
  const top = [...q.drafts].sort((a, b) => b.amount - a.amount)[0];
  const merged: Draft = {
    ...top,
    key: q.key,
    name: tidy(opts.name) || q.mergedName,
    sku: null,
    mentions: q.drafts.flatMap((d) => d.mentions),
    descriptions: q.drafts.reduce((s, d) => s + d.descriptions, 0),
    lines: q.lines,
    amount: q.amount,
    supplierIds: q.supplierIds,
  };
  return { created: await createFromDrafts(db, sessionId, [merged], items, { confidence: "medium" }) };
}

/**
 * "What are these?": the user says what the lines of a supplier are. Products
 * are created one per description (a doubt between two of them is not settled
 * by saying what they are: they stay apart); spend becomes one item.
 */
export async function answerKind(db: DB, sessionId: string, questionKey: string, kind: ProductKind, opts: { t?: T } = {}): Promise<{ created: number; error?: string }> {
  if (!isProductKind(kind)) return { created: 0, error: "This question is no longer open." };
  const { items, lines, known } = await load(db, sessionId);
  const q = proposeProducts(lines, { t: opts.t, kindBySupplier: known }).questions.find((x) => x.key === questionKey && x.type === "kind");
  if (!q) return { created: 0, error: "This question is no longer open." };
  const asked = new Set(q.drafts.flatMap((d) => d.mentions.map((m) => m.key)));
  const supplierId = q.supplierIds[0];
  const decided = proposeProducts(lines, { t: opts.t, kindBySupplier: new Map([...known, [supplierId, kind]]) });
  const drafts = [...decided.confident, ...decided.questions.flatMap((x) => x.drafts)].filter((d) => d.mentions.some((m) => asked.has(m.key)));
  return { created: await createFromDrafts(db, sessionId, drafts, items, { confidence: "medium" }) };
}
