/**
 * NextAuth v5 type extensions.
 * Adds the Supabase user id to the Session type.
 */
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
