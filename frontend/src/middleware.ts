/**
 * Next.js middleware (Edge runtime).
 *
 * Optimistic route guard: redirects requests that carry NO NextAuth session
 * cookie away from protected routes, straight to /auth/signin. This is a UX
 * fast-path only — it checks for the *presence* of the session cookie, not its
 * validity.
 *
 * The AUTHORITATIVE auth check is always server-side: every protected Server
 * Component and Route Handler calls `auth()` and rejects (redirect / 401) when
 * the session is missing or invalid. See portal pages and /api/profile.
 *
 * Why not call `auth()` here? The full NextAuth instance (src/lib/auth.ts)
 * pulls in the Supabase adapter and `jsonwebtoken` (Node crypto), neither of
 * which runs on the Edge runtime. A cookie-presence check keeps the middleware
 * Edge-safe while the DB-backed session strategy stays server-side.
 *
 * See CONVENTIONS.md §1: Sessions.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/", "/auth/", "/api/auth/"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

// NextAuth v5 session cookie names: plain over http (dev), __Secure- prefixed
// over https (prod). We accept either so the guard works in both environments.
const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIES.some((name) => Boolean(request.cookies.get(name)?.value));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  if (!hasSessionCookie(request)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/auth/signin";
    redirectUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static assets and Next.js internals.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
