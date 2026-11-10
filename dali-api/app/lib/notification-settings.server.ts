import { prisma } from "~/lib/db.server";
import { isNonMember, isPartnerAccount, type AuthSuccess } from "~/lib/auth";
import {
  EVENT_TYPES,
  defaultEmailFor,
  isEventType,
  type Audience,
  type EventDef,
  type EventType,
} from "~/lib/notification-events";
import {
  VISIBLE_EVENTS,
  canEditEvent,
  emailChoices,
  type DigestValue,
  type NotificationsSettingsData,
  type SettingsViewer,
} from "~/components/settings/NotificationsSettingsBlock";
import { loadDigestSchedule } from "~/lib/settings-page.server";

export async function notificationAudience(auth: AuthSuccess, request: Request): Promise<Audience> {
  if (await isPartnerAccount(auth)) return "partner";
  return (await isNonMember(auth, request)) ? "portal" : "member";
}

// The settings block for a partner or portal student: their own events, no
// admin or Core rows.
export async function loadOutsideNotificationSettings(
  userId: string,
  audience: Exclude<Audience, "member">,
  action: string,
): Promise<NotificationsSettingsData> {
  const [prefs, digestSchedule] = await Promise.all([
    prisma.notificationPreference.findMany({
      where: { userId },
      select: { eventType: true, inApp: true, desktop: true, slackDm: true, digestFrequency: true },
    }),
    loadDigestSchedule(),
  ]);
  return {
    prefs,
    slackConnected: false,
    digestSchedule,
    digestHourEt: null,
    isAdmin: false,
    isCore: false,
    audience,
    action,
  };
}

export async function saveNotificationSettings(
  userId: string,
  form: FormData,
  viewer: SettingsViewer,
): Promise<{ ok: true; error: null } | { ok: false; error: string }> {
  const allowedEmail = emailChoices(viewer.audience);
  const isMember = viewer.audience === "member";
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
    if (!canEditEvent(def, viewer)) continue;
    // Checkboxes submit only when checked; the marker tells "unchecked" from "not on the form".
    if (form.get(`${eventType}:present`) !== "1") continue;

    const email = String(form.get(`${eventType}:email`) ?? "");
    const digestFrequency = (allowedEmail as readonly string[]).includes(email)
      ? (email as DigestValue)
      : defaultEmailFor(def, viewer.audience);
    const digestSelected = digestFrequency === "Daily" || digestFrequency === "Weekly";
    rows.push({
      eventType,
      inApp:
        def.lockedInApp || digestSelected ? true : form.get(`${eventType}:inApp`) === "on",
      desktop: isMember && form.get(`${eventType}:desktop`) === "on",
      slackDm: isMember && form.get(`${eventType}:slackDm`) === "on",
      digestFrequency,
    });
  }
  if (rows.length === 0) return { ok: false, error: "Nothing to save." };

  await prisma.$transaction(
    rows.map((r) =>
      prisma.notificationPreference.upsert({
        where: { userId_eventType: { userId, eventType: r.eventType } },
        update: {
          inApp: r.inApp,
          desktop: r.desktop,
          slackDm: r.slackDm,
          digestFrequency: r.digestFrequency,
        },
        create: {
          userId,
          eventType: r.eventType,
          inApp: r.inApp,
          desktop: r.desktop,
          slackDm: r.slackDm,
          digestFrequency: r.digestFrequency,
        },
      }),
    ),
  );
  return { ok: true, error: null };
}
