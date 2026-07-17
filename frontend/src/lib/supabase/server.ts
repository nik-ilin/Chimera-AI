/**
 * Supabase server client for use in Server Components and Route Handlers.
 *
 * Reads the session cookie to authenticate requests as the logged-in user.
 * The service-role key is NOT used here — rows are still governed by RLS.
 * Only FastAPI uses the service-role key (see backend/services/supabase.py).
 *
 * See CONVENTIONS.md §1: Supabase, Sessions.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/supabase";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
