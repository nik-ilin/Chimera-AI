"use client";
/**
 * Getting-started checklist rail.
 *
 * - Reads per-step completion from localStorage (keys set by each module page).
 * - Auto-refreshes when the user navigates back to the portal.
 * - Dismiss button: shows an inline confirmation ("Sure? → Yes / Cancel")
 *   before removing the widget; dismissed state persists in localStorage so
 *   the rail stays gone across reloads.
 * - Disappears automatically once every step is done (no dismiss needed then).
 */
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowUpRight, X, Check } from "lucide-react";

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS = [
  {
    n: "01",
    label: "Set your creator profile",
    /** Always done: if the user is on the portal they completed onboarding. */
    storageKey: null as null | string,
    href: null as null | string,
  },
  {
    n: "02",
    label: "Write your first captions",
    storageKey: "chimera:visited:posts",
    href: "/portal/musician/posts",
  },
  {
    n: "03",
    label: "Draft a verse with the ghostwriter",
    storageKey: "chimera:visited:ghostwrite",
    href: "/portal/musician/ghostwrite",
  },
  {
    n: "04",
    label: "Open the Personal Manager",
    storageKey: "chimera:visited:manager",
    href: "/portal/musician/manager",
  },
] as const;

const DISMISS_KEY = "chimera:getting-started:dismissed";

// ─── Component ────────────────────────────────────────────────────────────────

export default function GettingStartedRail() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [dismissed, setDismissed] = useState(false);
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);
  // mounted guards against SSR hydration mismatch — localStorage is browser-only.
  const [mounted, setMounted] = useState(false);

  const readState = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const step of STEPS) {
      if (step.storageKey === null) {
        // Profile step: always done once they're on the portal.
        next[step.n] = true;
      } else {
        next[step.n] = localStorage.getItem(step.storageKey) === "1";
      }
    }
    return next;
  }, []);

  useEffect(() => {
    setMounted(true);
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    setDone(readState());
  }, [readState]);

  // Re-read whenever the tab regains focus (user came back from a module page).
  useEffect(() => {
    function onFocus() {
      setDone(readState());
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [readState]);

  // Don't render during SSR or after dismiss.
  if (!mounted || dismissed) return null;

  const allDone = STEPS.every((s) => done[s.n]);

  // Once every step is complete the rail has served its purpose — fade it out
  // silently rather than making the user dismiss it manually.
  if (allDone) return null;

  const completedCount = STEPS.filter((s) => done[s.n]).length;

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
    setConfirmingDismiss(false);
  }

  return (
    <div className="widget p-6 animate-fade-up" style={{ animationDelay: "120ms" }}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="u-label text-muted-foreground">Getting started</span>
          <span className="font-mono text-[10px] text-muted-foreground/60 bg-secondary rounded-pill px-1.5 py-0.5">
            {completedCount}/{STEPS.length}
          </span>
        </div>

        {/* Dismiss control */}
        {confirmingDismiss ? (
          <div className="flex items-center gap-2 animate-scale-in">
            <span className="text-xs text-muted-foreground">Hide this?</span>
            <button
              type="button"
              onClick={handleDismiss}
              className="text-xs font-medium text-chimera-clay hover:underline"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDismiss(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDismiss(true)}
            aria-label="Dismiss getting-started list"
            className="w-6 h-6 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1 rounded-full bg-secondary mb-4 overflow-hidden">
        <div
          className="h-full rounded-full bg-chimera-clay transition-all duration-700 ease-smooth"
          style={{ width: `${(completedCount / STEPS.length) * 100}%` }}
        />
      </div>

      {/* Steps */}
      <ol className="flex flex-col gap-1">
        {STEPS.map((step) => {
          const isDone = Boolean(done[step.n]);
          const inner = (
            <div className="flex items-center gap-3 rounded-2xl px-3 py-2.5 -mx-3 transition-colors hover:bg-secondary/60 group">
              {/* Step indicator */}
              <span
                className={[
                  "font-mono text-xs w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-300",
                  isDone
                    ? "bg-chimera-clay text-chimera-cream"
                    : "bg-secondary text-muted-foreground",
                ].join(" ")}
              >
                {isDone ? <Check className="w-3.5 h-3.5" /> : step.n}
              </span>

              {/* Label */}
              <span
                className={[
                  "text-sm flex-1 transition-colors duration-300",
                  isDone ? "text-muted-foreground line-through" : "text-foreground",
                ].join(" ")}
              >
                {step.label}
              </span>

              {/* Arrow — only on pending steps with a link */}
              {!isDone && step.href && (
                <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-chimera-clay transition-colors" />
              )}
            </div>
          );

          // Pending steps with a href are links; done steps and no-href steps are divs.
          return !isDone && step.href ? (
            <li key={step.n}>
              <Link href={step.href}>{inner}</Link>
            </li>
          ) : (
            <li key={step.n}>{inner}</li>
          );
        })}
      </ol>
    </div>
  );
}
