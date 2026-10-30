import { requireAuth, unauthorized, forbidden, isPartnerAccount, isNonMember } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { isAdmin, isCore } from "~/lib/roles";
import {
  EVENT_TYPES,
  isEventType,
  type EventDef,
  type EventType,
} from "~/lib/notification-events";
import {
  VISIBLE_EVENTS,
  DIGEST_VALUES,
  NotificationsSettingsBlock,
  type DigestValue,
} from "~/components/settings/NotificationsSettingsBlock";
import { digestHourOptions, digestHourToStore } from "~/components/settings/digest-hours";
import { loadDigestSchedule } from "~/lib/settings-page.server";
import { useSettingsData } from "./settings";
import type { Route } from "./+types/settings.notifications";

export const meta: Route.MetaFunction = () => [{ title: "Settings · DALI OS" }];

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return unauthorized(request);
  if (await isNonMember(auth, request)) return forbidden(request);
  if (await isPartnerAccount(auth)) return forbidden(request);
  const viewerIsAdmin = await isAdmin(auth.user.sub);
  const viewerIsCore = await isCore(auth.user.sub);

  const form = await request.formData();

  if (form.get("intent") === "digest-hour") {
    const { dailyHour } = await loadDigestSchedule();
    const hour = Number(form.get("hour"));
    if (!digestHourOptions(dailyHour).includes(hour)) {
      return { ok: false as const, error: "Pick one of the listed times." };
    }
    await prisma.user.update({
      where: { id: auth.user.sub },
      data: { digestHourEt: digestHourToStore(hour, dailyHour) },
    });
    return { ok: true as const, error: null };
  }

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
    // Admin-only events aren't rendered for non-admins; ignore any forged post.
    if (def.adminOnly && !viewerIsAdmin) continue;
    // Same idea for Core-only (Partners) events.
    if (def.coreOnly && !viewerIsCore) continue;
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

export default function SettingsNotifications() {
  const data = useSettingsData();
  return <NotificationsSettingsBlock {...data.notifications} />;
}
