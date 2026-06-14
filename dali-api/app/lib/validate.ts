import { z, type ZodType } from "zod";
import { safeJson } from "~/lib/safe-json";

export const idSchema = z.string().min(1).max(100);

export const nullableTrimmed = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v),
  z.string().nullable(),
);

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

export async function parseForm<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T> | Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (
    !contentType.includes("application/x-www-form-urlencoded") &&
    !contentType.includes("multipart/form-data")
  ) {
    return Response.json(
      { error: "Invalid form data", details: "Unsupported content type" },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "Invalid form data", details: "Malformed form body" },
      { status: 400 },
    );
  }

  const result = schema.safeParse(Object.fromEntries(form));
  if (!result.success) {
    return Response.json(
      { error: "Invalid form data", details: result.error.flatten() },
      { status: 400 },
    );
  }
  return result.data;
}
