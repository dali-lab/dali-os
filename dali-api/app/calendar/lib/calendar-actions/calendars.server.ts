import { setSubCalendarEnabled } from "~/calendar/lib/sub-calendar.server";
import { createCalendar, deleteCalendar, patchCalendar, subscribeCalendarForLink } from "~/calendar/lib/google-calendar.server";
import { assertLinkOwned } from "~/calendar/lib/calendar-actions/shared.server";

/** Create / rename / recolor / delete a linked Google calendar (P4). */
export async function handleCalendarAction(
  intent: string,
  raw: Record<string, FormDataEntryValue>,
  userId: string,
  request: Request,
): Promise<Response | null> {
  const get = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : "");
  const linkId = get("linkId");
  if (!linkId) return Response.json({ error: "Missing account" }, { status: 400 });
  try {
    await assertLinkOwned(userId, linkId);
    if (intent === "cal-create") {
      const summary = get("summary").trim();
      if (!summary) return Response.json({ error: "Name the calendar." }, { status: 400 });
      const calendarId = await createCalendar(linkId, summary);
      await subscribeCalendarForLink(linkId, calendarId).catch(() => {});
      // Enable it for display + writing.
      await setSubCalendarEnabled(linkId, calendarId, true);
      return null;
    }
    if (intent === "cal-rename") {
      const calendarId = get("calendarId");
      const summary = get("summary").trim();
      if (!calendarId || !summary) return Response.json({ error: "Missing calendar or name." }, { status: 400 });
      await patchCalendar({ linkId, calendarId, summary });
      return null;
    }
    if (intent === "cal-delete") {
      const calendarId = get("calendarId");
      if (!calendarId) return Response.json({ error: "Missing calendar." }, { status: 400 });
      await deleteCalendar(linkId, calendarId);
      return null;
    }
    return Response.json({ error: "Unknown calendar action" }, { status: 400 });
  } catch (err) {
    console.error("calendar action failed", err);
    const msg = err instanceof Error ? err.message : "Couldn't update the calendar.";
    return Response.json({ error: msg }, { status: 500 });
  }
}
