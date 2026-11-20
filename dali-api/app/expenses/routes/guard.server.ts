import { impersonationAllowsWrites, isImpersonating } from "~/lib/auth";
import { guardMemberFeature } from "~/lib/feature-guard.server";
import { ExpenseError } from "../lib/errors";
import { loadExpenseViewer } from "../lib/viewer.server";
import { expenseAccessDenial, type ExpenseViewer } from "../lib/access";

export type Guarded = { ok: true; viewer: ExpenseViewer } | { ok: false; response: Response };

export function failure(e: unknown): Response {
  if (e instanceof ExpenseError) return Response.json({ ok: false, error: e.message }, { status: e.status });
  throw e;
}

export async function guardExpenses(
  request: Request,
  opts: { write: boolean; page: boolean },
): Promise<Guarded> {
  const guard = await guardMemberFeature(request, {
    flag: "expenses",
    page: opts.page,
    json: (error) => ({ ok: false, error }),
    unauthorizedMessage: "Sign in again to continue.",
    blockedMessage: "Expenses can't be changed while viewing as someone else.",
    denial: ({ auth, roles, isMember }) => {
      const denial = expenseAccessDenial({
        isLabMemberOrAlum: isMember,
        isAlumni: roles.isAlumni,
        readOnlyImpersonation: opts.write && isImpersonating(auth) && !impersonationAllowsWrites(),
      });
      return denial === "impersonated_write" ? "blocked" : denial;
    },
  });
  if (!guard.ok) return guard;
  return { ok: true, viewer: await loadExpenseViewer(guard.userId, request) };
}
