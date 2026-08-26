import { getAppEnv } from "./app-env";

const isDeployed = getAppEnv() !== "dev";

type Directives = Record<string, string[] | true>;

/**
 * Derive the WebSocket origin to add to `connect-src` from `COLLAB_URL`.
 * In prod we want to narrow to the configured origin; in dev we let the
 * caller fall back to permissive `ws:` so localhost ports just work.
 */
function collabConnectSource(): string | null {
  const raw = process.env.COLLAB_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * S3 bucket origin for `connect-src` — the browser uploads directly to S3 via
 * presigned POST, and (for the desktop shell) the updater feed lives there.
 * Derived from the same env the runtime uses (app/lib/s3.ts), so it tracks the
 * per-environment bucket without hardcoding.
 */
function s3ConnectSource(): string | null {
  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION;
  if (!bucket || !region) return null;
  return `https://${bucket}.s3.${region}.amazonaws.com`;
}

function cspDirectives(): Directives {
  // 'unsafe-inline' on style-src is required for Google Fonts' returned CSS
  // and React's inline `style={...}` attributes. Removing it would mean
  // self-hosting Inter and auditing every component.
  const styleSrc = ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"];

  const collabOrigin = collabConnectSource();
  const s3Origin = s3ConnectSource();
  const connectSrc = isDeployed
    ? [
        "'self'",
        ...(collabOrigin ? [collabOrigin] : []),
        ...(s3Origin ? [s3Origin] : []),
        // Google sign-in / APIs (additive; the desktop pairing login runs in
        // the system browser, so this is a forward-compat allowance).
        "https://accounts.google.com",
      ]
    : ["'self'", "ws:", "wss:"];

  const directives: Directives = {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    "style-src": styleSrc,
    "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "connect-src": connectSrc,
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'self'"],
  };

  if (isDeployed) {
    directives["upgrade-insecure-requests"] = true;
  }

  return directives;
}

export function contentSecurityPolicy(): string {
  return Object.entries(cspDirectives())
    .map(([name, value]) => (value === true ? name : `${name} ${value.join(" ")}`))
    .join("; ");
}

/**
 * Report-Only by default in all environments so that a missed source doesn't
 * break the page silently. Set `CSP_ENFORCE=1` in production to flip to
 * enforcing mode.
 *
 * Dev/test use Report-Only because React Router injects inline bootstrap
 * scripts that are blocked by `script-src 'self'` without nonce support,
 * which would prevent client hydration and break interactive behaviour.
 */
function cspHeaderName(): string {
  if (isDeployed && process.env.CSP_ENFORCE === "1") {
    return "Content-Security-Policy";
  }
  return "Content-Security-Policy-Report-Only";
}

export function securityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-DNS-Prefetch-Control": "off",
    // camera=(self): the wallet-pass scan station (/calendar/scan/:id) uses
    // getUserMedia to read pass QRs. Scoped to same-origin documents — a
    // cross-origin embed still can't reach the camera. microphone/geolocation
    // stay fully disabled (unused).
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
    [cspHeaderName()]: contentSecurityPolicy(),
  };

  if (isDeployed) {
    headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains";
  }

  return headers;
}

export function withSecurityHeaders(response: Response): Response {
  for (const [k, v] of Object.entries(securityHeaders())) {
    response.headers.set(k, v);
  }
  return response;
}
