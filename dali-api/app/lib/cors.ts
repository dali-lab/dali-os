import { securityHeaders } from "~/lib/security-headers";

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  // The JobX → DALI timesheet-export extension fetches DALI from the JobX origin;
  // allow it so the cross-origin response is readable by the content script.
  "https://dartmouth.studentemployment.ngwebsolutions.com",
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  if (!ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

export function withCors(request: Request, response: Response): Response {
  for (const [k, v] of Object.entries(corsHeaders(request))) {
    response.headers.set(k, v);
  }
  for (const [k, v] of Object.entries(securityHeaders())) {
    response.headers.set(k, v);
  }
  return response;
}

export function handlePreflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export function preflightLoader({ request }: { request: Request }) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  return withCors(request, new Response("Method not allowed", { status: 405 }));
}
