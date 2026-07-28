/**
 * /auth/register — Server Component shell.
 *
 * Redirects an already-authenticated visitor to the portal rather than showing
 * them a sign-up form, and passes a validated callbackUrl down to the client
 * form. Everything interactive lives in RegisterClient.
 */
export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import RegisterClient from "./RegisterClient";

/**
 * Only same-origin relative paths are accepted as a post-registration
 * destination. An absolute URL here would turn the sign-up link into an open
 * redirect that phishing pages could point at their own domain.
 */
function safeCallback(raw: string | undefined): string {
  if (!raw) return "/portal/musician";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/portal/musician";
  return raw;
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/portal/musician");

  const { callbackUrl } = await searchParams;

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="widget p-8">
          <div className="flex flex-col items-center mb-7">
            <div className="w-12 h-12 rounded-2xl bg-chimera-clay flex items-center justify-center mb-5 shadow-clay-glow">
              <span className="text-chimera-cream font-bold text-xl">C</span>
            </div>
            <div className="u-label text-muted-foreground mb-2">Join</div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
              Create account
            </h1>
            <p className="text-muted-foreground text-sm mt-2 text-center leading-relaxed">
              Your AI record label, in one place.
            </p>
          </div>

          <RegisterClient callbackUrl={safeCallback(callbackUrl)} />

          <p className="text-xs text-muted-foreground text-center mt-6">
            Already have an account?{" "}
            <Link
              href="/auth/signin"
              className="text-chimera-clay font-medium hover:underline underline-offset-4"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
