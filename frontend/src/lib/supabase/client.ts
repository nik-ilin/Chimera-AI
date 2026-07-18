/**
 * Supabase browser client (safe to use in Client Components).
 *
 * Uses the public anon key — safe because RLS policies restrict all
 * row access to the authenticated owner (next_auth.uid() = user_id).
 * See CONVENTIONS.md §1: Supabase.
 */
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/supabase";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
