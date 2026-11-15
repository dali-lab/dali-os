import { withCors } from "~/lib/cors";
import { isHttpError } from "~/lib/http-error";

export function errorResponse(err: unknown, request?: Request): Response {
  if (!isHttpError(err)) throw err;
  const res = Response.json({ error: err.message }, { status: err.status });
  return request ? withCors(request, res) : res;
}

export function errorResult(err: unknown): { error: string } {
  if (!isHttpError(err)) throw err;
  return { error: err.message };
}
