/**
 * Email verification — token lifecycle + delivery adapter. SERVER ONLY.
 *
 * ⚠️ DELIVERY IS NOT CONFIGURED. The full token flow below is real and working:
 * tokens are generated with CSPRNG randomness, stored HASHED, single-use, and
 * expiry-checked. The only missing piece is an outbound email provider.
 *
 * Without RESEND_API_KEY set, sendVerificationEmail() logs the verification URL
 * to the server console instead of sending it — so the flow is fully testable
 * in development, and production loudly warns rather than silently dropping
 * mail. See the "TODO(email)" block in sendVerificationEmail for the ~10 lines
 * that make it live.
 *
 * Because delivery is unavailable, REQUIRE_EMAIL_VERIFICATION defaults to
 * FALSE: unverified users can still sign in. Flip it to "true" once a provider
 * is configured, otherwise you will lock every new user out of the product.
 */
import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { createClient } from "@supabase/supabase-js";

/** Tokens expire 24h after issue. */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "[email-verification] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return createClient(url, key, {
    db: { schema: "next_auth" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** True only when an email provider is actually configured. */
export function emailDeliveryConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Whether an unverified user is blocked from signing in.
 * Defaults to false — see the module docstring for why.
 */
export function verificationRequired(): boolean {
  return process.env.REQUIRE_EMAIL_VERIFICATION === "true";
}

/**
 * Store the SHA-256 of the token, not the token itself.
 *
 * verification_tokens rows are readable by anyone with database access; a
 * plaintext token there is a bearer credential that would let a reader verify
 * (or, in a reset flow, take over) another account. Hashing makes a leaked
 * table useless. SHA-256 with no salt is correct here — unlike a password, the
 * token is 256 bits of CSPRNG output, so there is nothing to brute-force.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issue a verification token for `email` and return the RAW token.
 * The raw value is returned exactly once, to be embedded in the email link; only
 * its hash is persisted.
 */
export async function createVerificationToken(email: string): Promise<string> {
  const db = adminDb();
  const identifier = email.trim().toLowerCase();

  // Invalidate any outstanding tokens for this address — a "resend" must not
  // leave the previous link usable.
  await db.from("verification_tokens").delete().eq("identifier", identifier);

  const raw = randomBytes(32).toString("hex");
  const { error } = await db.from("verification_tokens").insert({
    identifier,
    token: hashToken(raw),
    expires: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`Could not create verification token: ${error.message}`);

  return raw;
}

export type ConsumeResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Validate and burn a verification token.
 *
 * Single-use: the row is deleted before success is reported, so a replayed link
 * fails. Expiry is enforced in application code because the column has no
 * database-level constraint.
 */
export async function consumeVerificationToken(raw: string): Promise<ConsumeResult> {
  const db = adminDb();
  const hashed = hashToken(raw);

  const { data, error } = await db
    .from("verification_tokens")
    .select("identifier, token, expires")
    .eq("token", hashed)
    .maybeSingle();

  if (error || !data) return { ok: false, reason: "invalid" };

  // The lookup above already matched on the hash, so this comparison is
  // belt-and-braces against a future change that fetches by identifier instead.
  const a = Buffer.from(data.token as string);
  const b = Buffer.from(hashed);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid" };
  }

  // Burn it regardless of expiry — an expired token should not linger.
  await db.from("verification_tokens").delete().eq("token", hashed);

  if (new Date(data.expires as string).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, email: data.identifier as string };
}

/**
 * Send the verification email.
 *
 * NOT WIRED TO A PROVIDER. With RESEND_API_KEY absent this logs the URL and
 * returns { sent: false }, which callers surface to the user as "check the
 * server logs" in development. It never throws — a mail failure must not roll
 * back a successful registration.
 */
export async function sendVerificationEmail(
  email: string,
  token: string
): Promise<{ sent: boolean; url: string }> {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3005";
  const url = `${base}/auth/verify?token=${encodeURIComponent(token)}`;

  if (!emailDeliveryConfigured()) {
    console.warn(
      `[email-verification] RESEND_API_KEY is not set — no email was sent.\n` +
        `  Verify ${email} manually with this link:\n  ${url}`
    );
    return { sent: false, url };
  }

  // TODO(email): provider is configured but the call is not implemented.
  // Uncomment after `npm install resend` and verifying the sending domain:
  //
  //   const { Resend } = await import("resend");
  //   await new Resend(process.env.RESEND_API_KEY!).emails.send({
  //     from: process.env.EMAIL_FROM ?? "Chimera <noreply@chimera.app>",
  //     to: email,
  //     subject: "Verify your Chimera account",
  //     html: `<p>Welcome to Chimera. <a href="${url}">Verify your email</a>.</p>
  //            <p>This link expires in 24 hours.</p>`,
  //   });
  //   return { sent: true, url };
  console.warn(
    "[email-verification] RESEND_API_KEY is set but the Resend call is still " +
      "commented out in lib/email-verification.ts — no email was sent."
  );
  return { sent: false, url };
}
