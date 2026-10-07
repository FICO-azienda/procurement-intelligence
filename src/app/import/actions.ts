"use server";

/**
 * Server actions for the import flow — thin wrappers around server/imports.ts.
 * They never throw to the browser: errors come back as plain messages.
 */
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { getT } from "@/lib/data";
import type { ProductKind } from "@/lib/catalog/kinds";
import type { ItemData } from "@/lib/import/types";
import * as catalog from "@/server/catalog";
import * as svc from "@/server/imports";
import { keepEstimateHistory } from "@/server/negotiation";
import { keepSuppliersResolved } from "@/server/suppliers";

export type ActionResult = { ok: boolean; error?: string };

const done = (): ActionResult => {
  revalidatePath("/", "layout");
  // An import may have created a supplier that a VAT number proves to be one already on file.
  keepSuppliersResolved();
  // New purchases change the price paid: the history of the negotiation estimates follows.
  keepEstimateHistory();
  return { ok: true };
};

async function run(fn: () => Promise<void | { error?: string }>): Promise<ActionResult> {
  try {
    const res = await fn();
    // The service speaks English; the reader gets their own language.
    if (res && "error" in res && res.error) return { ok: false, error: (await getT()).any(res.error) };
    return done();
  } catch (err) {
    console.error("[import action]", err);
    return { ok: false, error: (await getT())("Something went wrong. Your data is unchanged — please try again.") };
  }
}

export interface UploadResult {
  sessionIds: string[];
  /** Files that need the user before anything can be read from them (columns to check, or unreadable). */
  needsAttention: string[];
  error?: string;
}

/**
 * One file per call keeps the progress real ("Reading 3 of 12…"). The file
 * says what it is: spreadsheets are spreadsheets, PDFs are read as the invoice
 * or quote they declare to be.
 */
export async function uploadFiles(formData: FormData): Promise<UploadResult> {
  const requested = String(formData.get("kind") ?? "auto") as svc.UploadKind;
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size >= 0);
  if (!files.length) return { sessionIds: [], needsAttention: [], error: (await getT())("Choose at least one file.") };
  const db = await getDb();
  const sessionIds: string[] = [];
  const needsAttention: string[] = [];
  try {
    for (const f of files) {
      const isPdf = /\.pdf$/i.test(f.name);
      // An explicit choice only applies to the kind of file it makes sense for.
      const kind: svc.UploadKind = requested === "auto" || (requested === "spreadsheet") === isPdf ? "auto" : requested;
      const { sessionId } = await svc.createUpload(db, { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }, kind, { autoMap: true });
      sessionIds.push(sessionId);
      const s = await svc.getSession(db, sessionId);
      if (s && (s.status === "uploaded" || s.status === "failed")) needsAttention.push(sessionId);
    }
  } catch (err) {
    console.error("[upload]", err);
    return { sessionIds, needsAttention, error: (await getT())("Some files couldn't be uploaded. Please try again.") };
  }
  revalidatePath("/", "layout");
  return { sessionIds, needsAttention };
}

/** Rows copied from a spreadsheet and pasted as text: stored as a file, then imported like any other. */
export async function uploadPasted(text: string): Promise<{ sessionId?: string; error?: string }> {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  const t = await getT();
  if (!clean) return { error: t("Paste at least one row.") };
  if (clean.length > 2_000_000) return { error: t("That is a lot of rows — save them as a file and upload it instead.") };
  try {
    const db = await getDb();
    const stamp = new Date().toLocaleString("sv-SE").slice(0, 16).replace(":", ".");
    const { sessionId } = await svc.createUpload(db, { name: `${t("Pasted rows")} ${stamp}.tsv`, bytes: new TextEncoder().encode(clean) }, "auto", { autoMap: true });
    revalidatePath("/", "layout");
    return { sessionId };
  } catch (err) {
    console.error("[paste]", err);
    return { error: t("We couldn't read the pasted rows. Please try again.") };
  }
}

export async function saveMapping(sessionId: string, mapping: svc.MappingInfo) {
  return run(async () => svc.applyMapping(await getDb(), sessionId, mapping, await getT()));
}

export async function resolveSupplierAction(sessionId: string, groupKey: string, decision: svc.SupplierDecision) {
  return run(async () => svc.resolveSupplier(await getDb(), sessionId, groupKey, decision));
}

export async function resolveProductAction(sessionId: string, groupKey: string, decision: svc.ProductDecision) {
  return run(async () => svc.resolveProduct(await getDb(), sessionId, groupKey, decision));
}

export async function updateItemAction(itemId: string, patch: Partial<ItemData>) {
  return run(async () => svc.updateItem(await getDb(), itemId, patch));
}

export async function updateSessionFieldsAction(sessionId: string, patch: Partial<ItemData>) {
  return run(async () => svc.updateSessionFields(await getDb(), sessionId, patch));
}

export async function acknowledgeAction(target: { itemId: string } | { sessionId: string }) {
  return run(async () => svc.acknowledge(await getDb(), target));
}

export async function duplicateAction(target: { itemId: string } | { sessionId: string }, decision: "skip" | "import") {
  return run(async () => svc.decideDuplicate(await getDb(), target, decision));
}

export async function skipItemAction(itemId: string, skipped: boolean) {
  return run(async () => svc.setSkipped(await getDb(), itemId, skipped));
}

export async function duplicateFileAction(sessionId: string, decision: "skip" | "continue") {
  return run(async () => svc.decideDuplicateFile(await getDb(), sessionId, decision));
}

export async function approveAction(sessionId: string) {
  return run(async () => {
    const res = await svc.approveSession(await getDb(), sessionId);
    return res.error ? { error: res.error } : undefined;
  });
}

export async function reopenMappingAction(sessionId: string) {
  return run(async () => svc.reopenMapping(await getDb(), sessionId));
}

export async function reclassifyAction(sessionId: string, kind: "invoice" | "quote") {
  return run(async () => svc.reclassifyPdf(await getDb(), sessionId, kind));
}

/** Confirms the product groups the analysis is sure of: all of them, or the ones named (with the user's edits). */
export async function confirmProductsAction(
  sessionId: string,
  opts: { keys?: string[]; edits?: Record<string, catalog.DraftEdit>; separate?: string[] } = {},
): Promise<ActionResult & { created?: number; lines?: number }> {
  try {
    const res = await catalog.confirmDrafts(await getDb(), sessionId, { ...opts, t: await getT() });
    revalidatePath("/", "layout");
    return { ok: true, ...res };
  } catch (err) {
    console.error("[confirm products]", err);
    return { ok: false, error: (await getT())("Something went wrong. Check what was created before trying again.") };
  }
}

/** "They may be the same product": merge them into one, or keep them apart. */
export async function answerSameAction(sessionId: string, questionKey: string, decision: "merge" | "separate", name?: string) {
  return run(async () => catalog.answerSame(await getDb(), sessionId, questionKey, decision, { name, t: await getT() }));
}

/** "What are these?": the kind of spend the lines of a supplier are. */
export async function answerKindAction(sessionId: string, questionKey: string, kind: ProductKind) {
  return run(async () => catalog.answerKind(await getDb(), sessionId, questionKey, kind, { t: await getT() }));
}

/** Imports every ready line of every open file. */
export async function approveAllAction(): Promise<ActionResult & { imported?: number }> {
  try {
    const res = await svc.approveAllReady(await getDb());
    revalidatePath("/", "layout");
    return res.imported > 0 ? { ok: true, imported: res.imported } : { ok: false, error: (await getT())("No lines are ready to import yet.") };
  } catch (err) {
    console.error("[import all]", err);
    return { ok: false, error: (await getT())("Something went wrong. Nothing was imported — please try again.") };
  }
}

/** Creates every unknown supplier (or product) of a file as the file writes it. */
export async function createAllNewAction(sessionId: string, kind: "supplier" | "product"): Promise<ActionResult & { created?: number; left?: number }> {
  try {
    const res = await svc.createAllNew(await getDb(), sessionId, kind);
    revalidatePath("/", "layout");
    return { ok: true, ...res };
  } catch (err) {
    console.error("[create all]", err);
    return { ok: false, error: (await getT())("Something went wrong. Check what was created before trying again.") };
  }
}
