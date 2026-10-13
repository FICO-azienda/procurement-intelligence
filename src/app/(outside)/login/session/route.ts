/**
 * Signing in to the buyer's workspace, when it runs on a server
 * (WORKSPACE_ACCESS=login). On the company's own computer the workspace asks
 * for no sign-in, and this does not exist.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { WORKSPACE_COOKIE, authSecret, seal, unseal, workspaceAccess } from "@/lib/auth/cookie";
import { AuthError, endSession, signIn } from "@/server/auth";
import { getOutsideT } from "@/server/session";

const options = (request: NextRequest) => ({ httpOnly: true, sameSite: "lax" as const, secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https", path: "/" });

export async function POST(request: NextRequest) {
  const t = await getOutsideT();
  const secret = authSecret();
  if (workspaceAccess() !== "login" || !secret) return NextResponse.json({ ok: false, error: t("This workspace asks for no sign-in.") }, { status: 404 });
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))) return NextResponse.json({ ok: false, error: t("Something went wrong.") }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  try {
    const made = await signIn(await getDb(), typeof body?.email === "string" ? body.email : "", typeof body?.password === "string" ? body.password : "", "buyer", t);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(WORKSPACE_COOKIE, seal(made.token, made.expiresAt, secret), { ...options(request), expires: made.expiresAt });
    return res;
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ ok: false, error: err.message });
    console.error("[sign in]", err);
    return NextResponse.json({ ok: false, error: t("Something went wrong.") }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const secret = authSecret();
  if (secret) await endSession(await getDb(), unseal(request.cookies.get(WORKSPACE_COOKIE)?.value, secret));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(WORKSPACE_COOKIE, "", { ...options(request), maxAge: 0 });
  return res;
}
