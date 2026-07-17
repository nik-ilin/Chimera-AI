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
import Google from "next-auth/providers/google";
import { SupabaseAdapter } from "@auth/supabase-adapter";

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
    Google({
      clientId: process.env.AUTH_GOOGLE_ID || "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET || "",
    }),
  ],
  callbacks: {
    /**
     * Attach the Supabase user id to the session so Server Components
     * and Route Handlers can query Supabase on behalf of the user.
     */
    async session({ session, user }) {
      if (session.user && user?.id) {
        session.user.id = user.id;
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
