/**
 * Who is making this request. The answer always comes from here — a cookie
 * checked against the database — and never from anything a page sends.
 *
 *  - the buyer's workspace: on the company's own computer (WORKSPACE_ACCESS
 *    unset) whoever sits at it is the buyer, as it always was; on a server
 *    (WORKSPACE_ACCESS=login) only a signed-in person of the buyer is;
 *  - the supplier portal: always a signed-in person of a supplier.
 *
 * A supplier's session is nobody in the workspace, and the other way round.
 */
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";
import { getDb } from "@/db";
import { settings } from "@/db/schema";
import { LANGUAGE_COOKIE, PORTAL_COOKIE, WORKSPACE_COOKIE, authSecret, unseal, workspaceAccess } from "@/lib/auth/cookie";
import { readSettings } from "@/lib/data";
import { isLocale, translator, type Locale, type T } from "@/lib/i18n";
import { PERMISSIONS, type Principal } from "@/lib/orders/types";
import { principalOf } from "./auth";
import { ensureWorkspaceOrg } from "./orgs";

/** Direct Order is switched on for this workspace (Settings). Off: none of it answers. */
export const directOrderOn = cache(async (): Promise<boolean> => {
  // Read when a request asks, never while the app is being built: a build must not open the data.
  await connection();
  const [row] = await (await getDb()).select({ on: settings.directOrder }).from(settings).limit(1);
  return row?.on === true;
});

/** The buyer at the workspace — or null when the workspace asks for a sign-in and nobody is signed in. */
export const workspacePrincipal = cache(async (): Promise<Principal | null> => {
  const jar = await cookies();
  const db = await getDb();
  if (workspaceAccess() === "login") {
    const secret = authSecret();
    return secret ? principalOf(db, unseal(jar.get(WORKSPACE_COOKIE)?.value, secret), "buyer") : null;
  }
  const [org, company] = await Promise.all([ensureWorkspaceOrg(db), readSettings(db)]);
  // An assistant operating the app says so with a cookie of its own: what it does is never recorded as the person's.
  const assistant = jar.get("pi_actor")?.value === "assistant";
  return { side: "buyer", orgId: org.id, orgName: org.name, userId: null, name: assistant ? "assistant" : (company.userName ?? company.companyName), permissions: [...PERMISSIONS.buyer], actorType: assistant ? "ai" : "user" };
});

/** The supplier's person signed in to the portal, or null. */
export const supplierPrincipal = cache(async (): Promise<Principal | null> => {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  return principalOf(await getDb(), token, "supplier");
});

/**
 * The language of the pages outside the workspace (the portal, the sign-in
 * page): the reader's own choice, else what their browser asks for. The
 * workspace's language is the buyer's setting and does not reach here.
 */
export const outsideLocale = cache(async (): Promise<Locale> => {
  const chosen = (await cookies()).get(LANGUAGE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  const asked = ((await headers()).get("accept-language") ?? "").toLowerCase();
  return asked.startsWith("it") ? "it" : "en";
});

export const getOutsideT = cache(async (): Promise<T> => translator(await outsideLocale()));
