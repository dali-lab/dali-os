import { describe, it, expect } from "vitest";
import {
  EVENT_TYPES,
  defaultEmailFor,
  reachesAudience,
  type Audience,
  type EventDef,
} from "~/lib/notification-events";
import {
  VISIBLE_EVENTS,
  choicesToFormData,
  emailChoices,
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
  const all = (isAdmin: boolean, isCore: boolean, audience: Audience = "member") =>
    visibleAreas({ isAdmin, isCore, audience }).flatMap((a) => a.events as string[]);

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

describe("audiences", () => {
  const all = (audience: Audience) =>
    visibleAreas({ isAdmin: false, isCore: false, audience }).flatMap((a) => a.events as string[]);

  it("keeps every event a member could see before audiences existed", () => {
    for (const k of VISIBLE_EVENTS) expect(reachesAudience(def(k), "member")).toBe(true);
  });

  it("shows portal students only the education events they can receive", () => {
    expect(all("portal")).toEqual([
      "education.announcement",
      "education.decision",
      "education.assignment",
      "education.discussion",
      "education.feedback_request",
      "education.certificate",
      "education.session_reminder",
      "education.grade",
    ]);
  });

  it("shows partners only comment replies", () => {
    expect(all("partner")).toEqual(["collab.comment_reply"]);
  });

  it("emails outside users by default where members only get in-app", () => {
    expect(defaultEmailFor(def("education.assignment"), "member")).toBe("Off");
    expect(defaultEmailFor(def("education.assignment"), "portal")).toBe("Instant");
    expect(defaultEmailFor(def("collab.comment_reply"), "partner")).toBe("Instant");
    expect(defaultEmailFor(def("education.discussion"), "portal")).toBe("Off");
  });

  it("offers digests to members only", () => {
    expect(emailChoices("member")).toEqual(["Instant", "Daily", "Weekly", "Off"]);
    expect(emailChoices("portal")).toEqual(["Instant", "Off"]);
    expect(emailChoices("partner")).toEqual(["Instant", "Off"]);
  });
});
