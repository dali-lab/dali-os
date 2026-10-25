import { describe, expect, it } from "vitest";
import {
  bannerStatus,
  isSafeMediaUrl,
  matchesPage,
  shouldShow,
  snoozeOffered,
  validateForPublish,
  type BannerInput,
} from "~/core/lib/banners";

const NOW = new Date("2026-10-24T15:00:00Z");

describe("bannerStatus", () => {
  const b = (published: boolean, startsAt: string, endsAt: string) => ({ published, startsAt, endsAt });
  it("is a draft until published, then scheduled, live, and ended by its window", () => {
    expect(bannerStatus(b(false, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"), NOW)).toBe("draft");
    expect(bannerStatus(b(true, "2026-10-25T00:00:00Z", "2026-11-01T00:00:00Z"), NOW)).toBe("scheduled");
    expect(bannerStatus(b(true, "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"), NOW)).toBe("live");
    expect(bannerStatus(b(true, "2026-10-01T00:00:00Z", NOW.toISOString()), NOW)).toBe("ended");
  });
});

describe("matchesPage", () => {
  it("matches a section and everything under it, and Home only at the root", () => {
    expect(matchesPage("/calendar", "/calendar")).toBe(true);
    expect(matchesPage("/calendar", "/calendar/meeting/1")).toBe(true);
    expect(matchesPage("/calendar", "/calendars")).toBe(false);
    expect(matchesPage("/", "/")).toBe(true);
    expect(matchesPage("/", "/projects")).toBe(false);
    expect(matchesPage(null, "/")).toBe(false);
  });
});

describe("shouldShow", () => {
  const today = "2026-10-24";
  const seen = (views: number, lastSeenDay: string | null, snoozedDay: string | null = null) => ({ views, lastSeenDay, snoozedDay });

  it("always shows a banner the viewer has never seen", () => {
    expect(shouldShow({ frequency: "Once", allowSnooze: false }, null, today)).toBe(true);
  });

  it("shows an every-time banner again unless it was hidden for today", () => {
    const b = { frequency: "EveryOpen" as const, allowSnooze: true };
    expect(shouldShow(b, seen(5, today), today)).toBe(true);
    expect(shouldShow(b, seen(5, today, today), today)).toBe(false);
    expect(shouldShow(b, seen(5, today, "2026-10-23"), today)).toBe(true);
  });

  it("ignores a stale snooze once the banner stops offering one", () => {
    expect(shouldShow({ frequency: "EveryOpen", allowSnooze: false }, seen(1, today, today), today)).toBe(true);
  });

  it("shows a daily banner once per lab day and a once banner a single time", () => {
    expect(shouldShow({ frequency: "Daily", allowSnooze: false }, seen(1, today), today)).toBe(false);
    expect(shouldShow({ frequency: "Daily", allowSnooze: false }, seen(1, "2026-10-23"), today)).toBe(true);
    expect(shouldShow({ frequency: "Once", allowSnooze: false }, seen(1, "2026-09-01"), today)).toBe(false);
    expect(shouldShow({ frequency: "Once", allowSnooze: false }, seen(0, null), today)).toBe(true);
  });
});

describe("snoozeOffered", () => {
  it("only offers hide-for-today on banners that would otherwise repeat", () => {
    expect(snoozeOffered({ allowSnooze: true, frequency: "EveryOpen" })).toBe(true);
    expect(snoozeOffered({ allowSnooze: true, frequency: "Daily" })).toBe(false);
    expect(snoozeOffered({ allowSnooze: false, frequency: "EveryOpen" })).toBe(false);
  });
});

describe("isSafeMediaUrl", () => {
  it("accepts https links and banner uploads only", () => {
    expect(isSafeMediaUrl("https://cdn.example.com/a.jpg")).toBe(true);
    expect(isSafeMediaUrl("/api/upload/raw?key=uploads%2Fbanners%2Fabc-a.jpg")).toBe(true);
    expect(isSafeMediaUrl("/api/upload/raw?key=uploads%2Fprojects%2Fsecret.pdf")).toBe(false);
    expect(isSafeMediaUrl("http://example.com/a.jpg")).toBe(false);
    expect(isSafeMediaUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("validateForPublish", () => {
  const base: BannerInput = {
    name: "",
    kind: "Image",
    mediaUrl: "https://x/a.jpg",
    videoUrl: null,
    headline: "",
    body: "",
    ctaLabel: "",
    ctaUrl: "",
    tone: "Accent",
    everyone: false,
    roles: ["isLabMember"],
    groupIds: [],
    trigger: "AppOpen",
    triggerPath: null,
    frequency: "EveryOpen",
    allowSnooze: true,
    startsAt: "2026-10-26T13:00:00.000Z",
    endsAt: "2026-11-02T21:00:00.000Z",
    published: true,
  };

  it("passes a complete banner", () => {
    expect(validateForPublish(base)).toEqual({});
  });

  it("needs media or a headline, and a headline for text banners", () => {
    expect(validateForPublish({ ...base, mediaUrl: null }).content).toBe("Add media or a headline");
    expect(validateForPublish({ ...base, mediaUrl: null, headline: "Hi" }).content).toBeUndefined();
    expect(validateForPublish({ ...base, kind: "Text" }).content).toBe("Add a headline");
    expect(validateForPublish({ ...base, kind: "Video" }).content).toBe("Add media or a headline");
    expect(validateForPublish({ ...base, kind: "Video", videoUrl: "https://x/v.mp4" }).content).toBeUndefined();
  });

  it("refuses unsafe media and button links", () => {
    expect(validateForPublish({ ...base, mediaUrl: "http://x/a.jpg" }).content).toBe("Media links must start with https://");
    expect(validateForPublish({ ...base, ctaLabel: "Go", ctaUrl: "javascript:void(0)" }).content).toBe(
      "Button link must start with / or https://",
    );
    expect(validateForPublish({ ...base, ctaLabel: "Go", ctaUrl: "//evil.com" }).content).toBe(
      "Button link must start with / or https://",
    );
    expect(validateForPublish({ ...base, ctaLabel: "Go", ctaUrl: "/projects" }).content).toBeUndefined();
  });

  it("needs an audience, a forward window, and a known page for page banners", () => {
    expect(validateForPublish({ ...base, roles: [] }).audience).toBe("Pick an audience");
    expect(validateForPublish({ ...base, roles: [], everyone: true }).audience).toBeUndefined();
    expect(validateForPublish({ ...base, roles: [], groupIds: ["g1"] }).audience).toBeUndefined();
    expect(validateForPublish({ ...base, endsAt: base.startsAt }).schedule).toBe("End must be after start");
    expect(validateForPublish({ ...base, trigger: "Page", triggerPath: "/admin" }).trigger).toBe("Pick a page");
    expect(validateForPublish({ ...base, trigger: "Page", triggerPath: "/calendar" }).trigger).toBeUndefined();
  });
});
