import type { Route } from "./+types/api.forms";
import { requireAuth, forbidden } from "~/lib/auth";
import { runFormsAction } from "~/forms/lib/forms-data";
import { canBuildForm, canCreateForm } from "~/forms/lib/form-access.server";

// Action-only resource route for form mutations. The old `/forms` browser hub
// (which used to host this action) is gone; the Drive hub's New ▸ form flow and
// the form editor POST here instead. No loader/UI — GET is not handled.
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const formData = await request.formData();

  if (formData.get("intent") === "create-form") {
    const folder = (formData.get("folderPageId") as string | null) || null;
    if (!(await canCreateForm(auth.user.sub, folder, request))) return forbidden(request);
  } else {
    // All `id` values, not get(): the gate must cover the id the action will
    // use (fromEntries keeps the LAST value; get() returns the first).
    const ids = formData.getAll("id");
    const id = ids[0];
    if (
      ids.length !== 1 ||
      typeof id !== "string" ||
      !id ||
      !(await canBuildForm(auth.user.sub, id, request))
    )
      return forbidden(request);
  }

  const result = await runFormsAction(formData, auth.user.sub);
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result);
}
