/**
 * Who may do what in the buyer's workspace — checked on the server, for every
 * action and every route that answers with data, from the session read in the
 * database at that instant (`workspacePrincipal`). A page that hides a button
 * protects nothing: this does.
 *
 *  - on the company's own computer (no sign-in) the person at it is the buyer
 *    and may do everything, as always;
 *  - with sign-in, nobody signed in — or a session that was ended or expired —
 *    gets nothing; a person gets what their membership gives at this instant.
 *
 * Reading the workspace needs a session and nothing more; every write names
 * the permission it needs (`PERMISSIONS.buyer`).
 */
import { getT } from "@/lib/data";
import type { Msg } from "@/lib/i18n";
import type { Permission, Principal } from "@/lib/orders/types";
import { workspacePrincipal } from "./session";

export const SIGNED_OUT: Msg = "Your session has ended: sign in again.";
export const NOT_ALLOWED: Msg = "You are not allowed to do this: ask an administrator of your company.";

export type Refusal = { ok: false; error: string };

/** The decision itself, pure: null when allowed, else why not. */
export function decide(who: Pick<Principal, "side" | "permissions"> | null, permission: Permission | null): Msg | null {
  if (!who || who.side !== "buyer") return SIGNED_OUT;
  if (permission && !who.permissions.includes(permission)) return NOT_ALLOWED;
  return null;
}

/**
 * For a server action: null when the person may go on, else the refusal to
 * return as it is — every action of the workspace answers `{ ok, error }`.
 */
export async function refuse(permission: Permission | null): Promise<Refusal | null> {
  const why = decide(await workspacePrincipal(), permission);
  return why ? { ok: false, error: (await getT())(why) } : null;
}

/** For a route handler: who is asking, or the response to send instead (401 nobody signed in, 403 not allowed). */
export async function routeAccess(permission: Permission | null): Promise<{ who: Principal; response?: undefined } | { who?: undefined; response: Response }> {
  const who = await workspacePrincipal();
  const why = decide(who, permission);
  if (!why) return { who: who! };
  const t = await getT();
  return { response: new Response(t(why), { status: why === SIGNED_OUT ? 401 : 403, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }) };
}
