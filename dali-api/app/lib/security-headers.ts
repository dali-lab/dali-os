const isProduction = process.env.NODE_ENV === "production";

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

function cspDirectives(): Directives {
  // 'unsafe-inline' on style-src is required for Google Fonts' returned CSS
  // and React's inline `style={...}` attributes. Removing it would mean
  // self-hosting Inter and auditing every component.
  const styleSrc = ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"];

  const collabOrigin = collabConnectSource();
  const connectSrc = isProduction
    ? ["'self'", ...(collabOrigin ? [collabOrigin] : [])]
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

  if (isProduction) {
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
  if (isProduction && process.env.CSP_ENFORCE === "1") {
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
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    [cspHeaderName()]: contentSecurityPolicy(),
  };

  if (isProduction) {
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
