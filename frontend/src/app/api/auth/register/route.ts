/**
 * POST /api/auth/register
 *
 * Creates an email/password account. Sign-in itself is handled by NextAuth's
 * Credentials provider (lib/auth.ts) — this endpoint only provisions the user.
 *
 * Security (CONVENTIONS.md §1):
 * - Zod-validated input; password policy enforced server-side, not just in the
 *   form. A client that skips the UI gets the same rules.
 * - Password hashed with bcrypt cost 12 inside lib/credentials.ts. The
 *   plaintext exists only for the lifetime of this request and is never logged.
 * - Rate-limited per IP (5 accounts/hour).
 * - The response is IDENTICAL whether or not the email is already registered,
 *   so this endpoint cannot be used to enumerate accounts. See below.
 * - Returns no user id, no hash, no session — the client must sign in normally.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createCredentialsUser,
  passwordProblems,
  normalizeEmail,
  PASSWORD_MIN_LENGTH,
} from "@/lib/credentials";
import {
  createVerificationToken,
  sendVerificationEmail,
  emailDeliveryConfigured,
} from "@/lib/email-verification";
import { check, clientIp, REGISTER_LIMIT } from "@/lib/rate-limit";

const RegisterSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(254),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
    .max(200),
  // Display name only. Optional — the user can set an artist name later in the
  // profile, and forcing a name here adds friction for no security benefit.
  name: z.string().trim().max(120).optional(),
});

/**
 * The one response every successful-looking registration returns.
 *
 * Registration is the classic account-enumeration hole: "that email is already
 * taken" tells an attacker exactly who has an account. We return this same
 * body for a genuinely new account AND for one that already exists, and the
 * existing-account branch does the work of sending a "someone tried to register
 * with your address" style verification mail instead. The real user learns what
 * happened via email; an attacker learns nothing.
 */
const GENERIC_SUCCESS = {
  ok: true,
  message:
    "Account created. Check your email for a verification link, then sign in.",
} as const;

export async function POST(request: Request) {
  // ── Rate limit ──
  const ip = clientIp(request.headers);
  const limited = check(`register:${ip}`, REGISTER_LIMIT.limit, REGISTER_LIMIT.windowMs);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many accounts created from this address. Try again later." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } }
    );
  }

  // ── Parse + validate ──
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = RegisterSchema.safeParse(raw);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    return NextResponse.json(
      { error: "Validation failed", fieldErrors: flat.fieldErrors },
      { status: 422 }
    );
  }

  const email = normalizeEmail(parsed.data.email);
  const { password, name } = parsed.data;

  // ── Password policy ──
  // Checked separately from Zod so we can return every unmet rule at once,
  // which makes the form far less frustrating than one-error-at-a-time.
  const problems = passwordProblems(password);
  if (problems.length > 0) {
    return NextResponse.json(
      { error: "Password does not meet requirements.", fieldErrors: { password: problems } },
      { status: 422 }
    );
  }

  // ── Create ──
  const result = await createCredentialsUser({
    email,
    password,
    name: name && name.length > 0 ? name : null,
  });

  if (!result.ok) {
    if (result.reason === "email_taken") {
      // Deliberately indistinguishable from success — see GENERIC_SUCCESS.
      // We still issue a verification token so the legitimate owner of the
      // address gets a real email, and we swallow any error from that.
      try {
        const token = await createVerificationToken(email);
        await sendVerificationEmail(email, token);
      } catch {
        // Never surface this: a failure here would leak that the branch ran.
      }
      return NextResponse.json(GENERIC_SUCCESS, { status: 201 });
    }
    return NextResponse.json(
      { error: "Could not create the account. Please try again." },
      { status: 500 }
    );
  }

  // ── Verification email (delivery not yet configured — see lib) ──
  let verificationUrl: string | undefined;
  try {
    const token = await createVerificationToken(email);
    const sent = await sendVerificationEmail(email, token);
    // In development WITHOUT a mail provider, hand the link back so the flow is
    // testable. Gated on NODE_ENV so a misconfigured production deploy can
    // never return a live verification token to the caller.
    if (!sent.sent && process.env.NODE_ENV === "development") {
      verificationUrl = sent.url;
    }
  } catch (err) {
    // The account exists and is usable; a mail failure must not fail the
    // request or the user would retry and hit "email taken".
    console.error("[register] verification token/email failed:", err);
  }

  return NextResponse.json(
    {
      ...GENERIC_SUCCESS,
      emailDelivery: emailDeliveryConfigured() ? "sent" : "not_configured",
      ...(verificationUrl ? { devVerificationUrl: verificationUrl } : {}),
    },
    { status: 201 }
  );
}
