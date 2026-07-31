/**
 * Credentials (email/password) data-access layer — SERVER ONLY.
 *
 * This is the ONLY module in the codebase that reads or writes
 * next_auth.user_credentials.password_hash. Nothing here is ever imported by a
 * Client Component; the "server-only" import below turns an accidental client
 * import into a build error rather than a silent bundle leak.
 *
 * Security properties (CONVENTIONS.md §1):
 * - Passwords are hashed with bcrypt (cost 12) and never stored in plaintext.
 * - The hash lives in its own table so the NextAuth Supabase adapter — which
 *   does `select *` on next_auth.users — can never serialise it into the JWT
 *   or the client-visible session. See migration 005.
 * - verifyCredentials() runs a bcrypt comparison against a decoy hash when the
 *   account does not exist, so a missing account and a wrong password take
 *   indistinguishable time (no user enumeration via response latency).
 * - Every returned object is an explicitly-constructed SafeUser. We never
 *   spread a database row, so a new column can never accidentally escape.
 */
import "server-only";

import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

/** bcrypt work factor. 12 ≈ 250ms on modern hardware — the OWASP floor. */
const BCRYPT_COST = 12;

/**
 * A real bcrypt hash of a random string nobody knows, used as the comparison
 * target when the email has no account.
 *
 * Without this, "no such user" would return in ~0ms while "wrong password"
 * takes ~250ms — a trivially measurable oracle for which emails are registered.
 *
 * LAZY: computed on first use, not at module load.
 *
 * The original top-level bcrypt.hashSync (cost 12 ≈ 330ms) ran synchronously
 * during every Next.js module evaluation — auth.ts imports credentials.ts,
 * and auth.ts is imported by every protected page. That blocked the compiler
 * thread for 330ms on every cold compile, making ghostwrite/posts appear frozen
 * while the dev server was simply stuck in a bcrypt spin. Moving it behind a
 * getter means the cost is paid once, on the first failed sign-in attempt, and
 * never during compilation.
 */
let _decoyHash: string | null = null;
function getDecoyHash(): string {
  if (!_decoyHash) {
    _decoyHash = bcrypt.hashSync(
      "chimera-decoy-" + Math.random().toString(36),
      BCRYPT_COST
    );
  }
  return _decoyHash;
}

/** The only user shape this module ever hands out. Deliberately has no hash. */
export interface SafeUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: string | null;
}

/**
 * Service-role Supabase client scoped to the next_auth schema.
 *
 * The service-role key is required here: next_auth.user_credentials grants
 * nothing to anon/authenticated (migration 005), and registration must write a
 * users row before any session exists. This key is read from a non-public env
 * var and this module is server-only, so it never reaches the browser.
 */
function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "[credentials] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return createClient(url, key, {
    db: { schema: "next_auth" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Canonical email form. Also enforced in Postgres by users_email_lower_unique. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ─── Password policy ──────────────────────────────────────────────────────────

/**
 * Password rules, enforced identically on the register route and (for clarity)
 * surfaced in the UI. Length is the dominant factor, so the floor is 12 rather
 * than the more common 8, and we require some variety without demanding the
 * unmemorable symbol-soup that pushes users toward reuse.
 *
 * bcrypt silently truncates input at 72 BYTES, so anything longer is rejected
 * outright — otherwise two different long passwords could authenticate the same
 * account.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;

export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    problems.push(`Must be at most ${PASSWORD_MAX_BYTES} bytes.`);
  }
  if (!/[a-z]/.test(password)) problems.push("Must include a lowercase letter.");
  if (!/[A-Z]/.test(password)) problems.push("Must include an uppercase letter.");
  if (!/[0-9]/.test(password)) problems.push("Must include a number.");
  return problems;
}

// ─── Lookups ──────────────────────────────────────────────────────────────────

/**
 * Look up a user by email. Returns null when no account exists.
 * Selects an explicit column list — never `*` — so the hash cannot ride along
 * even if the two tables are ever joined.
 */
export async function findUserByEmail(email: string): Promise<SafeUser | null> {
  const db = adminDb();
  const { data, error } = await db
    .from("users")
    .select('id, email, name, image, "emailVerified"')
    .eq("email", normalizeEmail(email))
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id as string,
    email: data.email as string,
    name: (data.name as string | null) ?? null,
    image: (data.image as string | null) ?? null,
    emailVerified: (data.emailVerified as string | null) ?? null,
  };
}

// ─── Registration ─────────────────────────────────────────────────────────────

export type CreateResult =
  | { ok: true; user: SafeUser }
  | { ok: false; reason: "email_taken" | "error" };

/**
 * Create a credentials user: a next_auth.users row plus its hashed password.
 *
 * Two accounts racing on the same email are resolved by the database, not by
 * the earlier existence check: users_email_lower_unique (migration 005) makes
 * the second insert fail with 23505, which we report as email_taken. Checking
 * first and inserting later would leave a TOCTOU window under concurrency.
 */
export async function createCredentialsUser(params: {
  email: string;
  password: string;
  name: string | null;
}): Promise<CreateResult> {
  const email = normalizeEmail(params.email);
  const db = adminDb();

  // Hash BEFORE inserting: if hashing throws we must not leave an orphan user
  // row that can never be signed into.
  const passwordHash = await bcrypt.hash(params.password, BCRYPT_COST);

  const { data: created, error: insertError } = await db
    .from("users")
    .insert({ email, name: params.name })
    .select('id, email, name, image, "emailVerified"')
    .single();

  if (insertError) {
    // 23505 = unique_violation → the email is already registered.
    if (insertError.code === "23505") return { ok: false, reason: "email_taken" };
    return { ok: false, reason: "error" };
  }

  const { error: credError } = await db
    .from("user_credentials")
    .insert({ user_id: created.id, password_hash: passwordHash });

  if (credError) {
    // Roll back the user row — a users row with no credentials row is an
    // account nobody can ever sign into, and it would squat the email.
    await db.from("users").delete().eq("id", created.id);
    return { ok: false, reason: "error" };
  }

  return {
    ok: true,
    user: {
      id: created.id as string,
      email: created.email as string,
      name: (created.name as string | null) ?? null,
      image: (created.image as string | null) ?? null,
      emailVerified: (created.emailVerified as string | null) ?? null,
    },
  };
}

// ─── Sign-in verification ─────────────────────────────────────────────────────

/**
 * Verify an email/password pair.
 *
 * Returns the SafeUser on success and null for EVERY failure mode — unknown
 * email, OAuth-only account, wrong password. The caller must not distinguish
 * between them in anything it shows the user.
 *
 * Timing: all three failure paths perform exactly one bcrypt comparison at the
 * same cost factor, so response time does not reveal whether the account
 * exists. (bcrypt.compare is itself constant-time over the digest.)
 */
export async function verifyCredentials(
  email: string,
  password: string
): Promise<SafeUser | null> {
  const user = await findUserByEmail(email);

  if (!user) {
    // Burn the same ~250ms a real comparison would take.
    await bcrypt.compare(password, getDecoyHash());
    return null;
  }

  const db = adminDb();
  const { data, error } = await db
    .from("user_credentials")
    .select("password_hash")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data?.password_hash) {
    // GitHub/Google-only account: exists, but has no password set.
    await bcrypt.compare(password, getDecoyHash());
    return null;
  }

  const matches = await bcrypt.compare(password, data.password_hash as string);
  return matches ? user : null;
}

/** Set (or replace) a user's password. Used by registration and password reset. */
export async function setPassword(userId: string, password: string): Promise<boolean> {
  const db = adminDb();
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const { error } = await db
    .from("user_credentials")
    .upsert(
      { user_id: userId, password_hash: passwordHash, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  return !error;
}

/** Mark an account's email as verified. Idempotent. */
export async function markEmailVerified(userId: string): Promise<boolean> {
  const db = adminDb();
  const { error } = await db
    .from("users")
    .update({ emailVerified: new Date().toISOString() })
    .eq("id", userId);
  return !error;
}
