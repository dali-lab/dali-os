// Pure partner-org helpers (client- and server-safe).

// Normalize a user-entered website into a safe absolute URL, or null. Bare
// domains ("acme.com") get an https:// scheme so the stored value renders as a
// real link rather than a relative path; blanks become null; already-schemed
// values pass through untouched.
export function normalizeWebsite(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}
