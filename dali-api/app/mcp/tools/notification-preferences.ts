// MCP notification-preference tools — read the effective per-event settings
// (explicit NotificationPreference row, else registry default) and set them.
// Mirrors the /settings/notifications page's rules: locked in-app events
// can't be muted, externally-emailed events expose no email control.

import { prisma } from "~/lib/db";
import {
  EVENT_TYPES,
  EVENT_TYPE_KEYS,
  isEventType,
  type EventDef,
} from "~/lib/notification-events";

// `general` is the pre-registry backfill value — nothing emits it and the
// settings page hides it.
const SETTABLE_EVENT_TYPES = EVENT_TYPE_KEYS.filter((k) => k !== "general");

const EMAIL_VALUES = ["Instant", "Daily", "Weekly", "Off"] as const;
type EmailValue = (typeof EMAIL_VALUES)[number];

export const LIST_NOTIFICATION_PREFERENCES_TOOL = {
  name: "list_notification_preferences",
  description:
    "Return the authenticated member's notification settings for every event type — in-app, desktop banner, Slack DM, and email (Instant/Daily/Weekly/Off) — resolving registry defaults where no explicit preference is saved.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

export async function runListNotificationPreferences(callerId: string) {
  const rows = await prisma.notificationPreference.findMany({
    where: { userId: callerId },
  });
  const byEvent = new Map(rows.map((r) => [r.eventType, r]));
  return {
    preferences: SETTABLE_EVENT_TYPES.map((eventType) => {
      const def: EventDef = EVENT_TYPES[eventType];
      const row = byEvent.get(eventType);
      return {
        eventType,
        area: def.area,
        label: def.label,
        description: def.description,
        inApp: def.lockedInApp ? true : (row?.inApp ?? def.defaults.inApp),
        desktop: row?.desktop ?? def.defaults.desktop,
        slackDm: row?.slackDm ?? def.defaults.slackDm,
        email: def.externalEmail
          ? "Off"
          : (row?.digestFrequency ?? def.defaults.email),
        lockedInApp: def.lockedInApp ?? false,
        externalEmail: def.externalEmail ?? false,
        // False = the values above are registry defaults, not a saved row.
        explicit: row !== undefined,
      };
    }),
  };
}

export const SET_NOTIFICATION_PREFERENCE_TOOL = {
  name: "set_notification_preference",
  description:
    "Set the authenticated member's notification channels for one event type. Omitted fields keep their current effective value. Locked in-app events can't be muted; externally-emailed events accept no email setting.",
  inputSchema: {
    type: "object" as const,
    properties: {
      eventType: {
        type: "string",
        enum: SETTABLE_EVENT_TYPES as string[],
        description: "Event type key, as returned by `list_notification_preferences`.",
      },
      inApp: { type: "boolean", description: "Show in the in-app notification bell." },
      desktop: {
        type: "boolean",
        description: "Raise a native banner in the DALI OS desktop app (applies when in-app is on).",
      },
      slackDm: { type: "boolean", description: "Send a Slack DM." },
      email: {
        type: "string",
        enum: EMAIL_VALUES as unknown as string[],
        description: "Instant email, Daily/Weekly digest, or Off.",
      },
    },
    required: ["eventType"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type SetInput = {
  eventType: string;
  inApp?: boolean;
  desktop?: boolean;
  slackDm?: boolean;
  email?: EmailValue;
};

export class PreferenceValidationError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "PreferenceValidationError";
  }
}

export async function runSetNotificationPreference(callerId: string, input: SetInput) {
  if (!isEventType(input.eventType) || input.eventType === "general") {
    throw new PreferenceValidationError("Unknown eventType", 400);
  }
  const def: EventDef = EVENT_TYPES[input.eventType];
  if (def.lockedInApp && input.inApp === false) {
    throw new PreferenceValidationError(
      "This event's in-app notification is a workflow surface and can't be turned off",
      400,
    );
  }
  if (def.externalEmail && input.email !== undefined) {
    throw new PreferenceValidationError(
      "This event's email is owned by its own template pipeline",
      400,
    );
  }

  const where = {
    userId_eventType: { userId: callerId, eventType: input.eventType },
  };
  const existing = await prisma.notificationPreference.findUnique({ where });
  const inApp = input.inApp ?? existing?.inApp ?? def.defaults.inApp;
  const desktop = input.desktop ?? existing?.desktop ?? def.defaults.desktop;
  const slackDm = input.slackDm ?? existing?.slackDm ?? def.defaults.slackDm;
  const digestFrequency =
    input.email ??
    existing?.digestFrequency ??
    (def.externalEmail ? "Off" : def.defaults.email);

  await prisma.notificationPreference.upsert({
    where,
    update: { inApp, desktop, slackDm, digestFrequency },
    create: {
      userId: callerId,
      eventType: input.eventType,
      inApp,
      desktop,
      slackDm,
      digestFrequency,
    },
  });

  return { ok: true, eventType: input.eventType, inApp, desktop, slackDm, email: digestFrequency };
}
