"use server";

/**
 * What the buyer does in Direct Order. Every action establishes who is asking
 * from the request itself (server/session.ts) before it does anything — the
 * workspace's own person, with what they may do — and none answers while
 * Direct Order is switched off. The supplier's side does not come through
 * here: it has its own entry (`/portal/api`).
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getDb, type DB } from "@/db";
import { WORKSPACE_COOKIE, authSecret, unseal } from "@/lib/auth/cookie";
import { settings } from "@/db/schema";
import { todayISO } from "@/lib/analytics";
import { getT } from "@/lib/data";
import type { T } from "@/lib/i18n";
import type { OrderStatus, Principal } from "@/lib/orders/types";
import { AuthError } from "@/server/auth";
import { OrderError, askConditions, tieListing } from "@/server/order-catalog";
import { cancelOrder, completeOrder, createOrder, decideProposal, markNotificationsRead, sendDraft } from "@/server/orders";
import { OrgError, addUser, changePassword, inviteCompany, revokeInvite, setUserDisabled, type RecordRef } from "@/server/orgs";
import { directOrderOn, workspacePrincipal } from "@/server/session";

export type OrderResult<R = unknown> = ({ ok: true } & R) | { ok: false; error: string };

async function run<R extends object>(work: (db: DB, who: Principal, t: T) => Promise<R | void>, needsFlag = true): Promise<OrderResult<R>> {
  const t = await getT();
  try {
    if (needsFlag && !(await directOrderOn())) return { ok: false, error: t("Direct Order is not switched on for this workspace.") };
    const who = await workspacePrincipal();
    if (!who) return { ok: false, error: t("Sign in first.") };
    const out = await work(await getDb(), who, t);
    revalidatePath("/", "layout");
    return { ok: true, ...((out ?? {}) as R) };
  } catch (err) {
    if (err instanceof OrderError || err instanceof OrgError || err instanceof AuthError) return { ok: false, error: err.message };
    console.error("[direct order]", err);
    return { ok: false, error: t("Something went wrong.") };
  }
}

/** Switches Direct Order on or off for this workspace. Off, nothing of it is shown and nothing can be ordered; nothing is deleted. */
export async function setDirectOrderAction(on: boolean): Promise<OrderResult> {
  return run(async (db, who, t) => {
    if (!who.permissions.includes("company.manage")) throw new OrgError(t("Your account is not allowed to do this."));
    await db.insert(settings).values({ id: 1, directOrder: on }).onConflictDoUpdate({ target: settings.id, set: { directOrder: on, updatedAt: new Date() } });
  }, false);
}

/** Invites a company the buyer knows. The link comes back once: the buyer sends it — the app sends nothing. */
export async function inviteCompanyAction(ref: RecordRef, email: string): Promise<OrderResult<{ path: string; expiresAt: string }>> {
  return run(async (db, who, t) => {
    const made = await inviteCompany(db, who, ref, email, t);
    return { path: `/portal/invite/${made.token}`, expiresAt: made.expiresAt };
  });
}

export async function revokeInviteAction(inviteId: string): Promise<OrderResult> {
  return run((db, who, t) => revokeInvite(db, who, inviteId, t));
}

export async function tieListingAction(orderProductId: string, productId: string | null): Promise<OrderResult> {
  return run((db, who, t) => tieListing(db, who, orderProductId, productId, t));
}

export async function askConditionsAction(orderProductId: string): Promise<OrderResult<{ asked: boolean }>> {
  return run((db, who, t) => askConditions(db, who, orderProductId, t));
}

export interface OrderRequest {
  idempotencyKey: string;
  orderProductId: string;
  quantity: number;
  destinationId: string;
  wantedDate: string | null;
  notes: string | null;
  send: boolean;
}

export async function requestOrderAction(v: OrderRequest): Promise<OrderResult<{ id: string; number: string; status: OrderStatus }>> {
  return run((db, who, t) => createOrder(db, who, v, todayISO(), t));
}

export async function sendDraftAction(orderId: string): Promise<OrderResult<{ sent: boolean; refreshed: boolean }>> {
  return run((db, who, t) => sendDraft(db, who, orderId, todayISO(), t));
}

export async function cancelOrderAction(orderId: string, reason: string | null): Promise<OrderResult> {
  return run((db, who, t) => cancelOrder(db, who, orderId, reason, t));
}

export async function completeOrderAction(orderId: string): Promise<OrderResult> {
  return run((db, who, t) => completeOrder(db, who, orderId, t));
}

export async function decideProposalAction(orderId: string, accept: boolean, v: { specApproved?: boolean; note?: string | null }): Promise<OrderResult> {
  return run(async (db, who, t) => void (await decideProposal(db, who, orderId, accept, v, t)));
}

export async function markOrdersReadAction(orderId?: string): Promise<OrderResult> {
  return run((db, who) => markNotificationsRead(db, who, orderId ? { orderId } : undefined));
}

/** A person of the buyer who can sign in to the workspace when it runs on a server (WORKSPACE_ACCESS=login). */
export async function addWorkspaceUserAction(v: { name: string; email: string; password: string; role: string; permissions: string[] }): Promise<OrderResult> {
  return run(async (db, who, t) => void (await addUser(db, who, v, t)), false);
}

export async function setWorkspaceUserDisabledAction(userId: string, disabled: boolean): Promise<OrderResult> {
  return run((db, who, t) => setUserDisabled(db, who, userId, disabled, t), false);
}

/** The signed-in person changes their own password; every other browser signed in with the account is signed out. */
export async function changePasswordAction(current: string, next: string): Promise<OrderResult> {
  return run(async (db, who, t) => {
    const secret = authSecret();
    const token = secret ? unseal((await cookies()).get(WORKSPACE_COOKIE)?.value, secret) : null;
    await changePassword(db, who, String(current ?? ""), String(next ?? ""), token, t);
  }, false);
}
