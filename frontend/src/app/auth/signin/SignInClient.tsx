"use client";
/**
 * Sign-in form — Client Component.
 *
 * OAuth is triggered via server-side NextAuth handlers (/api/auth/*); the
 * credentials path posts to the Credentials provider with redirect:false so we
 * can render an inline error instead of bouncing to /auth/error.
 *
 * Security: the error copy below is deliberately a SINGLE generic string. The
 * server already refuses to distinguish "unknown email" from "wrong password"
 * from "throttled" (see authorize() in lib/auth.ts) — showing different
 * messages here would reintroduce the account-enumeration oracle the backend
 * works to avoid.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import AuthField from "@/components/auth/AuthField";

const SignInSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

type FormValues = z.infer<typeof SignInSchema>;

/** One message for every credential failure. See the note in the file header. */
const GENERIC_FAILURE = "Email or password is incorrect.";

interface SignInClientProps {
  callbackUrl: string;
  providers: { github: boolean; google: boolean };
}

export default function SignInClient({ callbackUrl, providers }: SignInClientProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(SignInSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: FormValues) {
    setFormError(null);

    const result = await signIn("credentials", {
      email: values.email,
      password: values.password,
      redirect: false,
    });

    if (!result || result.error) {
      setFormError(GENERIC_FAILURE);
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  const anyOAuth = providers.github || providers.google;

  return (
    <div className="flex flex-col">
      {/* ── Credentials form ── */}
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        <AuthField
          label="Email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          required
          error={errors.email?.message}
          {...register("email")}
        />

        <AuthField
          label="Password"
          type="password"
          placeholder="••••••••••••"
          autoComplete="current-password"
          required
          error={errors.password?.message}
          {...register("password")}
        />

        {formError && (
          <div
            role="alert"
            className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive animate-scale-in"
          >
            {formError}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center justify-center gap-2 w-full rounded-pill px-4 py-3 text-sm font-medium text-chimera-cream bg-chimera-clay shadow-clay-glow transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {anyOAuth && (
        <>
          {/* ── Divider ── */}
          <div className="flex items-center gap-3 my-6" role="separator">
            <span className="h-px flex-1 bg-border" />
            <span className="u-label text-muted-foreground/70">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          {/* ── OAuth ── */}
          <div className="flex flex-col gap-2.5">
            {providers.github && (
              <button
                type="button"
                disabled={oauthPending !== null}
                onClick={() => {
                  setOauthPending("github");
                  signIn("github", { callbackUrl });
                }}
                className="flex items-center justify-center gap-3 w-full rounded-pill px-4 py-3 text-sm font-medium text-background bg-foreground transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-60"
              >
                {oauthPending === "github" ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                  </svg>
                )}
                Continue with GitHub
              </button>
            )}

            {/* Rendered only when AUTH_GOOGLE_ID/SECRET are configured — an
                always-visible button that 500s is worse than no button. */}
            {providers.google && (
              <button
                type="button"
                disabled={oauthPending !== null}
                onClick={() => {
                  setOauthPending("google");
                  signIn("google", { callbackUrl });
                }}
                className="flex items-center justify-center gap-3 w-full rounded-pill px-4 py-3 text-sm font-medium text-foreground bg-card border border-border transition-colors hover:bg-secondary disabled:opacity-60"
              >
                {oauthPending === "google" ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                )}
                Continue with Google
              </button>
            )}
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground text-center mt-7">
        New to Chimera?{" "}
        <Link
          href="/auth/register"
          className="text-chimera-clay font-medium hover:underline underline-offset-4"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
