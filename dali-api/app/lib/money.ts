// Generic money/number helpers shared across the payroll-reconcile feature.
// Prisma Decimal values must be converted to numbers before they cross the
// React Router single-fetch boundary (Decimal isn't serializable); these are
// the conversion + formatting primitives that boundary code relies on.

/** A Prisma Decimal-ish value: anything with a `.toString()` that yields a numeric string. */
export type DecimalLike = { toString(): string };

/**
 * Coerce a Prisma Decimal (or null/number/string) to a plain number. Null and
 * unparseable values collapse to 0 — callers that need to distinguish "absent"
 * from "zero" should check for null before calling.
 */
export function decimalToNumber(value: DecimalLike | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(n) ? n : 0;
}

/** Round to whole cents, avoiding binary-float drift on sums (e.g. 0.1 + 0.2). */
export function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Format a number as USD, e.g. 1234.5 → "$1,234.50". */
export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}
