/**
 * Everything the supplier portal writes comes through here — one entry, never
 * a server action: server actions are the workspace's, and the proxy refuses
 * them without a workspace session. Each operation establishes who is asking
 * from the portal's own cookie, checked against the database, and the server
 * functions it calls answer only about that company.
 *
 * A request from another site is refused (the origin must be this one), and
 * the cookie is not sent along with cross-site posts.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getDb, type DB } from "@/db";
import { todayISO } from "@/lib/analytics";
import { LANGUAGE_COOKIE, PORTAL_COOKIE } from "@/lib/auth/cookie";
import { isLocale, type T } from "@/lib/i18n";
import type { Principal, Terms } from "@/lib/orders/types";
import { AuthError, endSession, signIn, startSession } from "@/server/auth";
import { mailerFromEnv } from "@/server/mail";
import { OrderError, saveOrderProduct, saveTerms, setAudience, setCustomerOrdering, setProductOrders, withdrawReserved, type ProductInput } from "@/server/order-catalog";
import { acceptOrder, markNotificationsRead, proposeChanges, rejectOrder } from "@/server/orders";
import { OrgError, acceptConditions, acceptInvite, addUser, saveCompany, sendEmailCode, setUserDisabled, verifyEmailCode, type CompanyField, type Registration } from "@/server/orgs";
import { directOrderOn, getOutsideT, supplierPrincipal } from "@/server/session";

type Args = Record<string, unknown>;
type Out = Record<string, unknown> | void;

const text = (v: unknown) => (typeof v === "string" ? v : "");
const textOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

/** What a signed-in person of a supplier can do. */
const OPS: Record<string, (db: DB, who: Principal, a: Args, t: T) => Promise<Out>> = {
  saveCompany: (db, who, a, t) => saveCompany(db, who, a as Partial<Record<CompanyField, string | null>>, t),
  acceptConditions: (db, who, _a, t) => acceptConditions(db, who, t),
  sendEmailCode: (db, who, _a, t) => sendEmailCode(db, who, mailerFromEnv(), t),
  verifyEmail: (db, who, a, t) => verifyEmailCode(db, who, text(a.code), t),
  addUser: async (db, who, a, t) => void (await addUser(db, who, { name: text(a.name), email: text(a.email), password: text(a.password), role: text(a.role), permissions: Array.isArray(a.permissions) ? a.permissions.filter((p): p is string => typeof p === "string") : [] }, t)),
  setUserDisabled: (db, who, a, t) => setUserDisabled(db, who, text(a.userId), a.disabled === true, t),
  saveProduct: async (db, who, a, t) => ({ id: await saveOrderProduct(db, who, a as unknown as ProductInput, t) }),
  saveTerms: (db, who, a, t) => saveTerms(db, who, { orderProductId: text(a.orderProductId), relationshipId: textOrNull(a.relationshipId), terms: (a.terms ?? {}) as Partial<Terms>, confirm: a.confirm === true }, todayISO(), t),
  withdrawReserved: (db, who, a, t) => withdrawReserved(db, who, text(a.orderProductId), text(a.relationshipId), t),
  setProductOrders: (db, who, a, t) => setProductOrders(db, who, text(a.orderProductId), a.action === "resume" ? "resume" : "suspend", t),
  setAudience: (db, who, a, t) => setAudience(db, who, text(a.orderProductId), a.audience === "selected" ? "selected" : "all", Array.isArray(a.allowed) ? a.allowed.filter((x): x is string => typeof x === "string") : [], t),
  setCustomerOrdering: (db, who, a, t) => setCustomerOrdering(db, who, text(a.relationshipId), a.ordering === "blocked" ? "blocked" : "allowed", t),
  acceptOrder: (db, who, a, t) => acceptOrder(db, who, text(a.orderId), { deliveryDate: textOrNull(a.deliveryDate), transportConfirmed: a.transportConfirmed === true }, todayISO(), t),
  proposeChanges: (db, who, a, t) => proposeChanges(db, who, text(a.orderId), a.changes, textOrNull(a.note), todayISO(), t),
  rejectOrder: (db, who, a, t) => rejectOrder(db, who, text(a.orderId), text(a.reason), t),
  markRead: (db, who, a) => markNotificationsRead(db, who, a.orderId || a.orderProductId ? { orderId: textOrNull(a.orderId) ?? undefined, orderProductId: textOrNull(a.orderProductId) ?? undefined } : undefined),
};

const sameSite = (request: NextRequest) => {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return new URL(origin).host === (request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  } catch {
    return false;
  }
};

export async function POST(request: NextRequest) {
  const t = await getOutsideT();
  const fail = (error: string, status = 200) => NextResponse.json({ ok: false, error }, { status });
  if (!sameSite(request)) return fail(t("This request did not come from the portal."), 403);
  if (!(await directOrderOn())) return fail(t("The supplier portal is not available."), 404);
  const body = (await request.json().catch(() => null)) as { op?: unknown; args?: unknown } | null;
  const op = text(body?.op);
  const args = (body?.args && typeof body.args === "object" ? body.args : {}) as Args;
  const secure = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const session = (res: NextResponse, token: string, expiresAt: Date) => (res.cookies.set(PORTAL_COOKIE, token, { httpOnly: true, sameSite: "lax", secure, path: "/portal", expires: expiresAt }), res);
  try {
    const db = await getDb();
    if (op === "language") {
      const res = NextResponse.json({ ok: true });
      if (isLocale(args.locale)) res.cookies.set(LANGUAGE_COOKIE, args.locale, { sameSite: "lax", secure, path: "/", maxAge: 365 * 86_400 });
      return res;
    }
    if (op === "signIn") {
      const made = await signIn(db, text(args.email), text(args.password), "supplier", t, textOrNull(args.orgId));
      return session(NextResponse.json({ ok: true }), made.token, made.expiresAt);
    }
    if (op === "signOut") {
      await endSession(db, request.cookies.get(PORTAL_COOKIE)?.value);
      const res = NextResponse.json({ ok: true });
      res.cookies.set(PORTAL_COOKIE, "", { httpOnly: true, sameSite: "lax", secure, path: "/portal", maxAge: 0 });
      return res;
    }
    const who = await supplierPrincipal();
    if (op === "acceptInvite") {
      // A person already signed in adds the channel to their company; anybody else registers the company.
      const made = await acceptInvite(db, text(args.token), who && !args.register ? { who } : { register: (args.register ?? {}) as Registration }, t);
      if (!made.userId) return NextResponse.json({ ok: true });
      const started = await startSession(db, made.userId, made.orgId);
      return session(NextResponse.json({ ok: true }), started.token, started.expiresAt);
    }
    if (!who) return fail(t("Sign in first."), 401);
    const run = OPS[op];
    if (!run) return fail(t("Something went wrong."), 400);
    return NextResponse.json({ ok: true, ...((await run(db, who, args, t)) ?? {}) });
  } catch (err) {
    if (err instanceof OrderError || err instanceof OrgError || err instanceof AuthError) return fail(err.message);
    console.error("[portal]", op, err);
    return fail(t("Something went wrong."), 500);
  }
}
