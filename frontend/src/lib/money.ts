/**
 * Money formatting — safe on both the server and the client.
 *
 * Deliberately its own module, NOT part of lib/manager-data.ts. That file is
 * marked "server-only" because it holds database access, so a Client Component
 * importing a formatter from it would drag the whole data layer into the
 * browser bundle — the build fails loudly rather than shipping it, which is
 * exactly what caught this.
 *
 * Everything here is pure and dependency-free.
 */

/**
 * Render minor units (cents) as a currency amount.
 *
 * Amounts are stored as signed integers in minor units throughout the Manager
 * module — floats must never decide an artist's settlement, and 0.1 + 0.2 is a
 * genuinely bad reason to lose money.
 *
 * Fractional units are dropped: touring figures are whole-euro amounts, and
 * "€900" reads faster than "€900.00" in a dense table.
 */
export function formatMoney(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** Euros (as typed in a form) → minor units for the wire. */
export function toCents(amount: string | number): number {
  const value = typeof amount === "string" ? Number(amount) : amount;
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}
