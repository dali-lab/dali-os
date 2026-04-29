import type { ZodType } from "zod";
import { safeJson } from "~/lib/safe-json";

/**
 * Read and validate a JSON request body against a Zod schema.
 * Returns the parsed/validated data on success, or a Response on failure
 * (413 if body too large, 400 if JSON is malformed or fails the schema).
 *
 * Designed to drop in next to the existing `safeJson` pattern:
 *   const body = await parseJson(request, MySchema);
 *   if (body instanceof Response) return body;
 */
export async function parseJson<T>(
  request: Request,
  schema: ZodType<T>,
  maxBytes?: number,
): Promise<T | Response> {
  const raw = await safeJson<unknown>(request, maxBytes);
  if (raw instanceof Response) return raw;

  const result = schema.safeParse(raw);
  if (!result.success) {
    return Response.json(
      { error: "Invalid request body", details: result.error.flatten() },
      { status: 400 },
    );
  }
  return result.data;
}
