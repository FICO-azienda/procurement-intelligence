/**
 * Writes the first start of a workspace (`lib/setup.ts`): the company's own
 * facts in Settings, and its town of delivery as the first destination — a
 * town alone is a destination nobody confirmed yet, as anywhere else. In one
 * transaction, logged; the company's organisation follows its new name.
 */
import type { DB } from "@/db";
import { deliveryDestinations, settings } from "@/db/schema";
import { readSettings } from "@/lib/data";
import { en, type T } from "@/lib/i18n";
import type { Actor } from "@/lib/replies/types";
import { readSetup, type SetupErrors, type SetupField } from "@/lib/setup";
import { logEvents } from "./audit";
import { saveDestination } from "./destinations";
import { ensureWorkspaceOrg } from "./orgs";

export async function setupCompany(db: DB, raw: Partial<Record<SetupField, unknown>>, actor: Actor, t: T = en): Promise<{ errors?: SetupErrors }> {
  const { value, errors } = readSetup(raw, t);
  if (!value) return { errors };
  const before = await readSettings(db);
  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    const facts = { companyName: value.companyName, country: value.country, vatNumber: value.vatNumber, userName: value.userName ?? before.userName, language: value.language, updatedAt: new Date() };
    await tx.insert(settings).values({ id: 1, ...facts }).onConflictDoUpdate({ target: settings.id, set: facts });
    await logEvents(
      txDb,
      actor,
      (["companyName", "country", "vatNumber"] as const)
        .filter((k) => (before[k] || null) !== (value[k] || null))
        .map((k) => ({ action: "update", entity: "settings", entityId: "company", field: k, oldValue: before[k] || null, newValue: value[k] || null, source: "setup" })),
    );
    // The town of delivery becomes the first destination only when there is none: a destination on file is the person's, and stays.
    if (value.deliveryCity && (await tx.select({ id: deliveryDestinations.id }).from(deliveryDestinations)).length === 0) {
      await saveDestination(txDb, { city: value.deliveryCity, province: value.deliveryProvince, country: value.country }, actor, t);
    }
  });
  await ensureWorkspaceOrg(db);
  return {};
}
