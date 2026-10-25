import { describe, it, expect } from "vitest";
import { EVENT_TYPES, type EventDef } from "~/lib/notification-events";
import {
  VISIBLE_EVENTS,
  choicesToFormData,
  inAppForced,
  visibleAreas,
} from "~/components/settings/NotificationsSettingsBlock";

const def = (k: keyof typeof EVENT_TYPES): EventDef => EVENT_TYPES[k];

describe("inAppForced", () => {
  it("forces in-app for digests and locked events only", () => {
    expect(inAppForced(def("education.discussion"), "Daily")).toBe(true);
    expect(inAppForced(def("education.discussion"), "Weekly")).toBe(true);
    expect(inAppForced(def("education.discussion"), "Instant")).toBe(false);
    expect(inAppForced(def("education.discussion"), "Off")).toBe(false);
    expect(inAppForced(def("meeting.invite"), "Off")).toBe(true);
  });
});

describe("visibleAreas", () => {
  const all = (isAdmin: boolean, isCore: boolean) =>
    visibleAreas(isAdmin, isCore).flatMap((a) => a.events as string[]);

  it("hides admin-only and core-only events from members", () => {
    const member = all(false, false);
    for (const k of VISIBLE_EVENTS) {
      const d = def(k);
      if (d.adminOnly || d.coreOnly) expect(member).not.toContain(k);
    }
  });

  it("shows everything with an area to an admin in Core", () => {
    const admin = all(true, true);
    expect(admin.length).toBeGreaterThan(all(false, false).length);
    expect(new Set(admin).size).toBe(admin.length);
  });
});

describe("choicesToFormData", () => {
  it("writes the fields the save action reads", () => {
    const fd = choicesToFormData({
      "education.discussion": { inApp: true, desktop: false, slackDm: true, email: "Daily" },
    });
    expect(fd.get("education.discussion:present")).toBe("1");
    expect(fd.get("education.discussion:inApp")).toBe("on");
    expect(fd.get("education.discussion:desktop")).toBeNull();
    expect(fd.get("education.discussion:slackDm")).toBe("on");
    expect(fd.get("education.discussion:email")).toBe("Daily");
  });
});
