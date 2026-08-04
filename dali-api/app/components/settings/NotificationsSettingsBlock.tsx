// Per-event notification channel matrix, rendered as a section of the
// settings page. Saves POST to /settings/notifications (that route keeps the
// action; its own page redirected here when the section moved inline).
// Absent NotificationPreference rows mean the registry default applies, so
// the matrix renders effective values and the save writes explicit rows for
// every visible event.

import { useFetcher } from "react-router";
import {
  EVENT_TYPES,
  EVENT_TYPE_KEYS,
  type EventDef,
  type EventType,
} from "~/lib/notification-events";
import { buttonClasses } from "~/components/ui/Button";
import { SelectMenu } from "~/components/ui/SelectMenu";
import { Checkbox } from "~/components/ui/Checkbox";

// `general` is the pre-registry backfill value — nothing emits it.
export const VISIBLE_EVENTS = EVENT_TYPE_KEYS.filter((k) => k !== "general");

const AREA_ORDER = [
  "Meetings",
  "Tasks",
  "Staffing",
  "Documents",
  "Announcements",
  "Forms",
  "Hiring",
  "Education",
  "Onboarding",
] as const;

export const DIGEST_VALUES = ["Instant", "Daily", "Weekly", "Off"] as const;
export type DigestValue = (typeof DIGEST_VALUES)[number];

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function hourLabel(hour: number): string {
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

export type NotificationsSettingsData = {
  prefs: {
    eventType: string;
    inApp: boolean;
    desktop: boolean;
    slackDm: boolean;
    digestFrequency: string;
  }[];
  slackConnected: boolean;
  digestSchedule: {
    dailyHour: number;
    weeklyHour: number;
    weeklyWeekday: number;
  };
  // Admin-only events (e.g. member promotions) are shown only to admins.
  isAdmin: boolean;
};

type SaveResult = { ok: boolean; error: string | null };

export function NotificationsSettingsBlock({
  prefs,
  slackConnected,
  digestSchedule,
  isAdmin,
}: NotificationsSettingsData) {
  const fetcher = useFetcher<SaveResult>();
  const busy = fetcher.state !== "idle";
  const saved = fetcher.state === "idle" && fetcher.data?.ok === true;

  const prefByType = new Map(prefs.map((p) => [p.eventType, p]));
  const effective = (eventType: EventType) => {
    const def: EventDef = EVENT_TYPES[eventType];
    const row = prefByType.get(eventType);
    return {
      def,
      inApp: def.lockedInApp ? true : (row?.inApp ?? def.defaults.inApp),
      desktop: row?.desktop ?? def.defaults.desktop,
      slackDm: row?.slackDm ?? def.defaults.slackDm,
      email: (row?.digestFrequency ?? def.defaults.email) as DigestValue,
    };
  };

  const byArea = AREA_ORDER.map((area) => ({
    area,
    events: VISIBLE_EVENTS.filter((k) => {
      const def: EventDef = EVENT_TYPES[k];
      return def.area === area && !(def.adminOnly && !isAdmin);
    }),
  })).filter((g) => g.events.length > 0);

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        In-app notifications land in your bell and Home inbox; Desktop raises a
        native banner in the DALI OS desktop app for in-app notifications;
        email can arrive instantly or batched into a daily (
        {hourLabel(digestSchedule.dailyHour)} ET) or weekly (
        {WEEKDAY_NAMES[digestSchedule.weeklyWeekday]}{" "}
        {hourLabel(digestSchedule.weeklyHour)} ET) digest; Slack DMs come from
        the DALI OS bot.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Digests summarize your unread in-app notifications, so choosing a daily
        or weekly digest keeps in-app on for that event.
      </p>
      {!slackConnected && (
        <p className="mt-2 text-xs text-muted-foreground">
          Slack DMs need a connected Slack account —{" "}
          <a href="#slack" className="text-blue-700 underline">
            connect it in the Slack section
          </a>
          .
        </p>
      )}

      <fetcher.Form method="post" action="/settings/notifications" className="mt-4">
        {byArea.map(({ area, events }) => (
          <section key={area} className="mt-6 first:mt-0">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              {area}
            </h3>
            <div className="mt-2 overflow-hidden rounded-md border border-zinc-200 bg-white">
              <div className="grid grid-cols-[1fr_4rem_4.5rem_4.5rem_8rem] items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-500">
                <span />
                <span className="text-center">In-app</span>
                <span className="text-center">Desktop</span>
                <span className="text-center">Slack DM</span>
                <span className="text-center">Email</span>
              </div>
              {events.map((eventType) => {
                const { def, inApp, desktop, slackDm, email } = effective(eventType);
                return (
                  <div
                    key={eventType}
                    className="grid grid-cols-[1fr_4rem_4.5rem_4.5rem_8rem] items-center gap-2 border-b border-zinc-100 px-3 py-2.5 last:border-b-0"
                  >
                    <input type="hidden" name={`${eventType}:present`} value="1" />
                    <div>
                      <p className="text-sm font-medium text-zinc-900">{def.label}</p>
                      <p className="text-xs text-zinc-500">{def.description}</p>
                    </div>
                    <div className="text-center">
                      <Checkbox
                        name={`${eventType}:inApp`}
                        defaultChecked={inApp}
                        disabled={def.lockedInApp}
                        title={def.lockedInApp ? "Required — this is an action item" : undefined}
                      />
                    </div>
                    <div className="text-center">
                      <Checkbox
                        name={`${eventType}:desktop`}
                        defaultChecked={desktop}
                        title="Native banner in the DALI OS desktop app (applies when in-app is on)"
                      />
                    </div>
                    <div className="text-center">
                      <Checkbox
                        name={`${eventType}:slackDm`}
                        defaultChecked={slackDm}
                        disabled={!slackConnected}
                        title={!slackConnected ? "Connect Slack first" : undefined}
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
                        <SelectMenu
                          name={`${eventType}:email`}
                          defaultValue={email}
                          options={[
                            { value: "Instant", label: "Instantly" },
                            { value: "Daily", label: "Daily digest" },
                            { value: "Weekly", label: "Weekly digest" },
                            { value: "Off", label: "Off" },
                          ]}
                          buttonClassName="w-full rounded-md border border-zinc-300 px-2 py-1 text-xs inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
                        />
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
            className={buttonClasses("primary", "sm")}
          >
            {busy ? "Saving…" : "Save preferences"}
          </button>
          {saved && <span className="text-sm text-green-700">Saved.</span>}
          {fetcher.data && fetcher.data.ok === false && (
            <span className="text-sm text-red-700">{fetcher.data.error}</span>
          )}
        </div>
      </fetcher.Form>
    </div>
  );
}
