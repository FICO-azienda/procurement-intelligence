/**
 * Who changed what, and when. Every write of the replies, of the links
 * between an offer and a product, of the identity of a company and of the
 * delivery destinations leaves an event here, with the actor as it was: a
 * person, the app's own rules, a file being loaded, an assistant operating
 * the app, a supplier. An event is never rewritten: a wrong attribution is
 * corrected with the evidence, and what it said before is kept.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { auditEvents, rfqMessages } from "@/db/schema";
import { isActorType, type Actor, type ActorType } from "@/lib/replies/types";

export class AuditError extends Error {}

export interface AuditInput {
  action: string;
  entity: string;
  entityId: string;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  source?: string | null;
  note?: string | null;
}

export interface AuditEvent extends Required<AuditInput> {
  id: string;
  at: string;
  actorType: ActorType;
  actorId: string | null;
  /** recorded: written when it happened · reconstructed: rebuilt from the rows · uncertain: who did it was not kept · corrected: attributed again, with the evidence. */
  attribution: "recorded" | "reconstructed" | "uncertain" | "corrected";
  originalActorType: ActorType | null;
}

const short = (v: string | null | undefined) => (v == null ? null : v.length > 2000 ? `${v.slice(0, 2000)}…` : v);

/**
 * Writes the events of one change, in the transaction that makes it: the change and its record stand or fall together.
 * What a deletion took away is kept whole (`oldValue`): it is the only copy left of the record.
 */
export async function logEvents(db: DB, actor: Actor, events: AuditInput[]): Promise<void> {
  if (!events.length) return;
  await db.insert(auditEvents).values(events.map((e) => ({ actorType: actor.type, actorId: actor.id, action: e.action, entity: e.entity, entityId: e.entityId, field: e.field ?? null, oldValue: e.action === "delete" ? (e.oldValue ?? null) : short(e.oldValue), newValue: short(e.newValue), source: e.source ?? null, note: e.note ?? null })));
}

const toEvent = (r: typeof auditEvents.$inferSelect): AuditEvent => ({
  id: r.id,
  at: r.at.toISOString(),
  actorType: isActorType(r.actorType) ? r.actorType : "system",
  actorId: r.actorId,
  action: r.action,
  entity: r.entity,
  entityId: r.entityId,
  field: r.field,
  oldValue: r.oldValue,
  newValue: r.newValue,
  source: r.source,
  note: r.note,
  attribution: r.attribution === "reconstructed" || r.attribution === "uncertain" || r.attribution === "corrected" ? r.attribution : "recorded",
  originalActorType: isActorType(r.originalActorType) ? r.originalActorType : null,
});

/** The events of some records, the latest first. */
export async function readAudit(db: DB, records: { entity: string; ids: string[] }[]): Promise<AuditEvent[]> {
  const out: AuditEvent[] = [];
  for (const r of records) {
    if (!r.ids.length) continue;
    out.push(...(await db.select().from(auditEvents).where(and(eq(auditEvents.entity, r.entity), inArray(auditEvents.entityId, r.ids))).orderBy(desc(auditEvents.at))).map(toEvent));
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * An event was attributed to the wrong actor: it is attributed again, with the
 * evidence for it. What it said before is kept, and the correction is an event
 * of its own. Without evidence nothing is changed.
 */
export async function correctAttribution(db: DB, eventId: string, actorType: ActorType, evidence: string, by: Actor): Promise<void> {
  const [row] = await db.select().from(auditEvents).where(eq(auditEvents.id, eventId));
  if (!row) throw new AuditError("not_found");
  if (!evidence.trim()) throw new AuditError("evidence");
  if (row.actorType === actorType) return;
  await db.transaction(async (tx) => {
    await tx.update(auditEvents).set({ actorType, attribution: "corrected", originalActorType: row.originalActorType ?? row.actorType, note: evidence.trim() }).where(eq(auditEvents.id, eventId));
    // A note of a conversation is shown in its history with who wrote it: the history follows the correction.
    if (row.entity === "rfq_thread" && row.action === "note" && row.newValue && (actorType === "user" || actorType === "ai")) {
      await tx
        .update(rfqMessages)
        .set({ source: actorType === "ai" ? "assistant" : "manual" })
        .where(and(eq(rfqMessages.threadId, row.entityId), eq(rfqMessages.summary, row.newValue), inArray(rfqMessages.source, ["manual", "assistant"])));
    }
    await logEvents(tx as unknown as DB, by, [{ action: "attribution_corrected", entity: row.entity, entityId: row.entityId, field: "actor", oldValue: row.actorType, newValue: actorType, note: evidence.trim(), source: "ui" }]);
  });
}
