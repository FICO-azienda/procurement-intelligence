"use server";

/**
 * Server actions for the import flow — thin wrappers around server/imports.ts.
 * They never throw to the browser: errors come back as plain messages.
 */
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import type { ItemData } from "@/lib/import/types";
import * as svc from "@/server/imports";

export type ActionResult = { ok: boolean; error?: string };

const done = (): ActionResult => {
  revalidatePath("/", "layout");
  return { ok: true };
};

async function run(fn: () => Promise<void | { error?: string }>): Promise<ActionResult> {
  try {
    const res = await fn();
    if (res && "error" in res && res.error) return { ok: false, error: res.error };
    return done();
  } catch (err) {
    console.error("[import action]", err);
    return { ok: false, error: "Something went wrong. Your data is unchanged — please try again." };
  }
}

export async function uploadFiles(formData: FormData): Promise<{ sessionIds: string[]; error?: string }> {
  const kind = String(formData.get("kind") ?? "spreadsheet") as svc.UploadKind;
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size >= 0);
  if (!files.length) return { sessionIds: [], error: "Choose at least one file." };
  const db = await getDb();
  const sessionIds: string[] = [];
  try {
    for (const f of files) {
      // PDFs dropped in the generic area: a quote if the name says so.
      const k: svc.UploadKind =
        kind === "spreadsheet" && /\.pdf$/i.test(f.name)
          ? /(offerta|preventivo|quot|listino|price)/i.test(f.name)
            ? "quote"
            : "invoice"
          : kind !== "spreadsheet" && !/\.pdf$/i.test(f.name)
            ? "spreadsheet"
            : kind;
      const { sessionId } = await svc.createUpload(db, { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }, k);
      sessionIds.push(sessionId);
    }
  } catch (err) {
    console.error("[upload]", err);
    return { sessionIds, error: "Some files couldn't be uploaded. Please try again." };
  }
  revalidatePath("/", "layout");
  return { sessionIds };
}

export async function saveMapping(sessionId: string, mapping: svc.MappingInfo) {
  return run(async () => svc.applyMapping(await getDb(), sessionId, mapping));
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
