import type { Route } from "./+types/expenses.upload";
import { createReceiptUpload, ReceiptKeyError } from "../lib/receipts.server";
import { MAX_RECEIPT_FILES } from "../components/receipt-upload";
import { guardExpenses } from "./guard.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  const guard = await guardExpenses(request, { write: true, page: false });
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => null)) as { contentTypes?: unknown } | null;
  const types = body?.contentTypes;
  if (!Array.isArray(types) || types.length === 0 || types.some((t) => typeof t !== "string")) {
    return Response.json({ ok: false, error: "Add at least one receipt." }, { status: 400 });
  }
  if (types.length > MAX_RECEIPT_FILES) {
    return Response.json({ ok: false, error: `Use up to ${MAX_RECEIPT_FILES} receipts per expense.` }, { status: 400 });
  }
  try {
    const uploads = await Promise.all((types as string[]).map((t) => createReceiptUpload(guard.viewer.userId, t)));
    return Response.json({ ok: true, uploads });
  } catch (e) {
    if (e instanceof ReceiptKeyError) return Response.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
