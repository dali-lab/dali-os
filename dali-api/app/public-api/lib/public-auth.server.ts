import { timingSafeEqual } from "node:crypto";

// Machine auth for the `api/public/*` surface, which dali.website's Express
// server calls server-side. Mirrors the shared-secret half of
// internal.jobs.tick.ts, with two differences that matter here:
//
//   - It fails CLOSED when SHOWCASE_API_SECRET is unset. The jobs tick can
//     fall back to an Admin session; this endpoint has no second auth path, so
//     an unset secret must mean "refuse", never "allow". A deploy that forgets
//     the secret should 503, not quietly serve the showcase to the internet.
//   - The compare is constant-time. The secret is long-lived and shared with
//     another service, so it's worth not leaking its prefix through timing.

export function isPublicApiConfigured(): boolean {
  return Boolean(process.env.SHOWCASE_API_SECRET);
}

function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  // Comparing a fixed-length digest would avoid that, but the lengths here are
  // both operator-chosen constants, so a plain length guard is enough.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Returns null when the caller is authorized, or the Response to return.
export function requireShowcaseSecret(request: Request): Response | null {
  const secret = process.env.SHOWCASE_API_SECRET;
  if (!secret) {
    return Response.json(
      { error: "Public API is not configured" },
      { status: 503 },
    );
  }
  const header = request.headers.get("x-showcase-secret");
  if (!header || !secretsMatch(header, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
