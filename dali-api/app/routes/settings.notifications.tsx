// Settings → Notifications moved inline: the matrix renders as a section of
// /settings (NotificationsSettingsBlock). This route keeps the save action —
// the block's fetcher POSTs here — and redirects GETs (old links, the
// notification-email footer) to the section.

import { redirect } from "react-router";
import {
  requireAuth,
  unauthorized,
  forbidden,
  isPartnerAccount,
} from "~/lib/auth";
import { prisma } from "~/lib/db";
import {
  EVENT_TYPES,
  isEventType,
  type EventDef,
  type EventType,
} from "~/lib/notification-events";
import {
  VISIBLE_EVENTS,
  DIGEST_VALUES,
  type DigestValue,
} from "~/components/settings/NotificationsSettingsBlock";
import type { Route } from "./+types/settings.notifications";

export async function loader() {
  return redirect("/settings#notifications");
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return unauthorized(request);
  if (auth.user.type === "applicant") return forbidden(request);
  if (await isPartnerAccount(auth)) return forbidden(request);

  const form = await request.formData();
  const rows: {
    eventType: EventType;
    inApp: boolean;
    desktop: boolean;
    slackDm: boolean;
    digestFrequency: DigestValue;
  }[] = [];

  for (const eventType of VISIBLE_EVENTS) {
    if (!isEventType(eventType)) continue;
    const def: EventDef = EVENT_TYPES[eventType];
    // Checkboxes submit only when checked; the hidden `${type}:present`
    // field distinguishes "unchecked" from "row not on the form".
    if (form.get(`${eventType}:present`) !== "1") continue;

    const email = String(form.get(`${eventType}:email`) ?? "");
    const digestFrequency = (DIGEST_VALUES as readonly string[]).includes(email)
      ? (email as DigestValue)
      : def.defaults.email;
    // Digests summarize unread in-app rows, so a digest choice keeps in-app
    // on (mirrors the same rule in notify()'s dispatch).
    const digestSelected = digestFrequency === "Daily" || digestFrequency === "Weekly";
    rows.push({
      eventType,
      inApp:
        def.lockedInApp || digestSelected ? true : form.get(`${eventType}:inApp`) === "on",
      desktop: form.get(`${eventType}:desktop`) === "on",
      slackDm: form.get(`${eventType}:slackDm`) === "on",
      digestFrequency,
    });
  }
  if (rows.length === 0) return { ok: false as const, error: "Nothing to save." };

  await prisma.$transaction(
    rows.map((r) =>
      prisma.notificationPreference.upsert({
        where: {
          userId_eventType: { userId: auth.user.sub, eventType: r.eventType },
        },
        update: {
          inApp: r.inApp,
          desktop: r.desktop,
          slackDm: r.slackDm,
          digestFrequency: r.digestFrequency,
        },
        create: {
          userId: auth.user.sub,
          eventType: r.eventType,
          inApp: r.inApp,
          desktop: r.desktop,
          slackDm: r.slackDm,
          digestFrequency: r.digestFrequency,
        },
      }),
    ),
  );

  return { ok: true as const, error: null };
}
