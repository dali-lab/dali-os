import { redirect } from "react-router";
import { redirectToLogin } from "~/lib/login-next";
import { impersonationAllowsWrites, isImpersonating, isNonMember, requireAuth } from "~/lib/auth";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";
import { ExpenseError } from "../lib/errors";
import { loadExpenseViewer } from "../lib/viewer.server";
import type { ExpenseViewer } from "../lib/access";

export type Guarded = { ok: true; viewer: ExpenseViewer } | { ok: false; response: Response };

export function failure(e: unknown): Response {
  if (e instanceof ExpenseError) return Response.json({ ok: false, error: e.message }, { status: e.status });
  throw e;
}

export async function guardExpenses(
  request: Request,
  opts: { write: boolean; page: boolean },
): Promise<Guarded> {
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return { ok: false, response: opts.page ? redirectToLogin(request) : Response.json({ ok: false, error: "Sign in again to continue." }, { status: 401 }) };
  }
  if (await isNonMember(auth, request)) {
    return { ok: false, response: opts.page ? redirect("/portal") : Response.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
  }
  const roles = await getUserRoles(auth.user.sub, request);
  if (roles.isAlumni || !(await isFeatureEnabled("expenses", auth.user.sub, roles, request))) {
    return { ok: false, response: new Response("Not found", { status: 404 }) };
  }
  if (opts.write && isImpersonating(auth) && !impersonationAllowsWrites()) {
    return { ok: false, response: Response.json({ ok: false, error: "Expenses can't be changed while viewing as someone else." }, { status: 403 }) };
  }
  return { ok: true, viewer: await loadExpenseViewer(auth.user.sub, request) };
}
