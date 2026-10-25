import { useEffect, useMemo, useState } from "react";
import { Link, useFetcher } from "react-router";
import { ChevronDown } from "lucide-react";
import {
  EVENT_TYPES,
  EVENT_TYPE_KEYS,
  type EventDef,
  type EventType,
} from "~/lib/notification-events";
import { cn } from "~/lib/cn";
import { Checkbox } from "~/components/ui/Checkbox";
import { Segmented } from "~/components/ui/Segmented";
import { Select, Tooltip } from "~/components/ui/floating";
import { useToast } from "~/components/ui/toast";
import { useOsChrome } from "~/components/os-chrome";
import {
  WEEKDAY_NAMES,
  digestHourLabel,
  digestHourOptions,
} from "~/components/settings/digest-hours";

// `general` is the pre-registry backfill value: nothing emits it.
export const VISIBLE_EVENTS = EVENT_TYPE_KEYS.filter((k) => k !== "general");

const AREA_ORDER = [
  "Meetings",
  "Tasks",
  "Staffing",
  "Documents",
  "Mentorship",
  "People",
  "Community",
  "Announcements",
  "Release notes",
  "Forms",
  "Hiring",
  "Education",
  "Onboarding",
  "Partners",
] as const;

export const DIGEST_VALUES = ["Instant", "Daily", "Weekly", "Off"] as const;
export type DigestValue = (typeof DIGEST_VALUES)[number];

const EMAIL_LABEL: Record<DigestValue, string> = {
  Instant: "Instantly",
  Daily: "Daily digest",
  Weekly: "Weekly digest",
  Off: "Off",
};

export const NOTIFICATIONS_ACTION = "/settings/notifications";

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
  /** The member's own digest hour, null for the lab default. */
  digestHourEt: number | null;
  isAdmin: boolean;
  isCore: boolean;
};

type Choice = { inApp: boolean; desktop: boolean; slackDm: boolean; email: DigestValue };
type Choices = Record<string, Choice>;

/** Digests summarize unread in-app rows, so a digest choice keeps in-app on. */
export function inAppForced(def: EventDef, email: DigestValue): boolean {
  return !!def.lockedInApp || email === "Daily" || email === "Weekly";
}

export function visibleAreas(isAdmin: boolean, isCore: boolean) {
  return AREA_ORDER.map((area) => ({
    area,
    events: VISIBLE_EVENTS.filter((k) => {
      const def: EventDef = EVENT_TYPES[k];
      return def.area === area && !(def.adminOnly && !isAdmin) && !(def.coreOnly && !isCore);
    }),
  })).filter((g) => g.events.length > 0);
}

/** The form the action reads: a `:present` marker per row, checkboxes as "on". */
export function choicesToFormData(choices: Choices): FormData {
  const fd = new FormData();
  for (const [eventType, c] of Object.entries(choices)) {
    fd.set(`${eventType}:present`, "1");
    if (c.inApp) fd.set(`${eventType}:inApp`, "on");
    if (c.desktop) fd.set(`${eventType}:desktop`, "on");
    if (c.slackDm) fd.set(`${eventType}:slackDm`, "on");
    fd.set(`${eventType}:email`, c.email);
  }
  return fd;
}

const COLS = "grid grid-cols-[minmax(0,1fr)_64px_64px_64px_160px] items-center gap-2";

export function NotificationsSettingsBlock({
  prefs,
  slackConnected,
  digestSchedule,
  digestHourEt,
  isAdmin,
  isCore,
}: NotificationsSettingsData) {
  const { compactField, actionBtn, actionBtnPrimary } = useOsChrome();
  const toast = useToast();
  const saveFetcher = useFetcher<{ ok: boolean; error: string | null }>();
  const hourFetcher = useFetcher<{ ok: boolean; error: string | null }>();
  const areas = useMemo(() => visibleAreas(isAdmin, isCore), [isAdmin, isCore]);

  const saved = useMemo<Choices>(() => {
    const byType = new Map(prefs.map((p) => [p.eventType, p]));
    const out: Choices = {};
    for (const { events } of areas) {
      for (const t of events) {
        const def: EventDef = EVENT_TYPES[t];
        const row = byType.get(t);
        const email = (row?.digestFrequency ?? def.defaults.email) as DigestValue;
        out[t] = {
          inApp: inAppForced(def, email) || (row?.inApp ?? def.defaults.inApp),
          desktop: row?.desktop ?? def.defaults.desktop,
          slackDm: row?.slackDm ?? def.defaults.slackDm,
          email,
        };
      }
    }
    return out;
  }, [prefs, areas]);

  const [draft, setDraft] = useState<Choices>(saved);
  useEffect(() => setDraft(saved), [saved]);
  const [open, setOpen] = useState<string[]>(() => areas.slice(0, 2).map((a) => a.area));
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  useEffect(() => {
    if (saveFetcher.state !== "idle" || !saveFetcher.data) return;
    if (saveFetcher.data.ok) toast.success("Notification preferences saved");
    else toast.error(saveFetcher.data.error ?? "Couldn't save.");
  }, [saveFetcher.state, saveFetcher.data, toast]);

  useEffect(() => {
    if (hourFetcher.state !== "idle" || !hourFetcher.data) return;
    if (hourFetcher.data.ok) toast.success("Digest time updated");
    else toast.error(hourFetcher.data.error ?? "Couldn't save.");
  }, [hourFetcher.state, hourFetcher.data, toast]);

  const defaultHour = digestSchedule.dailyHour;
  const pendingHour = hourFetcher.formData?.get("hour");
  const hour = pendingHour != null ? Number(pendingHour) : (digestHourEt ?? defaultHour);

  function update(eventType: string, patch: Partial<Choice>) {
    setDraft((d) => {
      const next = { ...d[eventType]!, ...patch };
      if (inAppForced(EVENT_TYPES[eventType as EventType], next.email)) next.inApp = true;
      return { ...d, [eventType]: next };
    });
  }

  function summary(events: readonly string[]) {
    const emails = [...new Set(events.map((t) => draft[t]?.email).filter(Boolean))] as DigestValue[];
    const external = events.every((t) => (EVENT_TYPES[t as EventType] as EventDef).externalEmail);
    const email = external
      ? null
      : emails.length === 1
        ? `Email ${EMAIL_LABEL[emails[0]!].toLowerCase()}`
        : "Mixed email";
    const slack = events.some((t) => draft[t]?.slackDm) ? "Slack" : null;
    const n = events.length;
    return [`${n} ${n === 1 ? "notification" : "notifications"}`, slack, email].filter(Boolean).join(" · ");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-xl flex-col gap-1 text-sm text-os-grey">
          <p>Choose where each notification reaches you. Locked ones are required.</p>
          <p className="text-os-muted">
            A daily or weekly digest keeps in-app on, since digests list what you haven't read.
            Weekly digests go out on {WEEKDAY_NAMES[digestSchedule.weeklyWeekday]}s.
          </p>
          {!slackConnected && (
            <p className="text-os-muted">
              Slack DMs need Slack connected.{" "}
              <Link to="/settings/connections" className="text-os-accent hover:text-os-accent-hover">
                Connect it in Connections
              </Link>
              .
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-os-grey">Digests arrive at</span>
          <Segmented
            ariaLabel="Digest time"
            size="md"
            value={String(hour)}
            onChange={(v) =>
              hourFetcher.submit(
                { intent: "digest-hour", hour: v },
                { method: "post", action: NOTIFICATIONS_ACTION },
              )
            }
            options={digestHourOptions(defaultHour).map((h) => ({
              value: String(h),
              label: digestHourLabel(h),
            }))}
          />
        </div>
      </div>

      <div className="no-scrollbar overflow-x-auto">
        <div className="flex min-w-[700px] flex-col gap-3">
          <div className={cn(COLS, "px-6 text-xs font-semibold text-os-muted")}>
            <span>Notification</span>
            <span className="text-center">In-app</span>
            <span className="text-center">Desktop</span>
            <span className="text-center">Slack DM</span>
            <span>Email</span>
          </div>

          {areas.map(({ area, events }) => {
            const expanded = open.includes(area);
            const groupId = `notif-${area.replace(/\W+/g, "-").toLowerCase()}`;
            return (
              <section key={area} className="rounded-os-card bg-os-card" aria-labelledby={groupId}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() =>
                    setOpen((prev) => (expanded ? prev.filter((x) => x !== area) : [...prev, area]))
                  }
                  className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left"
                >
                  <span>
                    <span id={groupId} className="block font-semibold text-foreground">
                      {area}
                    </span>
                    {!expanded && (
                      <span className="mt-0.5 block text-sm text-os-muted">{summary(events)}</span>
                    )}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-os-muted transition-transform duration-200 ease-out",
                      expanded && "rotate-180",
                    )}
                    aria-hidden
                  />
                </button>
                {expanded && (
                  <ul>
                    {events.map((eventType) => {
                      const def: EventDef = EVENT_TYPES[eventType];
                      const c = draft[eventType]!;
                      const forced = inAppForced(def, c.email);
                      return (
                        <li
                          key={eventType}
                          className={cn(COLS, "border-t border-os-container/70 px-6 py-3.5")}
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-foreground">{def.label}</p>
                            <p className="text-xs text-os-muted">{def.description}</p>
                          </div>
                          <span className="flex justify-center">
                            <MaybeTip
                              tip={
                                def.lockedInApp
                                  ? "Required. This is an action item."
                                  : forced
                                    ? "Digests list unread in-app notifications, so in-app stays on."
                                    : null
                              }
                            >
                              <Checkbox
                                tone="os"
                                aria-label={`${def.label} in-app`}
                                checked={c.inApp}
                                disabled={forced}
                                onChange={(e) => update(eventType, { inApp: e.target.checked })}
                              />
                            </MaybeTip>
                          </span>
                          <span className="flex justify-center">
                            <Checkbox
                              tone="os"
                              aria-label={`${def.label} desktop`}
                              checked={c.desktop}
                              onChange={(e) => update(eventType, { desktop: e.target.checked })}
                            />
                          </span>
                          <span className="flex justify-center">
                            <MaybeTip tip={slackConnected ? null : "Connect Slack first."}>
                              <Checkbox
                                tone="os"
                                aria-label={`${def.label} Slack DM`}
                                checked={c.slackDm}
                                disabled={!slackConnected}
                                onChange={(e) => update(eventType, { slackDm: e.target.checked })}
                              />
                            </MaybeTip>
                          </span>
                          {def.externalEmail ? (
                            <Tooltip content="This email comes from its own pipeline, not your notification settings.">
                              <span className="pl-3 text-xs text-os-muted">Sent separately</span>
                            </Tooltip>
                          ) : (
                            <Select
                              ariaLabel={`${def.label} email`}
                              value={c.email}
                              onChange={(email) => update(eventType, { email })}
                              options={DIGEST_VALUES.map((v) => ({ value: v, label: EMAIL_LABEL[v] }))}
                              buttonClassName={cn(
                                compactField,
                                "inline-flex w-full items-center justify-between gap-1 border border-os-container px-3 py-1.5 text-sm",
                                c.email === "Off" && "text-os-muted",
                              )}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {dirty && (
        <div className="pointer-events-none sticky bottom-6 z-30 flex justify-center">
          <div
            role="status"
            className="pointer-events-auto flex items-center gap-4 rounded-full border border-os-container bg-os-card py-2 pl-5 pr-2 shadow-[0_16px_40px_rgba(0,0,0,0.5)]"
          >
            <span className="text-sm text-foreground">Unsaved changes</span>
            <button type="button" className={actionBtn()} onClick={() => setDraft(saved)}>
              Discard
            </button>
            <button
              type="button"
              className={actionBtnPrimary}
              disabled={saveFetcher.state !== "idle"}
              onClick={() =>
                saveFetcher.submit(choicesToFormData(draft), {
                  method: "post",
                  action: NOTIFICATIONS_ACTION,
                })
              }
            >
              {saveFetcher.state !== "idle" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MaybeTip({ tip, children }: { tip: string | null; children: React.ReactNode }) {
  if (!tip) return <>{children}</>;
  return (
    <Tooltip content={tip} variant="rich">
      <span>{children}</span>
    </Tooltip>
  );
}
