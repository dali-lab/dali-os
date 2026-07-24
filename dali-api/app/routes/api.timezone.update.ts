import type { Route } from "./+types/api.timezone.update";
import { prisma } from "~/lib/db";
import { requireAuth, unauthorized } from "~/lib/auth";
import { isValidTimezone } from "~/lib/timezone";
import { syncAvailabilityTimezone } from "~/lib/timezone-preference.server";
import { dismissedTimeZoneCookie } from "~/lib/tz-prompt";

// Backs the client-side timezone-change prompt (components/TimeZonePrompt).
//   intent=update  → persist the detected/chosen zone to User.timeZone and sync
//                    the calendar zone. Used both for the silent first-visit
//                    auto-detect and the explicit "Update" button.
//   intent=dismiss → record (via cookie) that the user chose to keep their
//                    current zone, so we stop prompting for this detected zone.
// Both revalidate the layout loader (/api/timezone is whitelisted there), which
// re-threads userTimeZone to every formatter.
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return unauthorized(request);
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "update");
  const timeZone = String(form.get("timeZone") ?? "").trim();

  if (!isValidTimezone(timeZone)) {
    return Response.json({ error: "Unrecognized timezone." }, { status: 400 });
  }

  if (intent === "dismiss") {
    return Response.json(
      { ok: true },
      { headers: { "Set-Cookie": dismissedTimeZoneCookie(timeZone) } },
    );
  }

  await prisma.user.update({
    where: { id: auth.user.sub },
    data: { timeZone },
  });
  await syncAvailabilityTimezone(auth.user.sub, timeZone);
  return Response.json({ ok: true });
}
