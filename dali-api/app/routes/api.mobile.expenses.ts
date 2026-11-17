import type { Route } from "./+types/api.mobile.expenses";
import { z } from "zod";
import { parseJson } from "~/lib/validate";
import { mobileError, mobileJson } from "~/lib/mobile-auth.server";
import { createFromReceipts, getExpense, listExpenses } from "~/expenses/lib/expenses.server";
import { mobileExpenseError, requireMobileExpenses, toMobileDetail, toMobileSummary } from "~/expenses/lib/mobile.server";

const CreateSchema = z.object({
  receiptKeys: z.array(z.string().min(1).max(300)).min(1).max(12),
  paidWith: z.enum(["STAFF_CARD", "OWN_CARD"]).nullish(),
  cardId: z.string().min(1).max(100).nullish(),
});

export async function loader({ request }: Route.LoaderArgs) {
  const guard = await requireMobileExpenses(request);
  if (!guard.ok) return guard.response;
  try {
    const rows = await listExpenses(guard.viewer, "mine", { limit: 100 });
    return mobileJson({ expenses: rows.map(toMobileSummary) });
  } catch (e) {
    return mobileExpenseError(e);
  }
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return mobileError("Method not allowed", 405);
  const guard = await requireMobileExpenses(request);
  if (!guard.ok) return guard.response;
  const body = await parseJson(request, CreateSchema);
  if (body instanceof Response) return body;
  try {
    const created = await createFromReceipts(guard.viewer, body.receiptKeys, { paidWith: body.paidWith ?? null, cardId: body.cardId ?? null });
    return mobileJson(toMobileDetail(await getExpense(guard.viewer, created.id)), { status: 201 });
  } catch (e) {
    return mobileExpenseError(e);
  }
}
