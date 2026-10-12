/**
 * Where goods are delivered. A destination is written down by a person and
 * confirmed by a person: nothing fills in an address read on an offer, and a
 * town alone is a destination that is not confirmed yet.
 */
import { asc, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { deliveryDestinations } from "@/db/schema";
import { en, type T } from "@/lib/i18n";
import type { Actor } from "@/lib/replies/types";
import { logEvents } from "./audit";

export class DestinationError extends Error {}

export interface Destination {
  id: string;
  recipient: string | null;
  address: string | null;
  postalCode: string | null;
  city: string;
  province: string | null;
  country: string | null;
  unloading: string | null;
  restrictions: string | null;
  isDefault: boolean;
  confirmedAt: string | null;
}

export const DESTINATION_FIELDS = ["recipient", "address", "postalCode", "city", "province", "country", "unloading", "restrictions"] as const;
export type DestinationField = (typeof DESTINATION_FIELDS)[number];

const toDestination = (r: typeof deliveryDestinations.$inferSelect): Destination => ({
  id: r.id, recipient: r.recipient, address: r.address, postalCode: r.postalCode, city: r.city, province: r.province, country: r.country,
  unloading: r.unloading, restrictions: r.restrictions, isDefault: r.isDefault, confirmedAt: r.confirmedAt?.toISOString() ?? null,
});

export async function readDestinations(db: DB): Promise<Destination[]> {
  return (await db.select().from(deliveryDestinations).orderBy(asc(deliveryDestinations.createdAt))).map(toDestination);
}

/** The destination used when nothing says another: the default, else the only one there is. */
export const defaultOf = (list: Destination[]): Destination | null => list.find((d) => d.isDefault) ?? (list.length === 1 ? list[0] : null);

/** A destination in a line: "Bologna (BO), Italy". */
export const placeOf = (d: Pick<Destination, "city" | "province" | "country">) => [d.province ? `${d.city} (${d.province})` : d.city, d.country].filter(Boolean).join(", ");

const clean = (v: string | null | undefined) => {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return s ? s : null;
};

/**
 * Writes a destination: a new one, or the fields of one on file. Changing the
 * address of a confirmed destination un-confirms it — what was confirmed is
 * no longer what is written.
 */
export async function saveDestination(db: DB, v: Partial<Record<DestinationField, string | null>> & { id?: string | null; isDefault?: boolean; confirmed?: boolean }, actor: Actor, t: T = en): Promise<string> {
  const values = Object.fromEntries(DESTINATION_FIELDS.filter((f) => f in v).map((f) => [f, clean(v[f])])) as Partial<Record<DestinationField, string | null>>;
  const existing = v.id ? (await db.select().from(deliveryDestinations).where(eq(deliveryDestinations.id, v.id)))[0] : undefined;
  if (v.id && !existing) throw new DestinationError(t("This destination is no longer on file."));
  if (!existing && !values.city) throw new DestinationError(t("A destination needs at least its town."));
  if (existing && "city" in values && !values.city) throw new DestinationError(t("A destination needs at least its town."));
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    const first = (await tx.select({ id: deliveryDestinations.id }).from(deliveryDestinations)).length === 0;
    // The first destination is the default: there is no other. After that it is what the person says.
    const only = first || (!!existing && (await tx.select({ id: deliveryDestinations.id }).from(deliveryDestinations)).length === 1);
    const makeDefault = only ? true : (v.isDefault ?? existing?.isDefault ?? false);
    if (makeDefault) await tx.update(deliveryDestinations).set({ isDefault: false });
    if (!existing) {
      const [row] = await tx.insert(deliveryDestinations).values({ ...values, city: values.city!, isDefault: makeDefault, confirmedAt: v.confirmed ? new Date() : null }).returning({ id: deliveryDestinations.id });
      await logEvents(txDb, actor, [{ action: "create", entity: "delivery_destination", entityId: row.id, newValue: [values.city, values.province, values.country].filter(Boolean).join(", "), source: "ui" }]);
      return row.id;
    }
    const changed = DESTINATION_FIELDS.filter((f) => f in values && (values[f] ?? null) !== (existing[f] ?? null));
    const where = changed.some((f) => f !== "unloading" && f !== "restrictions");
    const confirmedAt = v.confirmed === true ? (existing.confirmedAt && !where ? existing.confirmedAt : new Date()) : v.confirmed === false || where ? null : existing.confirmedAt;
    await tx.update(deliveryDestinations).set({ ...(values as Partial<typeof deliveryDestinations.$inferInsert>), isDefault: makeDefault, confirmedAt, updatedAt: new Date() }).where(eq(deliveryDestinations.id, existing.id));
    await logEvents(txDb, actor, [
      ...changed.map((f) => ({ action: "update", entity: "delivery_destination", entityId: existing.id, field: f, oldValue: existing[f], newValue: values[f] ?? null, source: "ui" })),
      ...((confirmedAt == null) !== (existing.confirmedAt == null) ? [{ action: confirmedAt ? "confirm" : "unconfirm", entity: "delivery_destination", entityId: existing.id, source: "ui" }] : []),
      ...(makeDefault !== existing.isDefault ? [{ action: makeDefault ? "set_default" : "unset_default", entity: "delivery_destination", entityId: existing.id, source: "ui" }] : []),
    ]);
    return existing.id;
  });
}

export async function removeDestination(db: DB, id: string, actor: Actor): Promise<void> {
  const [row] = await db.select().from(deliveryDestinations).where(eq(deliveryDestinations.id, id));
  if (!row) return;
  await db.transaction(async (tx) => {
    await tx.delete(deliveryDestinations).where(eq(deliveryDestinations.id, id));
    await logEvents(tx as unknown as DB, actor, [{ action: "delete", entity: "delivery_destination", entityId: id, oldValue: [row.city, row.province, row.country].filter(Boolean).join(", "), source: "ui" }]);
  });
}
