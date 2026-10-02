import { describe, expect, it } from "vitest";

import {
  NOTIFICATION_COPY,
  type NotificationCopyKey,
  NOTIFICATION_COPY_KEYS,
  isNotificationCopyKey,
  notificationCopyDef,
  notificationSample,
} from "~/email/lib/notification-copy";
import { EVENT_TYPES, EVENT_TYPE_KEYS } from "~/lib/notification-events";
import { TEMPLATE_VARIABLES_REGISTRY, extractPlaceholders } from "~/lib/template-variables";
import { emailTemplateDef, isEmailTemplateKey, notifyTemplateKey } from "~/email/lib/registry";

describe("notification copy integrity", () => {
  it("points every message at a real event type", () => {
    for (const key of NOTIFICATION_COPY_KEYS) {
      expect(EVENT_TYPE_KEYS, key).toContain(notificationCopyDef(key).eventType);
    }
  });

  it("covers every event type that is actually emitted", () => {
    // `general` is the schema column default stamped on rows that predate the
    // registry. Nothing emits it, so it needs no wording.
    const covered = new Set(NOTIFICATION_COPY_KEYS.map((k) => notificationCopyDef(k).eventType));
    for (const eventType of EVENT_TYPE_KEYS) {
      if (eventType === "general") continue;
      expect(covered, `no copy for ${eventType}`).toContain(eventType);
    }
  });

  it("uses only tokens the template vocabulary knows", () => {
    const known = new Set(Object.keys(TEMPLATE_VARIABLES_REGISTRY));
    for (const key of NOTIFICATION_COPY_KEYS) {
      for (const v of notificationCopyDef(key).variables) {
        expect(known, `${key} declares {{${v}}}`).toContain(v);
      }
    }
  });

  it("declares every token its own subject and body interpolate", () => {
    // A token used but undeclared would ship as literal text, and the editor
    // would flag it as unfilled for the operator.
    for (const key of NOTIFICATION_COPY_KEYS) {
      const def = notificationCopyDef(key);
      const used = new Set([
        ...extractPlaceholders(def.subject),
        ...extractPlaceholders(def.body ?? ""),
      ]);
      for (const token of used) {
        expect(def.variables as readonly string[], `${key} uses {{${token}}}`).toContain(token);
      }
    }
  });

  it("gives every message a non-empty subject", () => {
    for (const key of NOTIFICATION_COPY_KEYS) {
      expect(notificationCopyDef(key).subject.trim().length, key).toBeGreaterThan(0);
    }
  });

  it("omits the body only where the copy is authored per send", () => {
    // Announcements are the exception: Core and instructors write them, so the
    // template owns the frame and the caller's body passes through.
    const passthrough = NOTIFICATION_COPY_KEYS.filter((k) => notificationCopyDef(k).body === undefined);
    expect(passthrough.sort()).toEqual(["announcement", "education.announcement"]);
  });

  it("ends every description with a full stop, so the admin list reads", () => {
    for (const key of NOTIFICATION_COPY_KEYS) {
      const def = notificationCopyDef(key);
      expect(def.description.endsWith("."), `${key}: ${def.description}`).toBe(true);
      expect(def.label.length, key).toBeGreaterThan(0);
    }
  });

  it("distinguishes the messages an event type says more than one of", () => {
    // The reason keys are per message rather than per event type: one template
    // per event would have forced these to share a sentence.
    const byEvent = new Map<string, NotificationCopyKey[]>();
    for (const key of NOTIFICATION_COPY_KEYS) {
      const e = notificationCopyDef(key).eventType;
      byEvent.set(e, [...(byEvent.get(e) ?? []), key]);
    }
    expect(byEvent.get("meeting.cancelled")).toHaveLength(3);
    expect(byEvent.get("education.decision")).toHaveLength(5);
    expect(byEvent.get("pagedoc.mention")).toHaveLength(4);
    // Within one event type each message must read differently, or splitting it
    // was pointless. Subject alone isn't enough: a waitlisted and a released Core
    // decision have always shared "Core application update" and differed in the
    // body, so distinctness is over the pair.
    for (const [event, keys] of byEvent) {
      const rendered = keys.map((k) => {
        const def = notificationCopyDef(k);
        return `${def.subject}\u0000${def.body ?? ""}`;
      });
      expect(new Set(rendered).size, event).toBe(rendered.length);
    }
  });
});

describe("isNotificationCopyKey", () => {
  it("accepts real keys and rejects inherited property names", () => {
    expect(isNotificationCopyKey("meeting.invite")).toBe(true);
    expect(isNotificationCopyKey("nope")).toBe(false);
    expect(isNotificationCopyKey("toString")).toBe(false);
    expect(isNotificationCopyKey(null)).toBe(false);
  });
});

describe("notificationSample", () => {
  it("fills exactly the tokens asked for", () => {
    const sample = notificationSample(["itemTitle", "when"]);
    expect(Object.keys(sample).sort()).toEqual(["itemTitle", "when"]);
    expect(sample.itemTitle.length).toBeGreaterThan(0);
  });

  it("has a value for every token, so no preview renders a raw placeholder", () => {
    for (const key of NOTIFICATION_COPY_KEYS) {
      const sample = notificationSample(notificationCopyDef(key).variables);
      for (const [token, value] of Object.entries(sample)) {
        expect(value, `${key} / ${token}`).toBeTruthy();
      }
    }
  });
});

describe("projection into the email template registry", () => {
  it("exposes every message as an editable template", () => {
    for (const key of NOTIFICATION_COPY_KEYS) {
      expect(isEmailTemplateKey(notifyTemplateKey(key)), key).toBe(true);
    }
  });

  it("carries the registry's wording as the fallback, so untouched rows keep today's copy", () => {
    const def = emailTemplateDef(notifyTemplateKey("meeting.invite"));
    expect(def.whenMissing).toBe("default");
    expect(def.defaults?.subject).toBe("Meeting invite: {{itemTitle}}");
  });

  it("routes notification mail through the General identity with the settings footer", () => {
    for (const key of NOTIFICATION_COPY_KEYS) {
      const def = emailTemplateDef(notifyTemplateKey(key));
      expect(def.purpose, key).toBe("General");
      expect(def.footer, key).toBe("notifications");
    }
  });

  it("takes its area from the event type, so the admin list groups the same way", () => {
    const def = emailTemplateDef(notifyTemplateKey("task.assigned"));
    expect(def.area).toBe(EVENT_TYPES["task.assigned"].area);
  });

  it("never falls back to nothing — a default key always has defaults", () => {
    for (const key of NOTIFICATION_COPY_KEYS) {
      const def = emailTemplateDef(notifyTemplateKey(key));
      expect(def.defaults, key).toBeDefined();
    }
  });

  it("counts every message once", () => {
    expect(NOTIFICATION_COPY_KEYS).toHaveLength(Object.keys(NOTIFICATION_COPY).length);
    expect(new Set(NOTIFICATION_COPY_KEYS).size).toBe(NOTIFICATION_COPY_KEYS.length);
  });
});
