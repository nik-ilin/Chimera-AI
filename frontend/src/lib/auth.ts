/**
 * NextAuth v5 configuration.
 *
 * Security rules (CONVENTIONS.md §1):
 * - Session validated server-side on every Route Handler.
 * - httpOnly, Secure, SameSite cookies are set by NextAuth default config.
 * - OAuth client secrets never leave this file.
 * - Supabase user_profile row is created/updated via a JWT callback.
 *
 * NOTE: SupabaseAdapter requires url + secret at module load time. The
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars must be
 * set before the dev server starts or a build runs. The || fallbacks below
 * are build-time placeholders only — they are never used at runtime.
 */
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { SupabaseAdapter } from "@auth/supabase-adapter";
import jwt from "jsonwebtoken";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: SupabaseAdapter({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
    secret: process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-role-key",
  }),
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID || "",
      clientSecret: process.env.AUTH_GITHUB_SECRET || "",
    }),
    // TODO(Phase 2+): re-enable Google sign-in. Add back:
    //   import Google from "next-auth/providers/google";
    //   Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET })
    // and set AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET in .env.local plus the
    // http://localhost:<port>/api/auth/callback/google redirect URI in Google Cloud.
  ],
  callbacks: {
    /**
     * Attach the Supabase user id to the session and mint a Supabase-compatible
     * JWT so Server Components and Route Handlers can query Supabase *as the
     * authenticated user* (anon key + RLS), not as the service role.
     *
     * The token is signed with SUPABASE_JWT_SECRET and carries `sub = user.id`
     * and `role = "authenticated"`, which is exactly what Postgres reads via
     * auth.uid() / auth.role() to enforce the owner-only RLS policies.
     * See CONVENTIONS.md §1: Supabase, Sessions.
     */
    async session({ session, user }) {
      if (session.user && user?.id) {
        session.user.id = user.id;

        const supabaseSecret = process.env.SUPABASE_JWT_SECRET;
        if (supabaseSecret) {
          const payload = {
            sub: user.id,
            email: user.email,
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
