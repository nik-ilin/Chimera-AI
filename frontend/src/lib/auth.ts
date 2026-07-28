/**
 * NextAuth v5 configuration.
 *
 * Security rules (CONVENTIONS.md §1):
 * - Session validated server-side on every Route Handler.
 * - httpOnly, Secure, SameSite cookies are set by NextAuth default config.
 * - OAuth client secrets never leave this file.
 * - Supabase user_profile row is created/updated via a JWT callback.
 *
 * NOTE: SupabaseAdapter requires url + secret at module load time. We read
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY via requireEnv(),
 * which throws a clear, named error if either is missing — so an empty or
 * absent .env.local fails loudly at startup instead of surfacing later as a
 * confusing Supabase "invalid API key" error.
 *
 * ─── Phase 4: session strategy changed from "database" to "jwt" ───
 * Auth.js v5 CANNOT issue database sessions for the Credentials provider — the
 * adapter's createSession is never invoked on a credentials sign-in, so a
 * database-strategy setup silently produces a signed-in user with no session
 * row and every subsequent auth() returns null. JWT sessions are the only
 * supported strategy for Credentials.
 *
 * What this does NOT change: the adapter still persists OAuth users, accounts,
 * and linking into the next_auth schema, so GitHub sign-in behaves exactly as
 * before. What it DOES change: sessions live in the signed cookie rather than
 * next_auth.sessions, so pre-existing sessions are invalidated once — users
 * sign in again, nothing is lost. Rows already in next_auth.sessions are simply
 * ignored from here on.
 */
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { SupabaseAdapter } from "@auth/supabase-adapter";
import jwt from "jsonwebtoken";
import type { Provider } from "next-auth/providers";

import { verifyCredentials, normalizeEmail } from "@/lib/credentials";
import { verificationRequired } from "@/lib/email-verification";
import {
  check,
  reset,
  clientIp,
  LOGIN_IP_LIMIT,
  LOGIN_ACCOUNT_LIMIT,
} from "@/lib/rate-limit";

/**
 * Read a required environment variable, failing fast with a named error.
 * Prevents an empty/missing .env.local from masquerading as an opaque
 * "invalid key" error deep inside the Supabase adapter at request time.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[auth] Missing required environment variable: ${name}. ` +
        `Set it in frontend/.env.local (see .env.example).`
    );
  }
  return value;
}

// ─── Providers ────────────────────────────────────────────────────────────────

const providers: Provider[] = [
  GitHub({
    clientId: process.env.AUTH_GITHUB_ID || "",
    clientSecret: process.env.AUTH_GITHUB_SECRET || "",
  }),
];

/**
 * Google is registered only when its credentials exist. Registering it
 * unconditionally would put a button on the sign-in page that always fails with
 * an opaque OAuth error. `authProviders` below lets the UI render only what is
 * actually usable.
 */
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    })
  );
}

providers.push(
  Credentials({
    id: "credentials",
    name: "Email and password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },

    /**
     * Verify an email/password pair.
     *
     * Returns null for EVERY failure — bad input, throttled, unknown email,
     * wrong password, unverified account. Auth.js turns that into a single
     * generic CredentialsSignin error, so the client can never distinguish
     * "no such account" from "wrong password" and cannot enumerate users.
     * The password hash is never loaded into this scope; verifyCredentials
     * returns a SafeUser or null.
     */
    async authorize(credentials, request) {
      const email =
        typeof credentials?.email === "string" ? normalizeEmail(credentials.email) : "";
      const password =
        typeof credentials?.password === "string" ? credentials.password : "";

      if (!email || !password) return null;

      // Two independent budgets: per-IP stops one host stuffing many accounts,
      // per-account stops many hosts guessing one account. Both must pass.
      const ip = clientIp(request?.headers ?? new Headers());
      const ipCheck = check(`login:ip:${ip}`, LOGIN_IP_LIMIT.limit, LOGIN_IP_LIMIT.windowMs);
      const acctCheck = check(
        `login:acct:${email}`,
        LOGIN_ACCOUNT_LIMIT.limit,
        LOGIN_ACCOUNT_LIMIT.windowMs
      );
      if (!ipCheck.ok || !acctCheck.ok) return null;

      const user = await verifyCredentials(email, password);
      if (!user) return null;

      // Only enforced when an email provider is actually configured; see
      // lib/email-verification.ts. Otherwise nobody could ever sign in.
      if (verificationRequired() && !user.emailVerified) return null;

      // Successful sign-in clears the account budget so a user who mistyped a
      // few times isn't left locked out. The IP budget deliberately survives —
      // an attacker with one valid account should not be able to reset it.
      reset(`login:acct:${email}`);

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        emailVerified: user.emailVerified,
      };
    },
  })
);

/** Which OAuth providers the sign-in UI should offer. Safe to read client-side. */
export const authProviders = {
  github: Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
  google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
};

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Trust the host header. Required for `next start` / self-hosted and behind
  // proxies (Vercel, Railway, Render) — otherwise Auth.js v5 throws
  // UntrustedHost. The AUTH_TRUST_HOST env var alone is not always honoured, so
  // we set it explicitly here.
  trustHost: true,
  adapter: SupabaseAdapter({
    url: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    secret: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  }),
  // Required by the Credentials provider — see the note at the top of the file.
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  providers,
  callbacks: {
    /**
     * Runs on sign-in (with `user`) and on every subsequent request (without).
     * We copy only the fields the app needs onto the token.
     *
     * `user` here is the adapter row for OAuth or the object returned by
     * authorize() for credentials. NEITHER carries password_hash: the column
     * lives in next_auth.user_credentials, which the adapter never queries and
     * authorize() never selects. So the hash cannot reach this token — and the
     * token is what becomes the session cookie.
     */
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        // `emailVerified` is on AdapterUser but not the base User type, and the
        // adapter hands it back as a Date while authorize() returns a string.
        // Normalise to an ISO string — the token is JSON, so a Date would not
        // survive the round trip anyway.
        const verified = (user as { emailVerified?: Date | string | null }).emailVerified;
        token.emailVerifiedAt =
          verified instanceof Date ? verified.toISOString() : verified ?? null;
      }
      return token;
    },

    /**
     * Attach the Supabase user id to the session and mint a Supabase-compatible
     * JWT so Server Components and Route Handlers can query Supabase *as the
     * authenticated user* (anon key + RLS), not as the service role.
     *
     * The token is signed with SUPABASE_JWT_SECRET and carries `sub = user.id`
     * and `role = "authenticated"`. Postgres reads the `sub` claim via
     * next_auth.uid() to enforce the owner-only RLS policies (migrations 003,
     * 006). Identical for OAuth and credentials users, so RLS behaves the same
     * for both. See CONVENTIONS.md §1: Supabase, Sessions.
     */
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.emailVerifiedAt = token.emailVerifiedAt ?? null;

        const supabaseSecret = process.env.SUPABASE_JWT_SECRET;
        if (supabaseSecret) {
          const payload = {
            sub: token.sub,
            email: session.user.email,
            role: "authenticated",
          };
          session.supabaseAccessToken = jwt.sign(payload, supabaseSecret, {
            expiresIn: "1h",
          });
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  // Cookies: NextAuth v5 defaults to httpOnly, Secure, SameSite=Lax
  // which satisfies CONVENTIONS.md §1 session requirements.
});
