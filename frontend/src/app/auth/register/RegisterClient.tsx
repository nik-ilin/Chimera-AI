"use client";
/**
 * Register — Client Component.
 *
 * Posts to /api/auth/register (which hashes + creates the user), then signs the
 * user straight in with the Credentials provider so they land in the portal
 * without retyping anything.
 *
 * Security note: the password is sent once over the POST body and never stored
 * in component state beyond the form's own lifetime. No password is ever put in
 * a URL, localStorage, or a query param.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";

import AuthField from "@/components/auth/AuthField";

// Mirrors the server-side policy in lib/credentials.ts. The server is the
// authority — this exists so the user gets instant feedback, not to replace it.
const PASSWORD_MIN_LENGTH = 12;

const RegisterSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    email: z.string().trim().email("Enter a valid email address."),
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `At least ${PASSWORD_MIN_LENGTH} characters.`)
      .regex(/[a-z]/, "Include a lowercase letter.")
      .regex(/[A-Z]/, "Include an uppercase letter.")
      .regex(/[0-9]/, "Include a number."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords do not match.",
    path: ["confirm"],
  });

type FormValues = z.infer<typeof RegisterSchema>;

/** The live checklist under the password field. */
const RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: `${PASSWORD_MIN_LENGTH}+ characters`, test: (p) => p.length >= PASSWORD_MIN_LENGTH },
  { label: "Lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "Uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "Number", test: (p) => /[0-9]/.test(p) },
];

export default function RegisterClient({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: { name: "", email: "", password: "", confirm: "" },
    mode: "onBlur",
  });

  const password = watch("password") ?? "";

  async function onSubmit(values: FormValues) {
    setFormError(null);
    setDevLink(null);

    let response: Response;
    try {
      response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: values.email,
          password: values.password,
          name: values.name || undefined,
        }),
      });
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
      return;
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      // Map server field errors back onto the form where we can.
      const fieldErrors = data?.fieldErrors as Record<string, string[]> | undefined;
      if (fieldErrors?.password?.length) {
        setError("password", { message: fieldErrors.password.join(" ") });
      }
      if (fieldErrors?.email?.length) {
        setError("email", { message: fieldErrors.email.join(" ") });
      }
      if (!fieldErrors) {
        setFormError(
          response.status === 429
            ? "Too many sign-up attempts. Please wait a few minutes."
            : (data?.error as string) ?? "Registration failed. Please try again."
        );
      }
      return;
    }

    // Dev-only: mail delivery is not configured, so the API hands back the
    // verification link for manual testing. Never present in production.
    if (typeof data?.devVerificationUrl === "string") {
      setDevLink(data.devVerificationUrl);
    }

    // Sign in immediately. redirect:false so we can show an inline error rather
    // than bouncing to the NextAuth error page.
    const result = await signIn("credentials", {
      email: values.email,
      password: values.password,
      redirect: false,
    });

    if (result?.error) {
      setFormError("Account created, but automatic sign-in failed. Please sign in manually.");
      return;
    }

    // Skip the redirect when showing a dev link, so it stays readable.
    if (!data?.devVerificationUrl) {
      router.push(callbackUrl);
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <AuthField
        label="Name"
        placeholder="Your name (optional)"
        autoComplete="name"
        error={errors.name?.message}
        {...register("name")}
      />

      <AuthField
        label="Email"
        type="email"
        placeholder="you@example.com"
        autoComplete="email"
        required
        error={errors.email?.message}
        {...register("email")}
      />

      <div>
        <AuthField
          label="Password"
          type="password"
          placeholder="••••••••••••"
          autoComplete="new-password"
          required
          error={errors.password?.message}
          {...register("password")}
        />
        {/* Live policy checklist — reassurance while typing, and it explains the
            rules up front instead of rejecting after submit. */}
        <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5" aria-label="Password requirements">
          {RULES.map((rule) => {
            const met = rule.test(password);
            return (
              <li
                key={rule.label}
                className={[
                  "flex items-center gap-1.5 text-[0.6875rem] transition-colors duration-300",
                  met ? "text-chimera-clay" : "text-muted-foreground/60",
                ].join(" ")}
              >
                <span
                  className={[
                    "w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0",
                    "transition-all duration-300 ease-spring",
                    met ? "bg-chimera-clay scale-100" : "bg-secondary scale-90",
                  ].join(" ")}
                >
                  {met && <Check className="w-2.5 h-2.5 text-chimera-cream" strokeWidth={3} />}
                </span>
                {rule.label}
              </li>
            );
          })}
        </ul>
      </div>

      <AuthField
        label="Confirm password"
        type="password"
        placeholder="••••••••••••"
        autoComplete="new-password"
        required
        error={errors.confirm?.message}
        {...register("confirm")}
      />

      {formError && (
        <div
          role="alert"
          className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive animate-scale-in"
        >
          {formError}
        </div>
      )}

      {devLink && (
        <div className="rounded-2xl border border-chimera-clay/30 bg-chimera-clay-muted/40 px-4 py-3 text-xs animate-scale-in">
          <div className="u-label text-chimera-clay mb-1.5">Dev — no mail provider</div>
          <p className="text-muted-foreground mb-2 leading-relaxed">
            Email delivery is not configured. Verify manually:
          </p>
          <Link href={devLink} className="text-chimera-clay underline break-all">
            {devLink}
          </Link>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-1 inline-flex items-center justify-center gap-2 w-full rounded-pill px-4 py-3 text-sm font-medium text-chimera-cream bg-chimera-clay shadow-clay-glow transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
        {isSubmitting ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
