/**
 * NextAuth v5 catch-all route handler.
 * Handles all OAuth callback, sign-in, and sign-out requests.
 * CONVENTIONS.md §1: All OAuth flows handled server-side.
 */
// This route uses OAuth and session tokens — must never be statically rendered.
export const dynamic = "force-dynamic";

import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
