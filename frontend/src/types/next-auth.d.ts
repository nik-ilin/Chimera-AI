/**
 * NextAuth v5 type extensions.
 * Adds the Supabase user id to the Session type.
 *
 * Note what is deliberately ABSENT: there is no password_hash field on Session
 * or JWT, and none should ever be added. The hash lives only in
 * next_auth.user_credentials and is read exclusively by lib/credentials.ts —
 * adding it here would be the first step toward serialising it into the session
 * cookie that ships to the browser.
 */
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      /**
       * ISO timestamp, or null when the address is unverified.
       *
       * Named `emailVerifiedAt`, NOT `emailVerified`: Auth.js already declares
       * `emailVerified: Date` on AdapterUser, and module augmentation INTERSECTS
       * rather than overrides — reusing the name yields the uninhabitable type
       * `Date & string`. A distinct name keeps our ISO-string representation
       * (which is what survives JSON serialisation into the JWT) clean.
       */
      emailVerifiedAt?: string | null;
    };
    /**
     * Supabase-compatible JWT (signed with SUPABASE_JWT_SECRET) used to
     * authenticate PostgREST/Supabase requests as the owner under RLS.
     */
    supabaseAccessToken?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** ISO timestamp, or null when the address is unverified. */
    emailVerifiedAt?: string | null;
  }
}
