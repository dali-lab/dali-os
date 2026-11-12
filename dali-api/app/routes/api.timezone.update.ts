import type { Route } from "./+types/api.timezone.update";
import { prisma } from "~/lib/db.server";
import { requireAuth, unauthorized } from "~/lib/auth";
import { z } from "zod";
import { isValidTimezone } from "~/lib/timezone";
import { readForm } from "~/lib/validate";
import { dismissedTimeZoneCookie } from "~/lib/tz-prompt";

const FormSchema = z.object({
  intent: z.string().default("update"),
  timeZone: z
    .string({ error: "Unrecognized timezone." })
    .trim()
    .refine(isValidTimezone, "Unrecognized timezone."),
});

// Backs the client-side timezone-change prompt (components/TimeZonePrompt).
//   intent=update  → persist the detected/chosen zone to User.timeZone (the
//                    single display zone, shared by the calendar). Used both for
//                    the silent first-visit auto-detect and the "Update" button.
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
  const parsed = readForm(form, FormSchema);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { intent, timeZone } = parsed.data;

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
  return Response.json({ ok: true });
}
