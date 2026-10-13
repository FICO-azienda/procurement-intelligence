/**
 * The cookies that say who is signed in, and how the workspace is reached.
 *
 * The workspace — everything a buyer does in the app — is used in one of two
 * ways, chosen where the app is run (WORKSPACE_ACCESS):
 *  - local (the default): on the company's own computer, open to whoever sits
 *    at it, as it always was;
 *  - login: on a server other companies can reach. Then nothing of the
 *    workspace answers without a signed-in person of the buyer, and the cookie
 *    carries a signature (AUTH_SECRET) that `src/proxy.ts` checks before a
 *    request reaches any page or action.
 *
 * The supplier portal always asks for a sign-in. Its cookie is a random token
 * looked up in the database on every request; so is the workspace's, once past
 * the proxy. No database is read here: this file is also loaded by the proxy.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const WORKSPACE_COOKIE = "pi_ws";
export const PORTAL_COOKIE = "pi_portal";
/** The language of the pages outside the workspace: chosen by whoever reads them. */
export const LANGUAGE_COOKIE = "pi_lang";

export type WorkspaceAccess = "local" | "login";
export const workspaceAccess = (): WorkspaceAccess => (process.env.WORKSPACE_ACCESS === "login" ? "login" : "local");

/** The secret the workspace cookie is signed with. Null: not set, or too short to be one. */
export const authSecret = (): string | null => {
  const s = process.env.AUTH_SECRET;
  return s && s.length >= 32 ? s : null;
};

/**
 * In local mode the workspace has no sign-in, so it must answer only to the computer it runs on. A request is taken
 * as local when the address it was made to is this computer's own name (localhost, 127.0.0.1, ::1, *.localhost) or
 * one the owner listed in WORKSPACE_HOSTS. The address is what a browser typed: this stops a page opened from another
 * machine and a foreign site pointed here; the real lock is the server listening on 127.0.0.1 only (package.json).
 */
export function isLocalAddress(host: string | null | undefined, extra: string | undefined = process.env.WORKSPACE_HOSTS): boolean {
  const name = (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1");
  if (!name) return false;
  if (name === "localhost" || name === "127.0.0.1" || name === "::1" || name.endsWith(".localhost")) return true;
  return (extra ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean).includes(name);
}

const sign = (value: string, secret: string) => createHmac("sha256", secret).update(value).digest("base64url");

/** A session token with its expiry and a signature over both: what the workspace cookie holds in login mode. */
export function seal(token: string, expiresAt: Date, secret: string): string {
  const body = `${token}.${Math.floor(expiresAt.getTime() / 1000)}`;
  return `${body}.${sign(body, secret)}`;
}

/** The token of a sealed cookie, when its signature is right and it has not expired. */
export function unseal(value: string | null | undefined, secret: string, now = Date.now()): string | null {
  const parts = (value ?? "").split(".");
  if (parts.length !== 3) return null;
  const [token, exp, sig] = parts;
  const expected = Buffer.from(sign(`${token}.${exp}`, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return Number(exp) * 1000 > now && token ? token : null;
}
