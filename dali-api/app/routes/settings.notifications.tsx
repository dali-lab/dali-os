// Settings → Notifications. Per-event channel matrix backed by
// NotificationPreference rows; absent rows mean the registry default
// (app/lib/notification-events.ts) applies, so the page renders effective
// values and writes explicit rows for every visible event on save.

import { redirect, useFetcher } from "react-router";
import { Slack } from "lucide-react";
import { Link } from "react-router";
import {
  requireAuth,
  unauthorized,
  forbidden,
  redirectPartnerToPortal,
  isPartnerAccount,
} from "~/lib/auth";
import { prisma } from "~/lib/db";
import {
  EVENT_TYPES,
  EVENT_TYPE_KEYS,
  isEventType,
  type EventDef,
  type EventType,
} from "~/lib/notification-events";
import { jobByName, resolveJobSettings } from "~/jobs/registry";
import type { Route } from "./+types/settings.notifications";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function hourLabel(hour: number): string {
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

export const meta: Route.MetaFunction = () => [
  { title: "Notifications · Settings · DALI OS" },
];

// `general` is the pre-registry backfill value — nothing emits it.
const VISIBLE_EVENTS = EVENT_TYPE_KEYS.filter((k) => k !== "general");

const AREA_ORDER = [
  "Meetings",
  "Tasks",
  "Staffing",
  "Announcements",
  "Forms",
  "Hiring",
  "Education",
  "Onboarding",
] as const;

const DIGEST_VALUES = ["Instant", "Daily", "Weekly", "Off"] as const;
type DigestValue = (typeof DIGEST_VALUES)[number];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  const [prefs, user, digestRows] = await Promise.all([
    prisma.notificationPreference.findMany({
      where: { userId: auth.user.sub },
      select: { eventType: true, inApp: true, slackDm: true, digestFrequency: true },
    }),
    prisma.user.findUnique({
      where: { id: auth.user.sub },
      select: { slackUserId: true },
    }),
    prisma.scheduledJob.findMany({
      where: { name: { in: ["notification-digest-daily", "notification-digest-weekly"] } },
      select: { name: true, settings: true },
    }),
  ]);

  // Render the digest schedule as actually configured (Admin → Jobs), not a
  // hardcoded time.
  const rowByName = new Map(digestRows.map((r) => [r.name, r]));
  const dailyDef = jobByName("notification-digest-daily");
  const weeklyDef = jobByName("notification-digest-weekly");
  const daily = dailyDef
    ? resolveJobSettings(dailyDef, rowByName.get("notification-digest-daily")?.settings)
    : { sendHourEt: 9 };
  const weekly = weeklyDef
    ? resolveJobSettings(weeklyDef, rowByName.get("notification-digest-weekly")?.settings)
    : { sendHourEt: 9, sendWeekday: 1 };

  return {
    prefs,
    slackConnected: !!user?.slackUserId,
    digestSchedule: {
      dailyHour: daily.sendHourEt,
      weeklyHour: weekly.sendHourEt,
      weeklyWeekday: weekly.sendWeekday ?? 1,
    },
  };
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
        update: { inApp: r.inApp, slackDm: r.slackDm, digestFrequency: r.digestFrequency },
        create: {
          userId: auth.user.sub,
          eventType: r.eventType,
          inApp: r.inApp,
          slackDm: r.slackDm,
          digestFrequency: r.digestFrequency,
        },
      }),
    ),
  );

  return { ok: true as const, error: null };
}

export default function SettingsNotificationsPage({ loaderData }: Route.ComponentProps) {
  const { prefs, slackConnected, digestSchedule } = loaderData;
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const saved = fetcher.state === "idle" && fetcher.data?.ok === true;

  const prefByType = new Map(prefs.map((p) => [p.eventType, p]));
  const effective = (eventType: EventType) => {
    const def: EventDef = EVENT_TYPES[eventType];
    const row = prefByType.get(eventType);
    return {
      def,
      inApp: def.lockedInApp ? true : (row?.inApp ?? def.defaults.inApp),
      slackDm: row?.slackDm ?? def.defaults.slackDm,
      email: (row?.digestFrequency ?? def.defaults.email) as DigestValue,
    };
  };

  const byArea = AREA_ORDER.map((area) => ({
    area,
    events: VISIBLE_EVENTS.filter((k) => EVENT_TYPES[k].area === area),
  })).filter((g) => g.events.length > 0);

  return (
    <main className="max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Choose how each kind of update reaches you. In-app notifications land in
          your bell and Home inbox; email can arrive instantly or batched into a
          daily ({hourLabel(digestSchedule.dailyHour)} ET) or weekly (
          {WEEKDAY_NAMES[digestSchedule.weeklyWeekday]}{" "}
          {hourLabel(digestSchedule.weeklyHour)} ET) digest; Slack DMs come from
          the DALI OS bot.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Digests summarize your unread in-app notifications, so choosing a
          daily or weekly digest keeps in-app on for that event.
        </p>
        {!slackConnected && (
          <p className="mt-2 text-xs text-zinc-500">
            Slack DMs need a connected Slack account —{" "}
            <Link to="/settings/slack" className="text-blue-700 underline">
              connect it in Settings → Slack
            </Link>
            .
          </p>
        )}
      </header>

      <fetcher.Form method="post" className="mt-6">
        {byArea.map(({ area, events }) => (
          <section key={area} className="mt-6 first:mt-0">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              {area}
            </h2>
            <div className="mt-2 overflow-hidden rounded-md border border-zinc-200 bg-white">
              <div className="grid grid-cols-[1fr_4rem_4.5rem_8rem] items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-500">
                <span />
                <span className="text-center">In-app</span>
                <span className="text-center">Slack DM</span>
                <span className="text-center">Email</span>
              </div>
              {events.map((eventType) => {
                const { def, inApp, slackDm, email } = effective(eventType);
                return (
                  <div
                    key={eventType}
                    className="grid grid-cols-[1fr_4rem_4.5rem_8rem] items-center gap-2 border-b border-zinc-100 px-3 py-2.5 last:border-b-0"
                  >
                    <input type="hidden" name={`${eventType}:present`} value="1" />
                    <div>
                      <p className="text-sm font-medium text-zinc-900">{def.label}</p>
                      <p className="text-xs text-zinc-500">{def.description}</p>
                    </div>
                    <div className="text-center">
                      <input
                        type="checkbox"
                        name={`${eventType}:inApp`}
                        defaultChecked={inApp}
                        disabled={def.lockedInApp}
                        title={def.lockedInApp ? "Required — this is an action item" : undefined}
                        className="h-4 w-4 rounded border-zinc-300 disabled:opacity-50"
                      />
                    </div>
                    <div className="text-center">
                      <input
                        type="checkbox"
                        name={`${eventType}:slackDm`}
                        defaultChecked={slackDm}
                        disabled={!slackConnected}
                        title={!slackConnected ? "Connect Slack first" : undefined}
                        className="h-4 w-4 rounded border-zinc-300 disabled:opacity-50"
                      />
                    </div>
                    <div className="text-center">
                      {def.externalEmail ? (
                        <span
                          className="text-xs text-zinc-400"
                          title="Sent by email separately"
                        >
                          —
                        </span>
                      ) : (
                        <select
                          name={`${eventType}:email`}
                          defaultValue={email}
                          className="w-full rounded-md border border-zinc-300 px-2 py-1 text-xs"
                        >
                          <option value="Instant">Instantly</option>
                          <option value="Daily">Daily digest</option>
                          <option value="Weekly">Weekly digest</option>
                          <option value="Off">Off</option>
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        <div className="mt-6 flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save preferences"}
          </button>
          {saved && <span className="text-sm text-green-700">Saved.</span>}
          {fetcher.data && fetcher.data.ok === false && (
            <span className="text-sm text-red-700">{fetcher.data.error}</span>
          )}
        </div>
      </fetcher.Form>
    </main>
  );
}
