/**
 * Auth error page — shown by NextAuth when OAuth fails.
 */
import Link from "next/link";

export default function AuthErrorPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          Authentication error
        </h1>
        <p className="text-muted-foreground text-sm mb-2">
          {searchParams.error ?? "An unknown error occurred."}
        </p>
        <p className="text-xs text-muted-foreground mb-6">
          Check that your OAuth app credentials are set correctly in your
          environment variables.
        </p>
        <Link
          href="/auth/signin"
          className="text-sm font-medium text-chimera-purple hover:underline"
        >
          ← Back to sign in
        </Link>
      </div>
    </main>
  );
}
