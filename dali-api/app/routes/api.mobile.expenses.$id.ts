import type { Route } from "./+types/api.mobile.expenses.$id";
import { z } from "zod";
import { parseJson } from "~/lib/validate";
import { mobileError, mobileJson } from "~/lib/mobile-auth.server";
import {
  deleteDraft,
  getExpense,
  markPaid,
  submitExpense,
  updateExpense,
  withdrawExpense,
  type UpdateExpenseInput,
} from "~/expenses/lib/expenses.server";
import { parseMoneyToCents } from "~/expenses/lib/money";
import { mobileExpenseError, requireMobileExpenses, toMobileDetail } from "~/expenses/lib/mobile.server";

const PatchSchema = z.object({
  merchant: z.string().max(200).nullable().optional(),
  purpose: z.string().max(2000).nullable().optional(),
  categoryId: z.string().min(1).max(100).nullable().optional(),
  total: z.string().max(32).nullable().optional(),
  purchasedAt: z.string().max(40).nullable().optional(),
  paidWith: z.enum(["STAFF_CARD", "OWN_CARD"]).nullable().optional(),
  cardId: z.string().min(1).max(100).nullable().optional(),
  attendeeIds: z.array(z.string().min(1).max(100)).max(100).optional(),
});

const ActionSchema = z.object({ action: z.enum(["submit", "withdraw", "markPaid"]) });

function patchToInput(body: z.infer<typeof PatchSchema>): UpdateExpenseInput | string {
  const { total, purchasedAt, ...rest } = body;
  const input: UpdateExpenseInput = { ...rest };
  if (total !== undefined) {
    const cents = total === null ? null : parseMoneyToCents(total);
    if (total !== null && cents === null) return "The amount isn't valid.";
    input.totalCents = cents;
  }
  if (purchasedAt !== undefined) {
    if (purchasedAt === null) {
      input.purchasedAt = null;
    } else {
      const d = new Date(purchasedAt);
      if (Number.isNaN(d.getTime())) return "That date isn't valid.";
      input.purchasedAt = d;
    }
  }
  return input;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const guard = await requireMobileExpenses(request);
  if (!guard.ok) return guard.response;
  try {
    return mobileJson(toMobileDetail(await getExpense(guard.viewer, params.id)));
  } catch (e) {
    return mobileExpenseError(e);
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const method = request.method;
  if (method !== "PATCH" && method !== "POST" && method !== "DELETE") return mobileError("Method not allowed", 405);
  const guard = await requireMobileExpenses(request);
  if (!guard.ok) return guard.response;
  const { viewer } = guard;

  try {
    if (method === "DELETE") {
      await deleteDraft(viewer, params.id);
      return mobileJson({ ok: true });
    }

    if (method === "PATCH") {
      const body = await parseJson(request, PatchSchema);
      if (body instanceof Response) return body;
      const input = patchToInput(body);
      if (typeof input === "string") return mobileError(input, 400);
      await updateExpense(viewer, params.id, input);
    } else {
      const body = await parseJson(request, ActionSchema);
      if (body instanceof Response) return body;
      if (body.action === "submit") await submitExpense(viewer, params.id);
      else if (body.action === "withdraw") await withdrawExpense(viewer, params.id);
      else await markPaid(viewer, params.id);
    }
    return mobileJson(toMobileDetail(await getExpense(viewer, params.id)));
  } catch (e) {
    return mobileExpenseError(e);
  }
}
