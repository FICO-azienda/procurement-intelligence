/**
 * Companies with an account, their people, and how a supplier comes to have
 * one. Rules that must hold:
 *
 *  - the buyer's own company is the one in Settings: its organisation is a
 *    copy kept the same, never a second place to write its name;
 *  - a supplier's organisation is born only when a person of that company
 *    accepts an invitation: nothing in the buyer's records — a supplier on its
 *    invoices, a company that answered a request, a company of a market
 *    directory — becomes a registered company by itself, and none of those
 *    records is changed when one registers;
 *  - an invitation is a link given to the buyer, who sends it: the app sends
 *    nothing. Only the hash of the link is kept;
 *  - what a company needs before it can take orders is asked once (who it is,
 *    a verified address, where it works, a person who may act, the service
 *    conditions accepted) — never per article;
 *  - an email address is verified only by typing the code sent to it. With no
 *    way to send email switched on, no address is verified, and it is said.
 */
import { randomInt } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { notifications, orgInvites, orgMembers, organizations, rfqSuppliers, settings, suppliers, tradeRelationships, users } from "@/db/schema";
import { COMPANY_NAME } from "@/lib/config";
import { en, type T } from "@/lib/i18n";
import { orgGaps, type OrgFacts, type OrgRequirement } from "@/lib/orders/ready";
import { ORDER_CONFIG, ORDER_TERMS_VERSION, PERMISSIONS, permissionsOf, type Permission, type Principal, type Role } from "@/lib/orders/types";
import type { Actor } from "@/lib/replies/types";
import { logEvents } from "./audit";
import { emailKey, hashPassword, isEmail, newToken, passwordProblem, tokenHash } from "./auth";
import type { Mailer } from "./mail";

export class OrgError extends Error {}

const clean = (v: string | null | undefined) => {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return s ? s : null;
};

/** How what a principal does is written in the change log. */
export const actorOf = (who: Principal): Actor => ({ type: who.actorType, id: who.name });

/** Refuses what a principal is not on the right side, or not allowed, to do. */
export function must(who: Principal, side: Principal["side"], permission: Permission | null, t: T = en): void {
  if (who.side !== side) throw new OrgError(t("This is not yours to do."));
  if (permission && !who.permissions.includes(permission)) throw new OrgError(t("Your account is not allowed to do this."));
}

// ---------------- The buyer's own company ----------------

/** The organisation of the company this installation is the workspace of: made once, then kept the same as Settings. */
export async function ensureWorkspaceOrg(db: DB): Promise<{ id: string; name: string }> {
  const [[row], [own]] = await Promise.all([db.select().from(settings).limit(1), db.select().from(organizations).where(eq(organizations.isWorkspace, true))]);
  const name = row?.companyName?.trim() || COMPANY_NAME;
  const facts = { name, vatNumber: row?.vatNumber ?? null, country: row?.country ?? null };
  if (!own) {
    const [made] = await db.insert(organizations).values({ kind: "buyer", isWorkspace: true, ...facts }).returning({ id: organizations.id });
    return { id: made.id, name };
  }
  if (own.name !== facts.name || own.vatNumber !== facts.vatNumber || own.country !== facts.country) await db.update(organizations).set({ ...facts, updatedAt: new Date() }).where(eq(organizations.id, own.id));
  return { id: own.id, name };
}

// ---------------- A company and its people ----------------

export interface OrgUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: Role;
  /** What they may do in this company: everything of its side for an admin, else what was given. */
  permissions: Permission[];
  disabled: boolean;
}

export interface OrgView {
  id: string;
  kind: "buyer" | "supplier";
  name: string;
  vatNumber: string | null;
  taxCode: string | null;
  country: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  conditionsAccepted: { version: string; at: string; by: string | null } | null;
  users: OrgUser[];
  facts: OrgFacts;
  /** What the company still has to give before any article can take orders. */
  gaps: OrgRequirement[];
}

export async function readOrg(db: DB, orgId: string): Promise<OrgView | null> {
  const [[org], members] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, orgId)),
    db.select({ member: orgMembers, user: users }).from(orgMembers).innerJoin(users, eq(orgMembers.userId, users.id)).where(eq(orgMembers.orgId, orgId)).orderBy(asc(orgMembers.createdAt)),
  ]);
  if (!org) return null;
  const kind = org.kind === "supplier" ? "supplier" : "buyer";
  const people: OrgUser[] = members.map(({ member, user }) => ({
    id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerifiedAt != null, role: member.role === "admin" ? "admin" : "member", permissions: permissionsOf(kind, member.role, member.permissions), disabled: member.disabledAt != null,
  }));
  const active = people.filter((u) => !u.disabled);
  const facts: OrgFacts = {
    name: org.name,
    vatNumber: org.vatNumber,
    taxCode: org.taxCode,
    address: org.address,
    city: org.city,
    country: org.country,
    // The address orders are written to: of a person who can answer them.
    emailVerified: active.some((u) => u.emailVerified && u.permissions.includes("order.respond")),
    authorisedUser: active.some((u) => u.permissions.includes("order.respond")) && active.some((u) => u.permissions.includes("terms.edit")),
    termsVersion: org.orderTermsVersion,
  };
  return {
    id: org.id,
    kind,
    name: org.name,
    vatNumber: org.vatNumber,
    taxCode: org.taxCode,
    country: org.country,
    address: org.address,
    postalCode: org.postalCode,
    city: org.city,
    province: org.province,
    conditionsAccepted: org.orderTermsVersion && org.orderTermsAcceptedAt ? { version: org.orderTermsVersion, at: org.orderTermsAcceptedAt.toISOString(), by: org.orderTermsAcceptedBy } : null,
    users: people,
    facts,
    gaps: orgGaps(facts),
  };
}

export const COMPANY_FIELDS = ["name", "vatNumber", "taxCode", "address", "postalCode", "city", "province", "country"] as const;
export type CompanyField = (typeof COMPANY_FIELDS)[number];

/** The supplier's own company data, as its people state it. */
export async function saveCompany(db: DB, who: Principal, v: Partial<Record<CompanyField, string | null>>, t: T = en): Promise<void> {
  must(who, "supplier", "company.manage", t);
  const values = Object.fromEntries(COMPANY_FIELDS.filter((f) => f in v).map((f) => [f, clean(v[f])])) as Partial<Record<CompanyField, string | null>>;
  if ("name" in values && !values.name) throw new OrgError(t("The company needs its name."));
  const [org] = await db.select().from(organizations).where(eq(organizations.id, who.orgId));
  const changed = COMPANY_FIELDS.filter((f) => f in values && (values[f] ?? null) !== (org[f] ?? null));
  if (!changed.length) return;
  await db.transaction(async (tx) => {
    await tx.update(organizations).set({ ...(values as Partial<typeof organizations.$inferInsert>), updatedAt: new Date() }).where(eq(organizations.id, who.orgId));
    await logEvents(tx as unknown as DB, actorOf(who), changed.map((f) => ({ action: "update", entity: "organization", entityId: who.orgId, field: f, oldValue: org[f], newValue: values[f] ?? null, source: "portal" })));
  });
}

/** An authorised person accepts the conditions of the order service for the company: which version, who, when. */
export async function acceptConditions(db: DB, who: Principal, t: T = en): Promise<void> {
  must(who, "supplier", "company.manage", t);
  await db.transaction(async (tx) => {
    await tx.update(organizations).set({ orderTermsVersion: ORDER_TERMS_VERSION, orderTermsAcceptedAt: new Date(), orderTermsAcceptedBy: who.name, updatedAt: new Date() }).where(eq(organizations.id, who.orgId));
    await logEvents(tx as unknown as DB, actorOf(who), [{ action: "accept_conditions", entity: "organization", entityId: who.orgId, newValue: ORDER_TERMS_VERSION, source: "portal" }]);
  });
}

/**
 * Another person of the same company, with a role and what they may do. Only
 * permissions of the company's own side can be given. A person who has an
 * account already — they belong to another company — is added to this one
 * with the account they have: their password is theirs, and is not touched.
 */
export async function addUser(db: DB, who: Principal, v: { name: string; email: string; password: string; role?: string; permissions: string[] }, t: T = en): Promise<string> {
  must(who, who.side, "company.manage", t);
  const name = clean(v.name);
  const email = emailKey(v.email);
  if (!isEmail(email)) throw new OrgError(t("This does not look like an email address."));
  const [known] = await db.select().from(users).where(eq(users.email, email));
  if (!known) {
    if (!name) throw new OrgError(t("Say who this person is."));
    const weak = passwordProblem(v.password, t);
    if (weak) throw new OrgError(weak);
  } else if ((await db.select({ id: orgMembers.id }).from(orgMembers).where(and(eq(orgMembers.userId, known.id), eq(orgMembers.orgId, who.orgId)))).length) {
    throw new OrgError(t("This person belongs to your company already."));
  }
  const role: Role = v.role === "admin" ? "admin" : "member";
  const allowed = PERMISSIONS[who.side] as readonly string[];
  const passwordHash = known ? null : await hashPassword(v.password);
  return db.transaction(async (tx) => {
    const userId = known?.id ?? (await tx.insert(users).values({ name: name!, email, passwordHash: passwordHash! }).returning({ id: users.id }))[0].id;
    await tx.insert(orgMembers).values({ orgId: who.orgId, userId, role, permissions: role === "admin" ? [] : v.permissions.filter((p) => allowed.includes(p)) });
    await logEvents(tx as unknown as DB, actorOf(who), [{ action: "add_user", entity: "organization", entityId: who.orgId, newValue: `${known?.name ?? name} <${email}> · ${role}`, source: who.side === "supplier" ? "portal" : "ui" }]);
    return userId;
  });
}

/** Switches a person off in this company, or lets them in again. Their account, and their place in other companies, stay as they are. */
export async function setUserDisabled(db: DB, who: Principal, userId: string, disabled: boolean, t: T = en): Promise<void> {
  must(who, who.side, "company.manage", t);
  if (userId === who.userId) throw new OrgError(t("You cannot switch off your own account."));
  const [row] = await db.select({ member: orgMembers, user: users }).from(orgMembers).innerJoin(users, eq(orgMembers.userId, users.id)).where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, who.orgId)));
  if (!row) throw new OrgError(t("This person is not of your company."));
  await db.transaction(async (tx) => {
    await tx.update(orgMembers).set({ disabledAt: disabled ? new Date() : null, updatedAt: new Date() }).where(eq(orgMembers.id, row.member.id));
    await logEvents(tx as unknown as DB, actorOf(who), [{ action: disabled ? "disable_user" : "enable_user", entity: "organization", entityId: who.orgId, newValue: row.user.email, source: who.side === "supplier" ? "portal" : "ui" }]);
  });
}

// ---------------- Verifying an email address ----------------

const codeHash = (userId: string, code: string) => tokenHash(`${userId}:${code}`);

/**
 * Sends the signed-in person a code to their own address. With no way to
 * send email switched on, nothing is sent and nothing is stored: the address
 * stays unverified, and the answer says why.
 */
export async function sendEmailCode(db: DB, who: Principal, mailer: Mailer | null, t: T = en): Promise<{ sent: boolean; to: string | null }> {
  if (!who.userId) throw new OrgError(t("Sign in first."));
  const [user] = await db.select().from(users).where(eq(users.id, who.userId));
  if (!user) throw new OrgError(t("Sign in first."));
  if (user.emailVerifiedAt) return { sent: false, to: user.email };
  if (!mailer) return { sent: false, to: null };
  const code = String(randomInt(100000, 1000000));
  await db.update(users).set({ emailCodeHash: codeHash(user.id, code), emailCodeExpiresAt: new Date(Date.now() + ORDER_CONFIG.emailCodeMinutes * 60_000), emailCodeAttempts: 0, updatedAt: new Date() }).where(eq(users.id, user.id));
  await mailer.send({
    to: user.email,
    subject: t("Your verification code"),
    text: t("Your code is {code}. It holds for {n} minutes. If you did not ask for it, ignore this message.", { code, n: ORDER_CONFIG.emailCodeMinutes }),
  });
  return { sent: true, to: user.email };
}

export async function verifyEmailCode(db: DB, who: Principal, code: string, t: T = en): Promise<void> {
  if (!who.userId) throw new OrgError(t("Sign in first."));
  const [user] = await db.select().from(users).where(eq(users.id, who.userId));
  if (!user || user.emailVerifiedAt) return;
  if (!user.emailCodeHash || !user.emailCodeExpiresAt || user.emailCodeExpiresAt < new Date()) throw new OrgError(t("There is no code to check, or it has expired: ask for a new one."));
  if (user.emailCodeAttempts >= ORDER_CONFIG.emailCodeAttempts) throw new OrgError(t("Too many wrong codes: ask for a new one."));
  if (codeHash(user.id, code.replace(/\s+/g, "")) !== user.emailCodeHash) {
    await db.update(users).set({ emailCodeAttempts: user.emailCodeAttempts + 1 }).where(eq(users.id, user.id));
    throw new OrgError(t("This is not the code that was sent."));
  }
  await db.transaction(async (tx) => {
    await tx.update(users).set({ emailVerifiedAt: new Date(), emailCodeHash: null, emailCodeExpiresAt: null, emailCodeAttempts: 0, updatedAt: new Date() }).where(eq(users.id, user.id));
    await logEvents(tx as unknown as DB, actorOf(who), [{ action: "verify_email", entity: "organization", entityId: who.orgId, newValue: user.email, source: "portal" }]);
  });
}

// ---------------- Invitations ----------------

/** The record of the buyer an invitation or a channel is about. */
export type RecordRef = { kind: "supplier"; id: string } | { kind: "reply"; id: string };

const refWhere = (ref: RecordRef) => (ref.kind === "supplier" ? eq(orgInvites.supplierId, ref.id) : eq(orgInvites.rfqSupplierId, ref.id));

/**
 * Invites one company the buyer knows. The link is returned once, to be sent
 * by the buyer; an earlier link for the same company stops working.
 */
export async function inviteCompany(db: DB, who: Principal, ref: RecordRef, email: string, t: T = en): Promise<{ inviteId: string; token: string; expiresAt: string }> {
  must(who, "buyer", "channel.manage", t);
  const to = emailKey(email);
  if (!isEmail(to)) throw new OrgError(t("This does not look like an email address."));
  const [record] = ref.kind === "supplier" ? await db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, ref.id)) : await db.select({ name: rfqSuppliers.name }).from(rfqSuppliers).where(eq(rfqSuppliers.id, ref.id));
  if (!record) throw new OrgError(t("This company is no longer on file."));
  const linked = await db
    .select({ id: tradeRelationships.id })
    .from(tradeRelationships)
    .where(and(eq(tradeRelationships.buyerOrgId, who.orgId), ref.kind === "supplier" ? eq(tradeRelationships.supplierId, ref.id) : eq(tradeRelationships.rfqSupplierId, ref.id)));
  if (linked.length) throw new OrgError(t("This company is registered already."));
  const token = newToken();
  const expiresAt = new Date(Date.now() + ORDER_CONFIG.inviteDays * 86_400_000);
  const [row] = await db.transaction(async (tx) => {
    await tx.update(orgInvites).set({ revokedAt: new Date() }).where(and(eq(orgInvites.buyerOrgId, who.orgId), refWhere(ref), isNull(orgInvites.acceptedAt), isNull(orgInvites.revokedAt)));
    const made = await tx
      .insert(orgInvites)
      .values({ tokenHash: tokenHash(token), buyerOrgId: who.orgId, supplierId: ref.kind === "supplier" ? ref.id : null, rfqSupplierId: ref.kind === "reply" ? ref.id : null, companyName: record.name, email: to, createdBy: who.name, expiresAt })
      .returning({ id: orgInvites.id });
    await logEvents(tx as unknown as DB, actorOf(who), [{ action: "invite", entity: ref.kind === "supplier" ? "supplier" : "rfq_supplier", entityId: ref.id, newValue: to, source: "ui" }]);
    return made;
  });
  return { inviteId: row.id, token, expiresAt: expiresAt.toISOString() };
}

export async function revokeInvite(db: DB, who: Principal, inviteId: string, t: T = en): Promise<void> {
  must(who, "buyer", "channel.manage", t);
  await db.update(orgInvites).set({ revokedAt: new Date() }).where(and(eq(orgInvites.id, inviteId), eq(orgInvites.buyerOrgId, who.orgId), isNull(orgInvites.acceptedAt)));
}

export interface InviteView {
  id: string;
  companyName: string;
  buyerName: string;
  email: string;
  /** open: can be accepted · accepted · expired · revoked */
  state: "open" | "accepted" | "expired" | "revoked";
}

/** What an invitation link says, to whoever holds it. Null: no such link. */
export async function readInvite(db: DB, token: string): Promise<InviteView | null> {
  const [row] = await db.select({ invite: orgInvites, buyer: organizations.name }).from(orgInvites).innerJoin(organizations, eq(orgInvites.buyerOrgId, organizations.id)).where(eq(orgInvites.tokenHash, tokenHash(token)));
  if (!row) return null;
  const i = row.invite;
  return { id: i.id, companyName: i.companyName, buyerName: row.buyer, email: i.email, state: i.acceptedAt ? "accepted" : i.revokedAt ? "revoked" : i.expiresAt < new Date() ? "expired" : "open" };
}

export interface Registration {
  companyName: string;
  vatNumber: string | null;
  taxCode: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  userName: string;
  email: string;
  password: string;
}

/**
 * A person of the invited company accepts: the company gets its organisation
 * and its first person (who may do everything), and the channel with the
 * buyer opens. A company that has an account already — invited before by
 * another buyer — accepts with the person signed in, and only the channel is
 * added. The buyer's own record of the company is not touched.
 */
export async function acceptInvite(db: DB, token: string, by: { register: Registration } | { who: Principal }, t: T = en): Promise<{ orgId: string; userId: string | null; relationshipId: string }> {
  const [invite] = await db.select().from(orgInvites).where(eq(orgInvites.tokenHash, tokenHash(token)));
  if (!invite || invite.revokedAt) throw new OrgError(t("This invitation is not valid."));
  if (invite.acceptedAt) throw new OrgError(t("This invitation was accepted already: sign in."));
  if (invite.expiresAt < new Date()) throw new OrgError(t("This invitation has expired: ask the company that invited you for a new one."));

  let register: (Registration & { email: string; passwordHash: string }) | null = null;
  if ("register" in by) {
    const r = by.register;
    const email = emailKey(r.email);
    if (!clean(r.companyName)) throw new OrgError(t("The company needs its name."));
    if (!clean(r.vatNumber) && !clean(r.taxCode)) throw new OrgError(t("Give the VAT number or the tax code of the company."));
    if (!clean(r.userName)) throw new OrgError(t("Say who you are."));
    if (!isEmail(email)) throw new OrgError(t("This does not look like an email address."));
    const weak = passwordProblem(r.password, t);
    if (weak) throw new OrgError(weak);
    if ((await db.select({ id: users.id }).from(users).where(eq(users.email, email))).length) throw new OrgError(t("An account with this address exists already: sign in, then open the invitation again."));
    register = { ...r, email, passwordHash: await hashPassword(r.password) };
  } else {
    must(by.who, "supplier", "company.manage", t);
  }

  return db.transaction(async (tx) => {
    let orgId: string;
    let userId: string | null = null;
    let name: string;
    if (register) {
      const [org] = await tx
        .insert(organizations)
        .values({ kind: "supplier", name: clean(register.companyName)!, vatNumber: clean(register.vatNumber), taxCode: clean(register.taxCode), address: clean(register.address), postalCode: clean(register.postalCode), city: clean(register.city), province: clean(register.province), country: clean(register.country) })
        .returning({ id: organizations.id, name: organizations.name });
      // Whoever registers a company is its first admin: somebody has to be able to do everything.
      const [user] = await tx.insert(users).values({ name: clean(register.userName)!, email: register.email, passwordHash: register.passwordHash }).returning({ id: users.id });
      await tx.insert(orgMembers).values({ orgId: org.id, userId: user.id, role: "admin" });
      orgId = org.id;
      userId = user.id;
      name = org.name;
    } else {
      const who = (by as { who: Principal }).who;
      orgId = who.orgId;
      name = who.orgName;
      const [same] = await tx.select({ id: tradeRelationships.id }).from(tradeRelationships).where(and(eq(tradeRelationships.buyerOrgId, invite.buyerOrgId), eq(tradeRelationships.supplierOrgId, orgId)));
      if (same) throw new OrgError(t("Your company has a channel with this customer already."));
    }
    const [rel] = await tx.insert(tradeRelationships).values({ buyerOrgId: invite.buyerOrgId, supplierOrgId: orgId, supplierId: invite.supplierId, rfqSupplierId: invite.rfqSupplierId }).returning({ id: tradeRelationships.id });
    await tx.update(orgInvites).set({ acceptedAt: new Date(), acceptedOrgId: orgId }).where(eq(orgInvites.id, invite.id));
    await tx.insert(notifications).values({ orgId: invite.buyerOrgId, kind: "supplier_registered", params: { company: name } });
    await logEvents(tx as unknown as DB, { type: "supplier", id: register ? clean(register.userName) : (by as { who: Principal }).who.name }, [
      { action: "register", entity: "organization", entityId: orgId, newValue: name, source: "portal", note: `invite ${invite.id}` },
    ]);
    return { orgId, userId, relationshipId: rel.id };
  });
}
