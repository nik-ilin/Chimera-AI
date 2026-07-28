/**
 * In-process fixed-window rate limiter for auth endpoints.
 *
 * Scope and honest limits: this counter lives in the Node process's memory. It
 * is per-instance, so N app instances allow N × the limit, and it resets on
 * deploy. That is a real weakening under horizontal scaling — but it is also
 * the only option that adds no infrastructure, and it still defeats the attack
 * that actually matters here: a single host running a credential-stuffing or
 * account-enumeration loop. If Chimera scales past one instance, swap the Map
 * for Upstash Redis / @vercel/kv behind this same `check()` signature; no call
 * site needs to change.
 *
 * FastAPI has its own slowapi limiter (backend/limiter.py) — this one exists
 * because /api/auth/* never reaches FastAPI.
 */

interface Window {
  count: number;
  /** Epoch ms at which this window expires and the count resets. */
  resetAt: number;
}

const buckets = new Map<string, Window>();

/**
 * Drop expired windows. Called opportunistically on each check so the Map can't
 * grow without bound from one-off IPs (a slow memory leak under scanning
 * traffic). Cheap because expired entries are the common case.
 */
function sweep(now: number): void {
  if (buckets.size < 5000) return;
  // Array.from rather than `for…of` over the Map: tsconfig sets no `target`, so
  // tsc defaults to ES5 and rejects direct Map iteration without
  // --downlevelIteration. Materialising the keys first is ES5-safe and, since
  // this only runs past 5000 entries, the extra array is irrelevant.
  const keys = Array.from(buckets.keys());
  for (const key of keys) {
    const window = buckets.get(key);
    if (window && window.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Attempts left in the current window. */
  remaining: number;
  /** Seconds until the window resets — sent as Retry-After on a 429. */
  retryAfter: number;
}

/**
 * Consume one unit from `key`'s budget.
 *
 * @param key    Identity of the caller, e.g. "register:1.2.3.4".
 * @param limit  Max attempts per window.
 * @param windowMs Window length in milliseconds.
 */
export function check(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }

  existing.count += 1;
  const retryAfter = Math.ceil((existing.resetAt - now) / 1000);

  if (existing.count > limit) {
    return { ok: false, remaining: 0, retryAfter };
  }
  return { ok: true, remaining: limit - existing.count, retryAfter };
}

/**
 * Clear a key's window. Called after a SUCCESSFUL sign-in so that a legitimate
 * user who fumbled their password a few times isn't left throttled.
 */
export function reset(key: string): void {
  buckets.delete(key);
}

/**
 * Best-effort client IP.
 *
 * x-forwarded-for is client-controlled unless a trusted proxy overwrites it.
 * Render and Vercel both do overwrite it, which is why we take the FIRST entry
 * (the origin client) rather than the last. On an untrusted deployment an
 * attacker can rotate this header to sidestep the limit — accepted, because the
 * alternative (limiting by a single shared key) would let one attacker lock out
 * every user. Per-account limits below are the backstop for that case.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

// ─── Policies ─────────────────────────────────────────────────────────────────
// Tuned so a human never hits them and a script hits them almost immediately.

/** Registration: 5 new accounts per IP per hour. */
export const REGISTER_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 };

/** Sign-in per IP: 10 attempts / 15 min. Blocks stuffing from one host. */
export const LOGIN_IP_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };

/**
 * Sign-in per account: 5 attempts / 15 min. Blocks a distributed guessing run
 * against ONE account, which the per-IP limit alone would miss.
 */
export const LOGIN_ACCOUNT_LIMIT = { limit: 5, windowMs: 15 * 60 * 1000 };

/** Verification email resend: 3 per hour per address. */
export const VERIFY_RESEND_LIMIT = { limit: 3, windowMs: 60 * 60 * 1000 };
