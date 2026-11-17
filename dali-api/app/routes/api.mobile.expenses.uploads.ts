import type { Route } from "./+types/api.mobile.expenses.uploads";
import { z } from "zod";
import { parseJson } from "~/lib/validate";
import { mobileError, mobileJson } from "~/lib/mobile-auth.server";
import { requireMobileExpenses } from "~/expenses/lib/mobile.server";
import { createReceiptUpload, RECEIPT_CONTENT_TYPES } from "~/expenses/lib/receipts.server";
import { MAX_RECEIPTS_PER_EXPENSE } from "~/expenses/lib/expenses.server";

const BodySchema = z.object({
  files: z
    .array(z.object({ contentType: z.enum(RECEIPT_CONTENT_TYPES), fileName: z.string().max(255).optional() }))
    .min(1)
    .max(Math.min(10, MAX_RECEIPTS_PER_EXPENSE)),
});

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return mobileError("Method not allowed", 405);
  const guard = await requireMobileExpenses(request);
  if (!guard.ok) return guard.response;
  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return body;
  const uploads = await Promise.all(body.files.map((f) => createReceiptUpload(guard.userId, f.contentType)));
  return mobileJson({ uploads: uploads.map((u) => ({ key: u.key, url: u.post.url, fields: u.post.fields })) });
}
