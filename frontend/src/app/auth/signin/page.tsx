/**
 * Sign-in page — Server Component shell.
 *
 * Was a Client Component in Stage B (OAuth buttons only). It is now a Server
 * Component because it needs to read which OAuth providers are actually
 * configured (`authProviders`, derived from server-only env vars) and hand that
 * down to the form. The interactive parts live in SignInClient.
 *
 * Security: no credentials are handled here. OAuth goes through the server-side
 * NextAuth handlers under /api/auth/*, and the credentials form posts to the
 * Credentials provider.
 */
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

import { auth, authProviders } from "@/lib/auth";
import SignInClient from "./SignInClient";

/**
 * Only same-origin relative paths are honoured. Accepting an absolute URL would
 * make /auth/signin?callbackUrl=https://evil.example an open redirect that
 * lands the user off-site immediately after authenticating.
 */
function safeCallback(raw: string | undefined): string {
  if (!raw) return "/portal/musician";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/portal/musician";
  return raw;
}

export default async function SignInPage({
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
          {/* Logo */}
          <div className="flex flex-col items-center mb-7">
            <div className="w-12 h-12 rounded-2xl bg-chimera-clay flex items-center justify-center mb-5 shadow-clay-glow">
              <span className="text-chimera-cream font-bold text-xl">C</span>
            </div>
            <div className="u-label text-muted-foreground mb-2">Welcome to</div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
              Chimera
            </h1>
            <p className="text-muted-foreground text-sm mt-2 text-center">
              Sign in to access your creator portal.
            </p>
          </div>

          <SignInClient callbackUrl={safeCallback(callbackUrl)} providers={authProviders} />

          <p className="u-label text-muted-foreground/70 text-center mt-7 leading-relaxed normal-case tracking-normal">
            By signing in you agree to use this platform responsibly.
          </p>
        </div>
      </div>
    </main>
  );
}
