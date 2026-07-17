// Calendar settings actions live here; GET navigations redirect to the unified
// settings page. Forms from /settings post back to this route.

import { redirect } from "react-router";
import { requireAuth, forbidden, unauthorized, redirectPartnerToPortal, isPartnerAccount } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { CalendarActionSchema } from "~/lib/calendar-schemas";
import type { Route } from "./+types/settings.calendar";

export const meta: Route.MetaFunction = () => [{ title: "Settings · DALI OS" }];

export async function loader() {
  return redirect("/settings#calendar");
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return unauthorized(request);
  if (auth.user.type === "applicant") return forbidden(request);
  if (await isPartnerAccount(auth)) return forbidden(request);

  const userId = auth.user.sub;
  const form = await request.formData();
  const raw = Object.fromEntries(form.entries());
  const intent = typeof raw.intent === "string" ? raw.intent : "";

  const candidate =
    intent === "toggle-sub-calendar"
      ? {
          intent,
          linkId: String(raw.linkId ?? ""),
          calendarId: String(raw.calendarId ?? ""),
          enabled: raw.enabled === "true",
        }
      : { intent, linkId: String(raw.linkId ?? "") };

  const parsed = CalendarActionSchema.safeParse(candidate);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;

  if (input.intent === "remove-calendar-link") {
    const link = await prisma.userCalendarLink.findUnique({ where: { id: input.linkId } });
    if (!link || link.userId !== userId) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    await prisma.userCalendarLink.delete({ where: { id: input.linkId } });
    return null;
  }

  if (input.intent === "toggle-sub-calendar") {
    const link = await prisma.userCalendarLink.findUnique({ where: { id: input.linkId } });
    if (!link || link.userId !== userId) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const current = new Set(link.subCalendarIds);
    if (input.enabled) current.add(input.calendarId);
    else current.delete(input.calendarId);
    await prisma.userCalendarLink.update({
      where: { id: input.linkId },
      data: { subCalendarIds: Array.from(current) },
    });
    return null;
  }

  return Response.json({ error: "Unsupported intent" }, { status: 400 });
}

export default function SettingsCalendarRedirect() {
  return null;
}
