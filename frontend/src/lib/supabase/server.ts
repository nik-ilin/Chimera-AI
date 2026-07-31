/**
 * Supabase server clients for Route Handlers and Server Components.
 *
 * TWO clients, for two different security contexts:
 *
 * createClient()        — anon key + user JWT (RLS-enforced).
 *                         Use when SUPABASE_JWT_SECRET is correctly set and the
 *                         minted token verifies against the project's signing key.
 *
 * createServiceClient() — service-role key, bypasses RLS entirely.
 *                         SAFE ONLY in Server Components and Route Handlers that
 *                         already auth-guard with auth() and filter by
 *                         session.user.id. The service-role key is a non-public
 *                         env var and never reaches the browser.
 *                         Used as the primary client because Supabase's
 *                         "JWT Signing Keys" migration means the legacy
 *                         SUPABASE_JWT_SECRET may not match the key PostgREST
 *                         currently trusts, making user JWTs unreliable.
 *
 * See CONVENTIONS.md §1: Supabase, Sessions.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import type { Database } from "@/types/supabase";

/**
 * Service-role client — bypasses RLS.
 *
 * ONLY call this after validating the session with auth() and then filtering
 * every query with .eq("user_id", session.user.id).  Those two layers together
 * give the same ownership guarantee that RLS would provide.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "[supabase] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set."
    );
  }
  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Anon client with the user's Supabase JWT attached.
 *
 * Relies on SUPABASE_JWT_SECRET matching the key PostgREST trusts.
 * Kept for backwards compatibility; prefer createServiceClient() in Route
 * Handlers where auth() already enforces identity.
 */
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
