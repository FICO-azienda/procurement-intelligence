/**
 * The border in front of the app.
 *
 * On the company's own computer (local mode) the workspace has no sign-in:
 * it answers only to requests made to this computer's own address, and to
 * nobody who reaches it by another name.
 *
 * On a server other companies can reach (WORKSPACE_ACCESS=login):
 *
 * In login mode nothing of the buyer's workspace answers without a signed-in
 * person of the buyer: no page, no export, no server action. The supplier
 * portal and the sign-in page are let through — they check who is asking
 * themselves — but never a server action: every server action of this app
 * belongs to the workspace (the portal writes through its own route handler,
 * `/portal/api`), and a server action can be called from any address.
 *
 * Only the cookie's signature and expiry are checked here, with no database;
 * whoever handles the request checks the session itself (server/session.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import { WORKSPACE_COOKIE, authSecret, isLocalAddress, unseal, workspaceAccess } from "@/lib/auth/cookie";

const SIGN_IN = new Set(["/login", "/login/session"]);

export function proxy(request: NextRequest) {
  if (workspaceAccess() !== "login") {
    if (isLocalAddress(request.headers.get("host"))) return NextResponse.next();
    return new NextResponse("This workspace runs on its owner's computer and has no sign-in: it answers only there. To reach it from elsewhere it must run in sign-in mode.", { status: 403 });
  }
  const { pathname } = request.nextUrl;
  const action = request.headers.has("next-action");
  const portal = pathname === "/portal" || pathname.startsWith("/portal/");
  if (!action && (portal || SIGN_IN.has(pathname))) return NextResponse.next();
  const secret = authSecret();
  if (!secret) return new NextResponse("The workspace asks for a sign-in, but AUTH_SECRET is not set: nothing is served.", { status: 503 });
  if (unseal(request.cookies.get(WORKSPACE_COOKIE)?.value, secret)) return NextResponse.next();
  if (request.method === "GET" && !action) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return new NextResponse("Sign in first.", { status: 401 });
}

export const config = {
  // Everything but the app's own static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
