/**
 * What the buyer's products are to each other (lib/catalog/technical.ts). The
 * rules propose, from the one technical engine: a possible equivalent when the
 * grades meet, the same family when they do not — derived each time, never
 * stored. A person decides (`product_relations`): with the application it was
 * judged for and the reason, and a validated equivalence or a technical
 * alternative always with both. A change is a new row; the one before stays.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import type { DB } from "@/db";
import { productRelations, products } from "@/db/schema";
import { isStrategic } from "@/lib/catalog/kinds";
import { NEEDS_APPLICATION, isRelationType, technicalRelation, type GradeFit, type RelationType } from "@/lib/catalog/technical";
import { en, type Msg, type T } from "@/lib/i18n";
import type { Actor } from "@/lib/replies/types";
import { logEvents } from "./audit";
import { readNaming } from "./categories";

export class RelationError extends Error {}

export interface StoredRelation {
  id: string;
  other: { id: string; name: string };
  type: RelationType;
  application: string | null;
  reason: string | null;
  decidedBy: string;
  createdAt: string;
  /** Earlier versions of the same decision, newest first. */
  history: { type: RelationType; application: string | null; reason: string | null; decidedBy: string; createdAt: string; state: string }[];
}

export interface ProposedRelation {
  other: { id: string; name: string };
  relation: "possible_equivalent" | "same_family";
  fit: GradeFit;
  reason: { text: Msg; values: Record<string, string> };
}

export interface ProductRelations {
  stored: StoredRelation[];
  /** Possible equivalents the rules see and nobody decided yet: to verify. */
  proposed: ProposedRelation[];
  /** The same kind of thing in another grade, or with no grade said: shown, not asked. */
  family: ProposedRelation[];
}

async function catalogue(db: DB, t: T) {
  const [rows, naming] = await Promise.all([
    db.select({ id: products.id, name: products.name, unit: products.unit, kind: products.kind, category: products.category, subcategory: products.subcategory, mergedIntoId: products.mergedIntoId, specs: products.specs }).from(products),
    readNaming(db, t),
  ]);
  return rows
    .filter((p) => !p.mergedIntoId && isStrategic(p.kind))
    .map((p) => ({ id: p.id, name: p.name, unit: p.unit, subKey: naming.subKeyOf(p.category, p.subcategory), declared: (p.specs as Record<string, string> | null)?.["Melting point"] ?? (p.specs as Record<string, string> | null)?.melting_point ?? null }));
}

const otherOf = (r: typeof productRelations.$inferSelect, productId: string) => (r.productA === productId ? r.productB : r.productA);

export async function readProductRelations(db: DB, productId: string, t: T = en): Promise<ProductRelations> {
  const [list, rows] = await Promise.all([catalogue(db, t), db.select().from(productRelations).where(or(eq(productRelations.productA, productId), eq(productRelations.productB, productId)))]);
  const me = list.find((p) => p.id === productId);
  const name = new Map(list.map((p) => [p.id, p.name]));
  const active = rows.filter((r) => r.state === "active" && name.has(otherOf(r, productId)));
  const decided = new Set(active.map((r) => otherOf(r, productId)));
  const stored: StoredRelation[] = active
    .map((r) => {
      const older: (typeof rows)[number][] = [];
      for (let cur = rows.find((x) => x.id === r.supersedesId); cur; cur = rows.find((x) => x.id === cur!.supersedesId)) older.push(cur);
      return {
        id: r.id,
        other: { id: otherOf(r, productId), name: name.get(otherOf(r, productId))! },
        type: r.type as RelationType,
        application: r.application,
        reason: r.reason,
        decidedBy: r.decidedBy,
        createdAt: r.createdAt.toISOString(),
        history: older.map((x) => ({ type: x.type as RelationType, application: x.application, reason: x.reason, decidedBy: x.decidedBy, createdAt: x.createdAt.toISOString(), state: x.state })),
      };
    })
    .sort((a, b) => a.other.name.localeCompare(b.other.name));
  const proposed: ProposedRelation[] = [];
  const family: ProposedRelation[] = [];
  if (me?.subKey) {
    for (const other of list) {
      if (other.id === me.id || other.subKey !== me.subKey || decided.has(other.id)) continue;
      const r = technicalRelation(me, other);
      if (!r?.relation) continue;
      (r.relation === "possible_equivalent" ? proposed : family).push({ other: { id: other.id, name: other.name }, relation: r.relation, fit: r.fit, reason: r.reason });
    }
  }
  const byName = (a: ProposedRelation, b: ProposedRelation) => a.other.name.localeCompare(b.other.name);
  return { stored, proposed: proposed.sort(byName), family: family.sort(byName) };
}

/**
 * A person says what two products are to each other. A validated equivalence and a technical alternative are said
 * for an application, with the reason; the decision before, if any, stays as history.
 */
export async function recordProductRelation(db: DB, a: string, b: string, v: { type: string; application?: string | null; reason?: string | null; evidenceDocumentId?: string | null }, actor: Actor, t: T = en): Promise<string> {
  if (!isRelationType(v.type)) throw new RelationError(t("Choose what the two products are to each other."));
  if (a === b) throw new RelationError(t("Choose another product."));
  const application = v.application?.trim() || null;
  const reason = v.reason?.trim() || null;
  if (NEEDS_APPLICATION.includes(v.type) && (!application || !reason)) throw new RelationError(t("Say for which use, and why: an equivalence or an alternative holds for an application, on evidence."));
  const found = await db.select({ id: products.id }).from(products).where(inArray(products.id, [a, b]));
  if (found.length !== 2) throw new RelationError(t("This product is no longer on file."));
  return db.transaction(async (tx) => {
    const pair = or(and(eq(productRelations.productA, a), eq(productRelations.productB, b)), and(eq(productRelations.productA, b), eq(productRelations.productB, a)));
    const [before] = await tx.select().from(productRelations).where(and(pair, eq(productRelations.state, "active")));
    if (before) await tx.update(productRelations).set({ state: "superseded" }).where(eq(productRelations.id, before.id));
    const [row] = await tx
      .insert(productRelations)
      .values({ productA: a, productB: b, type: v.type, application, reason, decidedBy: actor.id ?? actor.type, decidedByType: actor.type, evidenceDocumentId: v.evidenceDocumentId ?? null, supersedesId: before?.id ?? null })
      .returning({ id: productRelations.id });
    await logEvents(tx as unknown as DB, actor, [{ action: "relate", entity: "product", entityId: a, field: v.type, oldValue: before ? `${before.type}:${before.productA === a ? before.productB : before.productA}` : null, newValue: b, note: [application, reason].filter(Boolean).join(" — ") || null, source: "ui" }]);
    return row.id;
  });
}

/** A decision taken back: the row stays, withdrawn; the rules see the pair again as they do. */
export async function withdrawProductRelation(db: DB, id: string, actor: Actor, t: T = en): Promise<void> {
  const [row] = await db.select().from(productRelations).where(eq(productRelations.id, id));
  if (!row || row.state !== "active") throw new RelationError(t("This decision is no longer on file."));
  await db.transaction(async (tx) => {
    await tx.update(productRelations).set({ state: "withdrawn" }).where(eq(productRelations.id, id));
    await logEvents(tx as unknown as DB, actor, [{ action: "undo", entity: "product", entityId: row.productA, field: row.type, oldValue: row.productB, source: "ui" }]);
  });
}
