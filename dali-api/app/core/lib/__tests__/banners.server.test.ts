import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  banner: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  bannerImpression: { upsert: vi.fn(), groupBy: vi.fn() },
  user: { findMany: vi.fn() },
  form: { findMany: vi.fn(), findUnique: vi.fn() },
  formSubmission: { findMany: vi.fn() },
}));
vi.mock("~/forms/lib/form-usages.server", () => ({
  formUsages: vi.fn().mockResolvedValue([]),
  managingUsage: vi.fn().mockReturnValue(null),
}));
vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/lib/groups.server", () => ({ isUserInAnyGroup: vi.fn() }));

import { isUserInAnyGroup } from "~/lib/groups.server";
import { formUsages, managingUsage } from "~/forms/lib/form-usages.server";
import type { UserRoles } from "~/lib/roles";
import type { BannerInput } from "~/core/lib/banners";
import {
  activeBannersFor,
  audienceIncludes,
  createBanner,
  listBanners,
  recordBannerEvent,
  untilFormError,
} from "~/core/lib/banners.server";

const NOW = new Date("2026-10-24T16:00:00Z");
const roles = (over: Partial<UserRoles> = {}): UserRoles => ({
  isLabMember: true,
  isCore: false,
  isAdmin: false,
  isDomainLead: false,
  isInstructor: false,
  isInterviewer: false,
  isAlumni: false,
  isStaff: false,
  canViewForms: false,
  canViewStaffing: false,
  ...over,
});

function row(over: Record<string, unknown> = {}) {
  return {
    id: "bn1",
    name: "Technigala",
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
    startsAt: new Date("2026-10-20T00:00:00Z"),
    endsAt: new Date("2026-11-01T00:00:00Z"),
    published: true,
    untilFormId: null,
    createdById: "core1",
    createdAt: NOW,
    updatedAt: NOW,
    impressions: [],
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  db.user.findMany.mockResolvedValue([{ id: "core1", firstName: "Maya", lastName: "Patel" }]);
  vi.mocked(isUserInAnyGroup).mockResolvedValue(false);
  vi.mocked(formUsages).mockResolvedValue([]);
  vi.mocked(managingUsage).mockReturnValue(null);
  db.form.findMany.mockResolvedValue([]);
  db.formSubmission.findMany.mockResolvedValue([]);
});

describe("audienceIncludes", () => {
  it("lets everyone in, then matching roles, then group members", async () => {
    expect(await audienceIncludes({ everyone: true, roles: [], groupIds: [] }, "u", roles({ isLabMember: false }))).toBe(true);
    expect(await audienceIncludes({ everyone: false, roles: ["isCore"], groupIds: [] }, "u", roles())).toBe(false);
    expect(await audienceIncludes({ everyone: false, roles: ["isCore"], groupIds: [] }, "u", roles({ isCore: true }))).toBe(true);
    vi.mocked(isUserInAnyGroup).mockResolvedValue(true);
    expect(await audienceIncludes({ everyone: false, roles: [], groupIds: ["g1"] }, "u", roles())).toBe(true);
    expect(isUserInAnyGroup).toHaveBeenCalledWith("u", ["g1"]);
  });

  it("ignores a stored role name that isn't a role", async () => {
    expect(await audienceIncludes({ everyone: false, roles: ["isWizard"], groupIds: [] }, "u", roles())).toBe(false);
  });
});

describe("activeBannersFor", () => {
  it("asks only for published banners inside their window, with this viewer's history", async () => {
    db.banner.findMany.mockResolvedValue([]);
    await activeBannersFor("u1", roles(), NOW);
    expect(db.banner.findMany.mock.calls[0][0]).toMatchObject({
      where: { published: true, startsAt: { lte: NOW }, endsAt: { gt: NOW } },
      include: { impressions: { where: { userId: "u1" } } },
    });
  });

  it("drops banners outside the audience or already used up by frequency", async () => {
    db.banner.findMany.mockResolvedValue([
      row({ id: "fresh" }),
      row({ id: "core-only", roles: ["isCore"] }),
      row({ id: "seen-once", frequency: "Once", impressions: [{ views: 1, lastSeenAt: NOW, snoozedDay: null }] }),
      // Seen at 9 PM ET yesterday: a new lab day, so a daily banner is due again.
      row({ id: "daily", frequency: "Daily", impressions: [{ views: 1, lastSeenAt: new Date("2026-10-24T01:00:00Z"), snoozedDay: null }] }),
      row({ id: "snoozed", impressions: [{ views: 3, lastSeenAt: NOW, snoozedDay: "2026-10-24" }] }),
    ]);
    const out = await activeBannersFor("u1", roles(), NOW);
    expect(out.map((b) => b.id)).toEqual(["fresh", "daily"]);
    expect(out[0]).toMatchObject({ author: "Maya Patel", startsAt: "2026-10-20T00:00:00.000Z" });
  });
});

describe("activeBannersFor with a linked form", () => {
  const form = (over: Record<string, unknown> = {}) => ({
    id: "f1",
    name: "Intake",
    published: true,
    archivedAt: null,
    publicToken: "tok",
    ...over,
  });
  const linked = (over: Record<string, unknown> = {}) => row({ untilFormId: "f1", ...over });

  it("asks the form tables nothing when no banner is linked", async () => {
    db.banner.findMany.mockResolvedValue([row()]);
    await activeBannersFor("u1", roles(), NOW);
    expect(db.form.findMany).not.toHaveBeenCalled();
    expect(db.formSubmission.findMany).not.toHaveBeenCalled();
  });

  it("looks up the forms and this viewer's submissions once for all linked banners", async () => {
    db.banner.findMany.mockResolvedValue([linked({ id: "a" }), linked({ id: "b" }), linked({ id: "c", untilFormId: "f2" })]);
    db.form.findMany.mockResolvedValue([form(), form({ id: "f2" })]);
    await activeBannersFor("u1", roles(), NOW);
    expect(db.form.findMany).toHaveBeenCalledTimes(1);
    expect(db.form.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["f1", "f2"] } });
    expect(db.formSubmission.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", formId: { in: ["f1", "f2"] } },
      select: { formId: true },
      distinct: ["formId"],
    });
  });

  it("does not look up a form for a banner the viewer would not see anyway", async () => {
    db.banner.findMany.mockResolvedValue([linked({ roles: ["isCore"] })]);
    await activeBannersFor("u1", roles(), NOW);
    expect(db.form.findMany).not.toHaveBeenCalled();
  });

  it("hides the banner once the viewer has filled the form", async () => {
    db.banner.findMany.mockResolvedValue([linked()]);
    db.form.findMany.mockResolvedValue([form()]);
    db.formSubmission.findMany.mockResolvedValue([{ formId: "f1" }]);
    expect(await activeBannersFor("u1", roles(), NOW)).toEqual([]);
  });

  it.each([
    ["missing", []],
    ["unpublished", [{ published: false }]],
    ["archived", [{ archivedAt: new Date("2026-10-01T00:00:00Z") }]],
    ["without a link token", [{ publicToken: null }]],
  ])("hides the banner when the form is %s", async (_n, overs) => {
    db.banner.findMany.mockResolvedValue([linked()]);
    db.form.findMany.mockResolvedValue(overs.map((o) => form(o)));
    expect(await activeBannersFor("u1", roles(), NOW)).toEqual([]);
  });

  it("opens the form and labels the button when the author left both empty", async () => {
    db.banner.findMany.mockResolvedValue([linked()]);
    db.form.findMany.mockResolvedValue([form()]);
    const [out] = await activeBannersFor("u1", roles(), NOW);
    expect(out).toMatchObject({ untilFormId: "f1", ctaUrl: "/forms/fill/tok", ctaLabel: "Fill out the form" });
  });

  it("keeps a link and label the author set", async () => {
    db.banner.findMany.mockResolvedValue([linked({ ctaUrl: "/help", ctaLabel: "Read first" })]);
    db.form.findMany.mockResolvedValue([form()]);
    const [out] = await activeBannersFor("u1", roles(), NOW);
    expect(out).toMatchObject({ ctaUrl: "/help", ctaLabel: "Read first" });
  });

  it("fills in only the missing half", async () => {
    db.banner.findMany.mockResolvedValue([linked({ ctaLabel: "Start" })]);
    db.form.findMany.mockResolvedValue([form()]);
    const [out] = await activeBannersFor("u1", roles(), NOW);
    expect(out).toMatchObject({ ctaUrl: "/forms/fill/tok", ctaLabel: "Start" });
  });
});

describe("untilFormError", () => {
  const input = (over: Partial<BannerInput> = {}) =>
    ({ published: true, untilFormId: "f1", ...over }) as BannerInput;

  it("passes drafts, unlinked banners and a good form", async () => {
    expect(await untilFormError(input({ published: false }))).toBeNull();
    expect(await untilFormError(input({ untilFormId: null }))).toBeNull();
    expect(db.form.findUnique).not.toHaveBeenCalled();
    db.form.findUnique.mockResolvedValue({ published: true, archivedAt: null });
    expect(await untilFormError(input())).toBeNull();
    expect(formUsages).toHaveBeenCalledWith("f1");
  });

  it.each([
    ["missing", null],
    ["unpublished", { published: false, archivedAt: null }],
    ["archived", { published: true, archivedAt: new Date() }],
  ])("rejects a form that is %s", async (_n, formRow) => {
    db.form.findUnique.mockResolvedValue(formRow);
    expect(await untilFormError(input())).toBe("Pick a published form");
  });

  it("rejects a form another feature manages", async () => {
    db.form.findUnique.mockResolvedValue({ published: true, archivedAt: null });
    vi.mocked(managingUsage).mockReturnValue({ kind: "staffing", label: "x" });
    expect(await untilFormError(input())).toBe("That form is managed by another feature and can't be linked");
  });
});

describe("recordBannerEvent", () => {
  it("counts a view and stamps when it was seen", async () => {
    await recordBannerEvent("bn1", "u1", "view", NOW);
    expect(db.bannerImpression.upsert).toHaveBeenCalledWith({
      where: { bannerId_userId: { bannerId: "bn1", userId: "u1" } },
      update: { views: { increment: 1 }, lastSeenAt: NOW },
      create: { bannerId: "bn1", userId: "u1", views: 1, clicks: 0, snoozes: 0, lastSeenAt: NOW, snoozedDay: null },
    });
  });

  it("records a snooze against the lab-calendar day", async () => {
    await recordBannerEvent("bn1", "u1", "snooze", new Date("2026-10-25T02:00:00Z"));
    const call = db.bannerImpression.upsert.mock.calls[0][0];
    expect(call.update).toEqual({ snoozes: { increment: 1 }, snoozedDay: "2026-10-24" });
    expect(call.create.snoozedDay).toBe("2026-10-24");
  });

  it("counts a click without touching views", async () => {
    await recordBannerEvent("bn1", "u1", "click", NOW);
    expect(db.bannerImpression.upsert.mock.calls[0][0].update).toEqual({ clicks: { increment: 1 } });
  });
});

describe("createBanner", () => {
  const input: BannerInput = {
    name: "",
    kind: "Image",
    mediaUrl: null,
    videoUrl: null,
    headline: "Open house",
    body: "",
    ctaLabel: "",
    ctaUrl: "",
    tone: "Accent",
    everyone: true,
    roles: ["isCore"],
    groupIds: ["g1"],
    trigger: "AppOpen",
    triggerPath: "/calendar",
    frequency: "Daily",
    allowSnooze: true,
    startsAt: "2026-10-26T13:00:00.000Z",
    endsAt: "2026-11-02T21:00:00.000Z",
    untilFormId: null,
    published: false,
  };

  it("names it from the headline and drops settings that don't apply", async () => {
    db.banner.create.mockResolvedValue({ id: "bn9" });
    expect(await createBanner(input, "core1")).toBe("bn9");
    const data = db.banner.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      name: "Open house",
      // Everyone supersedes roles and groups.
      roles: [],
      groupIds: [],
      // An app-open banner has no page; a daily one has nothing to snooze.
      triggerPath: null,
      allowSnooze: false,
      createdById: "core1",
    });
    expect(data.startsAt).toEqual(new Date("2026-10-26T13:00:00.000Z"));
  });

  it("stores the linked form and never the derived button values", async () => {
    db.banner.create.mockResolvedValue({ id: "bn9" });
    await createBanner({ ...input, untilFormId: "f1" }, "core1");
    const data = db.banner.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ untilFormId: "f1", ctaUrl: "", ctaLabel: "" });
  });
});

describe("listBanners", () => {
  it("totals each banner's views, clicks and snoozes, with zeros for unseen ones", async () => {
    db.banner.findMany.mockResolvedValue([row({ id: "a" }), row({ id: "b" })]);
    db.bannerImpression.groupBy.mockResolvedValue([{ bannerId: "a", _sum: { views: 12, clicks: 3, snoozes: null } }]);
    const out = await listBanners();
    expect(out.map((b) => [b.id, b.stats])).toEqual([
      ["a", { views: 12, clicks: 3, snoozes: 0 }],
      ["b", { views: 0, clicks: 0, snoozes: 0 }],
    ]);
  });

  it("names the form a banner is linked to, beside the banner", async () => {
    db.banner.findMany.mockResolvedValue([
      row({ id: "a", untilFormId: "f1", untilForm: { name: "Intake" } }),
      row({ id: "b", untilForm: null }),
    ]);
    db.bannerImpression.groupBy.mockResolvedValue([]);
    const out = await listBanners();
    expect(out.map((b) => [b.id, b.untilFormName])).toEqual([["a", "Intake"], ["b", null]]);
    expect(out[0]).toHaveProperty("untilFormId", "f1");
  });
});
