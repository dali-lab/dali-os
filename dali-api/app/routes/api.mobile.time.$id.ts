import type { Route } from "./+types/api.mobile.time.$id";
import { parseJson } from "~/lib/validate";
import { UpdateTimeEntrySchema } from "~/lib/calendar-schemas";
import { deleteTimeEntry, updateTimeEntry } from "~/lib/time-entries.server";
import { mobileError, mobileJson, requireMobileUser } from "~/lib/mobile-auth.server";

const UpdateBodySchema = UpdateTimeEntrySchema.omit({ intent: true, id: true });

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "PATCH" && request.method !== "DELETE") return mobileError("Method not allowed", 405);
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;

  if (request.method === "DELETE") {
    const result = await deleteTimeEntry(guard.userId, params.id);
    if (!result.ok) return mobileError(result.error, result.status);
    return mobileJson({ ok: true });
  }

  const body = await parseJson(request, UpdateBodySchema);
  if (body instanceof Response) return body;
  const result = await updateTimeEntry(guard.userId, { ...body, id: params.id });
  if (!result.ok) return mobileError(result.error, result.status);
  return mobileJson({ ok: true });
}
