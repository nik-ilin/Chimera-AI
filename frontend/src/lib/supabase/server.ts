/**
 * Supabase server client for use in Server Components and Route Handlers.
 *
 * Authenticates requests as the logged-in user by attaching the Supabase
 * JWT minted in the NextAuth session callback (anon key + Authorization
 * header). Postgres reads auth.uid()/auth.role() from that JWT to enforce
 * the owner-only RLS policies — so this client can only ever touch the
 * caller's own rows.
 *
 * The service-role key is NOT used here. Only FastAPI uses the service-role
 * key (see backend/services/supabase.py).
 *
 * See CONVENTIONS.md §1: Supabase, Sessions.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import type { Database } from "@/types/supabase";

export async function createClient() {
  const cookieStore = await cookies();
  const session = await auth();
  const accessToken = session?.supabaseAccessToken;

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: accessToken
        ? { headers: { Authorization: `Bearer ${accessToken}` } }
        : undefined,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll may throw in Server Components — ignore.
            // The middleware handles cookie refreshing.
          }
        },
      },
    }
  );
}
