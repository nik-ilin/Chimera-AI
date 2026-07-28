/**
 * /auth/verify?token=… — Server Component.
 *
 * Landing page for the link in the verification email. Validates and burns the
 * token server-side, marks the address verified, and renders the outcome.
 *
 * force-dynamic + the absence of any caching is essential: this page has a side
 * effect (it consumes a single-use token), so it must never be prerendered or
 * cached at build time.
 */
export const dynamic = "force-dynamic";

import Link from "next/link";
import { CheckCircle2, XCircle, Clock } from "lucide-react";

import { consumeVerificationToken } from "@/lib/email-verification";
import { findUserByEmail, markEmailVerified } from "@/lib/credentials";

type Outcome = "verified" | "expired" | "invalid";

async function verify(token: string | undefined): Promise<Outcome> {
  if (!token) return "invalid";

  const result = await consumeVerificationToken(token);
  if (!result.ok) return result.reason === "expired" ? "expired" : "invalid";

  const user = await findUserByEmail(result.email);
  // Token was valid but the account is gone (deleted between issue and click).
  if (!user) return "invalid";

  const ok = await markEmailVerified(user.id);
  return ok ? "verified" : "invalid";
}

const COPY: Record<Outcome, { title: string; body: string }> = {
  verified: {
    title: "Email verified",
    body: "Your address is confirmed. You can sign in to your creator portal.",
  },
  expired: {
    title: "Link expired",
    body: "Verification links are valid for 24 hours. Request a new one from the sign-in page.",
  },
  invalid: {
    title: "Link not valid",
    body: "This link has already been used or is not recognised. Request a new one from the sign-in page.",
  },
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const outcome = await verify(token);
  const { title, body } = COPY[outcome];

  const Icon =
    outcome === "verified" ? CheckCircle2 : outcome === "expired" ? Clock : XCircle;

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="widget p-8 text-center">
          <div
            className={[
              "w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-5",
              outcome === "verified"
                ? "bg-chimera-clay shadow-clay-glow"
                : "bg-secondary",
            ].join(" ")}
          >
            <Icon
              className={[
                "w-5 h-5",
                outcome === "verified" ? "text-chimera-cream" : "text-muted-foreground",
              ].join(" ")}
              aria-hidden="true"
            />
          </div>

          <div className="u-label text-muted-foreground mb-2">Account</div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{body}</p>

          <Link
            href="/auth/signin"
            className="mt-7 inline-flex items-center justify-center w-full rounded-pill px-4 py-3 text-sm font-medium text-background bg-foreground transition-all hover:opacity-90 active:scale-[0.99]"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
