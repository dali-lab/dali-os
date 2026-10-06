// Client-side helper for posting one of core.partners.applications.$id.tsx's
// action intents from OUTSIDE that route — the application modal is mounted
// on the board route (and, in create mode, nowhere at all yet), so it can't
// rely on a <Form>/useFetcher submit to "the current route's action": that
// action always ends in `redirect(...)` on success, and a fetcher honoring a
// cross-route redirect would navigate the whole app there, closing the modal
// out from under the board. A plain fetch() has no such side effect — the
// browser follows the redirect transparently and this just reads the result.

/**
 * POST one `intent` to the application detail route's action. Distinguishes
 * success (the action's final `redirect()`, resolved by fetch into the
 * redirected GET's 200 html response) from a validation failure (the action
 * returns `{ error }` directly, with no redirect, so the JSON content-type
 * survives) without needing the action to change its shape for this caller.
 */
export async function postPartnerApplicationIntent(
  applicationId: string,
  intent: string,
  fields: Record<string, string | string[] | null | undefined> = {},
): Promise<{ ok: boolean; error?: string }> {
  const fd = new FormData();
  fd.set("intent", intent);
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => fd.append(key, v));
    else fd.set(key, value);
  }
  let res: Response;
  try {
    res = await fetch(`/core/partners/applications/${applicationId}`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });
  } catch {
    return { ok: false, error: "Network error — couldn't reach the server." };
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error) return { ok: false, error: body.error };
  }
  if (!res.ok) return { ok: false, error: `Request failed: ${res.status}` };
  return { ok: true };
}
