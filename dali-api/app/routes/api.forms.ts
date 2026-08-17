import type { Route } from "./+types/api.forms";
import { requireAuth, forbidden } from "~/lib/auth";
import { canViewForms } from "~/lib/roles";
import { runFormsAction } from "~/forms/lib/forms-data";

// Action-only resource route for form mutations. The old `/forms` browser hub
// (which used to host this action) is gone; the Drive hub's New ▸ form flow and
// the form editor POST here instead. No loader/UI — GET is not handled.
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await canViewForms(auth.user.sub))) return forbidden(request);

  const result = await runFormsAction(await request.formData(), auth.user.sub);
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result);
}
