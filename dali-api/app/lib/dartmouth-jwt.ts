// JWT exchanger for api.dartmouth.edu. The DartAPI login service swaps an
// API key for a short-lived JWT (~6h) which is then passed as
// `Authorization: Bearer <jwt>` on subsequent People-API calls.
//
// Distinct from the session-JWT machinery in `auth.ts` — that signs our own
// session tokens with `jose`. This module talks to Dartmouth's login service
// only and never inspects or signs anything itself.
//
// Cached in process memory; on cold start or after expiry we re-exchange.
// Multi-instance Fly deployments each maintain their own cache — that's fine,
// the cost of a redundant exchange is one extra HTTP call.

// No optional scope is requested. Everything we read from the People API
// (dartmouth_affiliation) is in the base no-scope payload; the optional
// scopes (private / read.sensitive / read.highlysensitive) gate FERPA and
// sensitive fields we never use, and each requires data-steward approval
// that would otherwise become a silent deployment dependency.
const JWT_URL = "https://api.dartmouth.edu/api/jwt";
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh when within 5 min of exp

type CachedJwt = {
  jwt: string;
  expiresAtMs: number;
};

let cached: CachedJwt | null = null;
let inflight: Promise<CachedJwt> | null = null;

function decodePayloadExpMs(jwt: string): number {
  // RFC 7519 §4.1.4: `exp` is seconds since epoch. We don't verify the
  // signature here — Dartmouth verifies it on subsequent calls. We only
  // need `exp` for cache-staleness.
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new Error("dartmouth-jwt: malformed JWT (expected 3 segments)");
  }
  const payload = JSON.parse(
    Buffer.from(parts[1], "base64url").toString("utf8"),
  );
  if (typeof payload.exp !== "number") {
    throw new Error("dartmouth-jwt: JWT payload missing numeric exp");
  }
  return payload.exp * 1000;
}

async function exchange(): Promise<CachedJwt> {
  const apiKey = process.env.DARTMOUTH_API_KEY;
  if (!apiKey) {
    throw new Error(
      "dartmouth-jwt: DARTMOUTH_API_KEY is not set; cannot exchange for JWT",
    );
  }

  const res = await fetch(JWT_URL, {
    method: "POST",
    // DartAPI docs: API key goes in `Authorization` header as the raw key
    // (no "Bearer " prefix). The returned JWT is what gets used with Bearer
    // on subsequent People calls.
    headers: { Authorization: apiKey },
  });

  if (!res.ok) {
    throw new Error(
      `dartmouth-jwt: exchange failed with HTTP ${res.status} ${res.statusText}`,
    );
  }

  const body = (await res.json()) as { jwt?: string };

  if (!body.jwt) {
    throw new Error("dartmouth-jwt: response missing jwt field");
  }

  return {
    jwt: body.jwt,
    expiresAtMs: decodePayloadExpMs(body.jwt),
  };
}

export async function getDartmouthJwt(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAtMs - REFRESH_BUFFER_MS > now) {
    return cached.jwt;
  }

  // Coalesce concurrent callers onto a single in-flight exchange.
  if (!inflight) {
    inflight = exchange().finally(() => {
      inflight = null;
    });
  }
  cached = await inflight;
  return cached.jwt;
}

// Test-only reset. Vitest re-imports modules between files but not between
// tests in the same file; this lets each test start from a clean cache.
export function __resetDartmouthJwtCacheForTests() {
  cached = null;
  inflight = null;
}
