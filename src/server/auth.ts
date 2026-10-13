/**
 * Passwords and sessions. A password is kept only as its scrypt hash with a
 * salt of its own; a session is a random token of which only the SHA-256 is
 * kept, so that nothing readable in the database can sign anybody in.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { authSessions, orgMembers, organizations, users } from "@/db/schema";
import { en, type T } from "@/lib/i18n";
import { ORDER_CONFIG, permissionsOf, type Principal, type Side } from "@/lib/orders/types";

export class AuthError extends Error {}

const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${(await derive(password, salt)).toString("base64url")}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const given = await derive(password, Buffer.from(salt, "base64url"));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const newToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const emailKey = (email: string | null | undefined) => (email ?? "").trim().toLowerCase();
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

export function passwordProblem(password: string, t: T = en): string | null {
  return password.length < ORDER_CONFIG.passwordMin ? t("The password needs at least {n} characters.", { n: ORDER_CONFIG.passwordMin }) : null;
}

export async function startSession(db: DB, userId: string, orgId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + ORDER_CONFIG.sessionDays * 86_400_000);
  await db.insert(authSessions).values({ userId, orgId, tokenHash: tokenHash(token), expiresAt });
  return { token, expiresAt };
}

export async function endSession(db: DB, token: string | null | undefined): Promise<void> {
  if (!token) return;
  await db.update(authSessions).set({ revokedAt: new Date() }).where(and(eq(authSessions.tokenHash, tokenHash(token)), isNull(authSessions.revokedAt)));
}

/**
 * Who a session token stands for, on the side asked: a live session of a
 * person who still belongs — and is not switched off — to the company the
 * session acts for, a company of that kind. A supplier's token is nobody in
 * the buyer's workspace, and the other way round. What the person may do is
 * read from their membership at this instant, never from the session.
 */
export async function principalOf(db: DB, token: string | null | undefined, side: Side): Promise<Principal | null> {
  if (!token) return null;
  const [row] = await db
    .select({ user: users, member: orgMembers, org: organizations })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .innerJoin(organizations, eq(authSessions.orgId, organizations.id))
    .innerJoin(orgMembers, and(eq(orgMembers.userId, users.id), eq(orgMembers.orgId, organizations.id)))
    .where(and(eq(authSessions.tokenHash, tokenHash(token)), isNull(authSessions.revokedAt), gt(authSessions.expiresAt, new Date())));
  if (!row || row.member.disabledAt || row.org.kind !== side) return null;
  if (side === "buyer" && !row.org.isWorkspace) return null;
  return { side, orgId: row.org.id, orgName: row.org.name, userId: row.user.id, name: row.user.name, permissions: permissionsOf(side, row.member.role, row.member.permissions), actorType: side === "supplier" ? "supplier" : "user" };
}

// A few wrong passwords in a row for one address: wait. Kept in memory — enough to slow a guesser on one server.
const FAILS = ((globalThis as unknown as { __signInFails?: Map<string, { n: number; until: number }> }).__signInFails ??= new Map());
const MAX_FAILS = 8;
const WINDOW = 15 * 60_000;

/** The companies of one side a person belongs to and is not switched off in, the one joined last first. */
export async function membershipsOf(db: DB, userId: string, side: Side): Promise<{ orgId: string; orgName: string }[]> {
  const rows = await db.select({ member: orgMembers, org: organizations }).from(orgMembers).innerJoin(organizations, eq(orgMembers.orgId, organizations.id)).where(eq(orgMembers.userId, userId)).orderBy(desc(orgMembers.createdAt));
  return rows.filter((r) => !r.member.disabledAt && r.org.kind === side && (side === "supplier" || r.org.isWorkspace)).map((r) => ({ orgId: r.org.id, orgName: r.org.name }));
}

/**
 * Signs a person in on one side, for one of their companies of that side —
 * the one asked for, else the one they joined last. A wrong address, a wrong
 * password and a person with no company on this side are answered the same way.
 */
export async function signIn(db: DB, email: string, password: string, side: Side, t: T = en, orgId?: string | null): Promise<{ token: string; expiresAt: Date; userId: string; orgId: string }> {
  const key = `${side}|${emailKey(email)}`;
  const fail = FAILS.get(key);
  if (fail && fail.n >= MAX_FAILS && fail.until > Date.now()) throw new AuthError(t("Too many attempts: wait a few minutes and try again."));
  const [user] = await db.select().from(users).where(eq(users.email, emailKey(email)));
  const companies = user && (await checkPassword(password, user.passwordHash)) ? await membershipsOf(db, user.id, side) : [];
  const company = companies.find((c) => c.orgId === orgId) ?? companies[0];
  if (!user || !company) {
    FAILS.set(key, { n: (fail && fail.until > Date.now() ? fail.n : 0) + 1, until: Date.now() + WINDOW });
    throw new AuthError(t("The address or the password is not right."));
  }
  FAILS.delete(key);
  return { ...(await startSession(db, user.id, company.orgId)), userId: user.id, orgId: company.orgId };
}
