const isProduction = process.env.NODE_ENV === "production";

export function securityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-DNS-Prefetch-Control": "off",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
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
