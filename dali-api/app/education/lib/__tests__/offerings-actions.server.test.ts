import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => {
  const model = (...names: string[]) => Object.fromEntries(names.map((n) => [n, vi.fn()]));
  return {
    prisma: {
      educationOffering: model("findUnique", "findMany", "create", "update", "delete", "count"),
      educationSession: model("findUnique", "findFirst", "findMany", "create", "createMany", "update", "delete", "deleteMany"),
      educationApplication: model("findMany", "groupBy"),
      educationAssignment: model("findMany"),
      educationSubmission: model("findMany"),
      instructorAssignment: model("deleteMany"),
      $transaction: vi.fn(),
    },
  };
});
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), currentTerm: vi.fn() }));
vi.mock("~/lib/promotion-notify.server", () => ({ notifyAdminsOfPromotion: vi.fn() }));
vi.mock("~/lib/photo", () => ({
  resolvePhotoUrl: vi.fn(async (raw: string | null) => (raw ? `resolved:${raw}` : null)),
}));
vi.mock("~/lib/dartmouth-people", () => ({ peopleByNetId: vi.fn() }));
vi.mock("~/education/lib/access.server", () => ({
  isOfferingManager: vi.fn(),
  manageableOfferingIds: vi.fn(),
}));
vi.mock("~/education/lib/notifications.server", () => ({ notifyExternalInstructorInvite: vi.fn() }));
vi.mock("~/education/lib/application-form.server", () => ({ createOfferingApplicationForm: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { isCore } from "~/lib/roles";
import { isOfferingManager, manageableOfferingIds } from "~/education/lib/access.server";
import { createOfferingApplicationForm } from "~/education/lib/application-form.server";
import {
  runOfferingAction,
  registrationOpen,
  listCatalog,
  listMyApplications,
  listManageable,
  getOfferingDetail,
  getHomeEducationSummary,
} from "~/education/lib/offerings.server";

const p = prisma as any;
const offeringDb = p.educationOffering;
const sessionDb = p.educationSession;
const appDb = p.educationApplication;

function fd(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  }
  return f;
}

beforeEach(() => {
  vi.resetAllMocks();
  p.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as any)(p) : Promise.all(arg as Promise<unknown>[]),
  );
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(isOfferingManager).mockResolvedValue(true);
  sessionDb.findMany.mockResolvedValue([]);
  offeringDb.update.mockResolvedValue({});
});

describe("registrationOpen", () => {
  const o = {
    status: "Published" as const,
    registrationOpensAt: new Date("2026-09-01T00:00:00Z"),
    registrationClosesAt: new Date("2026-09-10T00:00:00Z"),
  };
  it("is open only while Published and inside the window (inclusive)", () => {
    expect(registrationOpen(o, new Date("2026-09-05T00:00:00Z"))).toBe(true);
    expect(registrationOpen(o, o.registrationOpensAt)).toBe(true);
    expect(registrationOpen(o, o.registrationClosesAt)).toBe(true);
    expect(registrationOpen(o, new Date("2026-08-31T23:59:59Z"))).toBe(false);
    expect(registrationOpen(o, new Date("2026-09-10T00:00:01Z"))).toBe(false);
    expect(registrationOpen({ ...o, status: "Draft" }, new Date("2026-09-05T00:00:00Z"))).toBe(false);
    expect(registrationOpen({ ...o, status: "Archived" }, new Date("2026-09-05T00:00:00Z"))).toBe(false);
  });
});

describe("runOfferingAction: create-offering", () => {
  const valid = {
    intent: "create-offering",
    type: "Miniseries",
    title: "  Design Basics ",
    capacity: "12",
    registrationOpensAt: "2026-09-01T09:00",
    registrationClosesAt: "2026-09-10T09:00",
    requiresReview: "true",
    iconEmoji: " 🎨 ",
    completionAmount: "75",
  };

  it("is Core-only", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    expect(await runOfferingAction(fd(valid), "U")).toEqual({ error: "Core only", status: 403 });
    expect(offeringDb.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ type: "Seminar" }, "Invalid type"],
    [{ title: "  " }, "Title is required"],
    [{ capacity: "0" }, "Capacity must be a positive integer"],
    [{ capacity: "2.5" }, "Capacity must be a positive integer"],
    [{ capacity: "abc" }, "Capacity must be a positive integer"],
    [{ registrationOpensAt: "" }, "Registration dates are required"],
    [{ registrationClosesAt: "" }, "Registration dates are required"],
    [
      { registrationOpensAt: "2026-09-10T09:00", registrationClosesAt: "2026-09-10T09:00" },
      "Registration must open before it closes",
    ],
  ])("rejects %o", async (override, error) => {
    expect(await runOfferingAction(fd({ ...valid, ...override }), "U")).toEqual({ error, status: 400 });
    expect(offeringDb.create).not.toHaveBeenCalled();
  });

  it("creates a Draft with the trimmed fields, completion rule, description doc, form and audit", async () => {
    offeringDb.create.mockResolvedValue({ id: "off-9" });
    expect(await runOfferingAction(fd(valid), "U-Ada")).toEqual({ ok: true, id: "off-9" });
    const data = offeringDb.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      type: "Miniseries",
      title: "Design Basics",
      iconEmoji: "🎨",
      capacity: 12,
      requiresReview: true,
      status: "Draft",
      completionThreshold: 0.75,
      completionMinSessions: null,
    });
    expect(data.registrationOpensAt).toBeInstanceOf(Date);
    expect(data.registrationOpensAt < data.registrationClosesAt).toBe(true);
    expect(offeringDb.update).toHaveBeenCalledWith({
      where: { id: "off-9" },
      data: { descriptionDocId: "eduoffering:off-9:description" },
    });
    expect(createOfferingApplicationForm).toHaveBeenCalledWith("off-9", "U-Ada");
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "education.offering.create",
      userId: "U-Ada",
      targetId: "off-9",
      metadata: { title: "Design Basics", type: "Miniseries" },
    });
  });

  it("treats an unchecked review box as auto-approve and ignores completion rules for workshops", async () => {
    offeringDb.create.mockResolvedValue({ id: "off-9" });
    const { requiresReview: _r, ...rest } = valid;
    await runOfferingAction(fd({ ...rest, type: "Workshop", iconEmoji: "" }), "U");
    const data = offeringDb.create.mock.calls[0][0].data;
    expect(data.requiresReview).toBe(false);
    expect(data.iconEmoji).toBeNull();
    expect(data).not.toHaveProperty("completionThreshold");
    expect(data).not.toHaveProperty("completionMinSessions");
  });
});

describe("runOfferingAction: preamble", () => {
  it("requires offeringId", async () => {
    expect(await runOfferingAction(fd({ intent: "update-offering" }), "U")).toEqual({
      error: "offeringId is required",
      status: 400,
    });
  });

  it("404s on an unknown offering", async () => {
    offeringDb.findUnique.mockResolvedValue(null);
    expect(await runOfferingAction(fd({ intent: "update-offering", offeringId: "x" }), "U")).toEqual({
      error: "Offering not found",
      status: 404,
    });
  });

  it("403s non-managers before touching anything", async () => {
    offeringDb.findUnique.mockResolvedValue({ id: "o1", type: "Workshop", status: "Draft", sessions: [] });
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    expect(await runOfferingAction(fd({ intent: "add-session", offeringId: "o1", datetime: "2026-09-01T10:00" }), "U")).toEqual({
      error: "Forbidden",
      status: 403,
    });
    expect(sessionDb.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown intent", async () => {
    offeringDb.findUnique.mockResolvedValue({ id: "o1", type: "Workshop", status: "Draft", sessions: [] });
    expect(await runOfferingAction(fd({ intent: "nope", offeringId: "o1" }), "U")).toEqual({
      error: "Unknown intent",
      status: 400,
    });
  });

  it.each(["duplicate-offering", "delete-offering", "set-instructors", "remove-external-instructor"])(
    "%s needs Core even for an offering manager",
    async (intent) => {
      offeringDb.findUnique.mockResolvedValue({ id: "o1", type: "Workshop", status: "Draft", sessions: [] });
      vi.mocked(isCore).mockResolvedValue(false);
      expect(await runOfferingAction(fd({ intent, offeringId: "o1", userId: "u" }), "U")).toEqual({
        error: "Core only",
        status: 403,
      });
      expect(offeringDb.create).not.toHaveBeenCalled();
      expect(offeringDb.delete).not.toHaveBeenCalled();
      expect(p.instructorAssignment.deleteMany).not.toHaveBeenCalled();
    },
  );
});

describe("runOfferingAction: update-offering", () => {
  const valid = {
    intent: "update-offering",
    offeringId: "o1",
    title: " New title ",
    capacity: "20",
    registrationOpensAt: "2026-09-01T09:00",
    registrationClosesAt: "2026-09-10T09:00",
    calendarEmail: " cal@example.edu ",
    iconEmoji: "",
    completionAmount: "3",
    completionMode: "sessions",
  };
  const load = (type: string) =>
    offeringDb.findUnique.mockResolvedValue({ id: "o1", type, status: "Draft", title: "Old", sessions: [] });

  it.each([
    [{ title: "" }, "Title is required"],
    [{ capacity: "-1" }, "Capacity must be a positive integer"],
    [{ registrationOpensAt: "" }, "Registration dates are required"],
    [
      { registrationOpensAt: "2026-09-11T09:00" },
      "Registration must open before it closes",
    ],
  ])("rejects %o", async (override, error) => {
    load("Miniseries");
    expect(await runOfferingAction(fd({ ...valid, ...override }), "U")).toEqual({ error, status: 400 });
    expect(offeringDb.update).not.toHaveBeenCalled();
  });

  it("writes trimmed fields and a sessions-based completion rule for multi-session types", async () => {
    load("Miniseries");
    expect(await runOfferingAction(fd(valid), "U-Ada")).toEqual({ ok: true, id: "o1" });
    const call = offeringDb.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "o1" });
    expect(call.data).toMatchObject({
      title: "New title",
      capacity: 20,
      iconEmoji: null,
      requiresReview: false,
      calendarEmail: "cal@example.edu",
      completionMinSessions: 3,
    });
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "education.offering.update",
      userId: "U-Ada",
      targetId: "o1",
    });
  });

  it("does not touch the completion rule of a workshop", async () => {
    load("Workshop");
    await runOfferingAction(fd(valid), "U");
    const data = offeringDb.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("completionMinSessions");
    expect(data).not.toHaveProperty("completionThreshold");
  });
});

describe("runOfferingAction: set-status", () => {
  const load = (status: string, extra: Record<string, unknown> = {}) =>
    offeringDb.findUnique.mockResolvedValue({
      id: "o1",
      type: "Workshop",
      title: "T",
      status,
      sessions: [{ id: "s1" }],
      registrationOpensAt: new Date("2026-09-01T00:00:00Z"),
      registrationClosesAt: new Date("2026-09-10T00:00:00Z"),
      ...extra,
    });
  const go = (status: string) =>
    runOfferingAction(fd({ intent: "set-status", offeringId: "o1", status }), "U-Ada");

  it("rejects an unknown status", async () => {
    load("Draft");
    expect(await go("Closed")).toEqual({ error: "Invalid status", status: 400 });
  });

  it.each([
    ["Draft", "Archived"],
    ["Draft", "Draft"],
    ["Published", "Published"],
    ["Archived", "Draft"],
  ])("blocks %s -> %s", async (from, to) => {
    load(from);
    expect(await go(to)).toEqual({ error: `Cannot move from ${from} to ${to}`, status: 400 });
    expect(offeringDb.update).not.toHaveBeenCalled();
  });

  it("will not publish without sessions", async () => {
    load("Draft", { sessions: [] });
    expect(await go("Published")).toEqual({
      error: "Add at least one session before publishing",
      status: 400,
    });
  });

  it("will not publish with an inverted registration window", async () => {
    load("Draft", { registrationClosesAt: new Date("2026-08-01T00:00:00Z") });
    const res = await go("Published");
    expect(res).toEqual({
      error: "Fix before publishing: registration must open before it closes",
      status: 400,
    });
    expect(offeringDb.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "Published" } }),
    );
  });

  it("publishes, refreshing dates first, and audits the transition", async () => {
    load("Draft");
    expect(await go("Published")).toEqual({ ok: true, id: "o1" });
    expect(sessionDb.findMany).toHaveBeenCalled();
    expect(offeringDb.update).toHaveBeenLastCalledWith({ where: { id: "o1" }, data: { status: "Published" } });
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "education.offering.status",
      userId: "U-Ada",
      targetId: "o1",
      metadata: { from: "Draft", to: "Published" },
    });
  });

  it("allows unpublishing and archiving a Published offering, and re-publishing an Archived one", async () => {
    load("Published");
    expect((await go("Draft")).hasOwnProperty("ok")).toBe(true);
    expect((await go("Archived")).hasOwnProperty("ok")).toBe(true);
    load("Archived");
    expect((await go("Published")).hasOwnProperty("ok")).toBe(true);
  });
});

describe("runOfferingAction: delete-offering", () => {
  it("only deletes Drafts", async () => {
    offeringDb.findUnique.mockResolvedValue({ id: "o1", status: "Published", title: "T", sessions: [] });
    expect(await runOfferingAction(fd({ intent: "delete-offering", offeringId: "o1" }), "U")).toEqual({
      error: "Only Draft offerings can be deleted — archive instead",
      status: 400,
    });
    expect(offeringDb.delete).not.toHaveBeenCalled();
  });

  it("removes instructors and sessions with the offering, then audits", async () => {
    offeringDb.findUnique.mockResolvedValue({ id: "o1", status: "Draft", title: "T", sessions: [] });
    expect(await runOfferingAction(fd({ intent: "delete-offering", offeringId: "o1" }), "U-Ada")).toEqual({ ok: true });
    expect(p.instructorAssignment.deleteMany).toHaveBeenCalledWith({ where: { offeringId: "o1" } });
    expect(sessionDb.deleteMany).toHaveBeenCalledWith({ where: { offeringId: "o1" } });
    expect(offeringDb.delete).toHaveBeenCalledWith({ where: { id: "o1" } });
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "education.offering.delete",
      userId: "U-Ada",
      targetId: "o1",
      metadata: { title: "T" },
    });
  });
});

describe("runOfferingAction: sessions", () => {
  beforeEach(() => {
    offeringDb.findUnique.mockResolvedValue({ id: "o1", type: "Miniseries", status: "Draft", title: "T", sessions: [] });
  });
  const run = (fields: Record<string, string | string[]>) =>
    runOfferingAction(fd({ offeringId: "o1", ...fields }), "U-Ada");

  describe("add-session", () => {
    it("requires a start and rejects an end that is not after it", async () => {
      expect(await run({ intent: "add-session" })).toEqual({ error: "Session date/time is required", status: 400 });
      expect(
        await run({ intent: "add-session", datetime: "2026-09-01T10:00", endsAt: "2026-09-01T10:00" }),
      ).toEqual({ error: "Session end must be after its start", status: 400 });
      expect(sessionDb.create).not.toHaveBeenCalled();
    });

    it("appends after the highest sequence, trims text, and recomputes dates", async () => {
      sessionDb.findFirst.mockResolvedValue({ sequence: 4 });
      sessionDb.create.mockResolvedValue({ id: "s9" });
      expect(
        await run({
          intent: "add-session",
          datetime: "2026-09-01T10:00",
          endsAt: "2026-09-01T11:00",
          title: " Kickoff ",
          location: "",
          notes: " bring laptop ",
        }),
      ).toEqual({ ok: true, id: "s9" });
      const data = sessionDb.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ offeringId: "o1", sequence: 5, title: "Kickoff", location: null, notes: "bring laptop" });
      expect(data.endsAt.getTime() - data.datetime.getTime()).toBe(3600_000);
      expect(logAuditEvent).toHaveBeenCalledWith({
        action: "education.session.create",
        userId: "U-Ada",
        targetId: "s9",
        metadata: { offeringId: "o1" },
      });
      expect(sessionDb.findMany).toHaveBeenCalled();
    });

    it("starts at sequence 1 for an empty offering", async () => {
      sessionDb.findFirst.mockResolvedValue(null);
      sessionDb.create.mockResolvedValue({ id: "s1" });
      await run({ intent: "add-session", datetime: "2026-09-01T10:00" });
      expect(sessionDb.create.mock.calls[0][0].data.sequence).toBe(1);
    });
  });

  describe("generate-sessions (weekday mode)", () => {
    beforeEach(() => sessionDb.findFirst.mockResolvedValue({ sequence: 2 }));
    const gen = (over: Record<string, string | string[]> = {}) =>
      run({
        intent: "generate-sessions",
        weekdays: ["1", "3"],
        startDate: "2026-09-02", // a Wednesday
        startTime: "14:00",
        endTime: "15:30",
        weeks: "2",
        ...over,
      });
    const rows = () => sessionDb.createMany.mock.calls[0][0].data as any[];

    it("requires a well-formed start date and time", async () => {
      expect(await gen({ startDate: "9/2/2026" })).toEqual({ error: "Start date is required", status: 400 });
      expect(await gen({ startTime: "2pm" })).toEqual({ error: "Start time is required", status: 400 });
      expect(sessionDb.createMany).not.toHaveBeenCalled();
    });

    it("creates every selected weekday for each week, in order, numbered after the existing sessions", async () => {
      expect(await gen()).toEqual({ ok: true });
      // From Wed Sep 2: Mon Sep 7, Wed Sep 2 (week 0); Mon Sep 14, Wed Sep 9 (week 1). Sorted by date.
      const days = rows().map((r) => r.datetime.toISOString().slice(0, 10));
      expect(days).toEqual(["2026-09-02", "2026-09-07", "2026-09-09", "2026-09-14"]);
      expect(rows().map((r) => r.sequence)).toEqual([3, 4, 5, 6]);
      expect(rows().every((r) => r.offeringId === "o1")).toBe(true);
      expect(rows()[0].endsAt.getTime() - rows()[0].datetime.getTime()).toBe(90 * 60_000);
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { offeringId: "o1", count: 4, weekdays: [1, 3], bulk: true } }),
      );
    });

    it("ignores out-of-range weekdays, de-dupes repeats, and leaves endsAt null without an end time", async () => {
      await gen({ weekdays: ["3", "3", "9", "x"], weeks: "1", endTime: "" });
      expect(rows()).toHaveLength(1);
      expect(rows()[0].endsAt).toBeNull();
    });

    it("clamps weeks to 26", async () => {
      await gen({ weekdays: ["3"], weeks: "100" });
      expect(rows()).toHaveLength(26);
    });

    it("clamps a non-positive or junk week count to 1", async () => {
      await gen({ weekdays: ["3"], weeks: "0" });
      expect(rows()).toHaveLength(1);
    });

    it("caps one batch at 60 sessions", async () => {
      await gen({ weekdays: ["0", "1", "2", "3", "4", "5", "6"], weeks: "26" });
      expect(rows()).toHaveLength(60);
    });
  });

  describe("generate-sessions (interval mode)", () => {
    it("requires a start and clamps count and interval to 30", async () => {
      expect(await run({ intent: "generate-sessions" })).toEqual({
        error: "Start date/time is required",
        status: 400,
      });
      sessionDb.findFirst.mockResolvedValue(null);
      await run({ intent: "generate-sessions", startDatetime: "2026-09-01T10:00", count: "99", intervalDays: "99" });
      const data = sessionDb.createMany.mock.calls[0][0].data as any[];
      expect(data).toHaveLength(30);
      const gap = data[1].datetime.getTime() - data[0].datetime.getTime();
      expect(Math.round(gap / 86_400_000)).toBe(30);
    });
  });

  describe("update-session", () => {
    const upd = (over: Record<string, string> = {}) =>
      run({ intent: "update-session", sessionId: "s1", datetime: "2026-09-01T10:00", ...over });

    it("404s when the session belongs to a different offering", async () => {
      sessionDb.findUnique.mockResolvedValue({ offeringId: "other" });
      expect(await upd()).toEqual({ error: "Session not found", status: 404 });
      sessionDb.findUnique.mockResolvedValue(null);
      expect(await upd()).toEqual({ error: "Session not found", status: 404 });
      expect(sessionDb.update).not.toHaveBeenCalled();
    });

    it("validates start and end", async () => {
      sessionDb.findUnique.mockResolvedValue({ offeringId: "o1" });
      expect(await upd({ datetime: "" })).toEqual({ error: "Session date/time is required", status: 400 });
      expect(await upd({ endsAt: "2026-09-01T09:00" })).toEqual({
        error: "Session end must be after its start",
        status: 400,
      });
    });

    it("saves the edit with blanks as null and recomputes the offering dates", async () => {
      sessionDb.findUnique.mockResolvedValue({ offeringId: "o1" });
      expect(await upd({ title: " ", recordingUrl: " https://zoom.example/rec " })).toEqual({ ok: true, id: "s1" });
      const call = sessionDb.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: "s1" });
      expect(call.data).toMatchObject({
        title: null,
        location: null,
        notes: null,
        endsAt: null,
        recordingUrl: "https://zoom.example/rec",
      });
      expect(sessionDb.findMany).toHaveBeenCalled();
    });
  });

  describe("delete-session", () => {
    const del = () => run({ intent: "delete-session", sessionId: "s1" });

    it("404s for a session in another offering", async () => {
      sessionDb.findUnique.mockResolvedValue({ offeringId: "other", _count: { attendances: 0 } });
      expect(await del()).toEqual({ error: "Session not found", status: 404 });
      expect(sessionDb.delete).not.toHaveBeenCalled();
    });

    it("refuses once attendance has been recorded", async () => {
      sessionDb.findUnique.mockResolvedValue({ offeringId: "o1", _count: { attendances: 3 } });
      expect(await del()).toEqual({
        error: "This session has attendance records and can't be deleted",
        status: 400,
      });
      expect(sessionDb.delete).not.toHaveBeenCalled();
    });

    it("deletes an unattended session, audits, and recomputes dates", async () => {
      sessionDb.findUnique.mockResolvedValue({ offeringId: "o1", _count: { attendances: 0 } });
      expect(await del()).toEqual({ ok: true });
      expect(sessionDb.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
      expect(logAuditEvent).toHaveBeenCalledWith({
        action: "education.session.delete",
        userId: "U-Ada",
        targetId: "s1",
        metadata: { offeringId: "o1" },
      });
      expect(offeringDb.update).toHaveBeenCalledWith({
        where: { id: "o1" },
        data: { startsAt: null, endsAt: null },
      });
    });
  });
});

describe("set-instructors / invite validation not covered elsewhere", () => {
  beforeEach(() => {
    offeringDb.findUnique.mockResolvedValue({ id: "o1", type: "Workshop", status: "Draft", title: "T", sessions: [] });
  });

  it("set-instructors fails when no term is configured", async () => {
    vi.mocked((await import("~/lib/roles")).currentTerm).mockResolvedValue(null as never);
    expect(await runOfferingAction(fd({ intent: "set-instructors", offeringId: "o1", userIds: "u1" }), "U")).toEqual({
      error: "No current term configured",
      status: 500,
    });
    expect(p.instructorAssignment.deleteMany).not.toHaveBeenCalled();
  });

  it("remove-external-instructor requires a userId", async () => {
    expect(await runOfferingAction(fd({ intent: "remove-external-instructor", offeringId: "o1" }), "U")).toEqual({
      error: "userId is required",
      status: 400,
    });
  });
});

describe("reads", () => {
  const instr = (id: string, photo: string | null) => ({
    userId: id,
    user: { firstName: "Grace", lastName: "Hopper", photoUrl: photo },
  });
  const offeringRow = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    type: "Miniseries",
    title: `T-${id}`,
    iconEmoji: null,
    status: "Published",
    capacity: 10,
    requiresReview: true,
    registrationOpensAt: new Date(),
    registrationClosesAt: new Date(),
    startsAt: null,
    endsAt: null,
    closedOutAt: null,
    instructors: [instr("i1", "k1")],
    sessions: [{ id: "s", datetime: new Date() }],
    ...over,
  });

  describe("listCatalog", () => {
    it("shapes offerings with approved counts and resolved instructor photos, for an anonymous caller", async () => {
      offeringDb.findMany.mockResolvedValue([offeringRow("o1"), offeringRow("o2")]);
      appDb.groupBy.mockResolvedValue([{ offeringId: "o1", _count: { _all: 4 } }]);
      const out = await listCatalog();
      expect(offeringDb.findMany.mock.calls[0][0].where).toEqual({ status: "Published" });
      expect(out.map((o) => [o.id, o.approvedCount, o.myStatus, o.openAssignments, o.sessionCount])).toEqual([
        ["o1", 4, null, 0, 1],
        ["o2", 0, null, 0, 1],
      ]);
      expect(out[0].instructors[0]).toEqual({ userId: "i1", name: "Grace Hopper", photoUrl: "resolved:k1" });
      expect(out[0].instructorNames).toEqual(["Grace Hopper"]);
      expect(appDb.findMany).not.toHaveBeenCalled();
    });

    it("counts only unsubmitted, not-yet-due assignments for offerings the user is Approved in", async () => {
      const future = new Date(Date.now() + 86_400_000);
      const past = new Date(Date.now() - 86_400_000);
      offeringDb.findMany.mockResolvedValue([offeringRow("o1"), offeringRow("o2")]);
      appDb.groupBy.mockResolvedValue([]);
      appDb.findMany.mockResolvedValue([
        { offeringId: "o1", status: "Approved" },
        { offeringId: "o2", status: "Waitlisted" },
      ]);
      p.educationAssignment.findMany.mockResolvedValue([
        { id: "a-open", dueAt: future, offeringId: "o1", session: null },
        { id: "a-nodue", dueAt: null, offeringId: null, session: { offeringId: "o1" } },
        { id: "a-past", dueAt: past, offeringId: "o1", session: null },
        { id: "a-done", dueAt: future, offeringId: "o1", session: null },
        { id: "a-orphan", dueAt: future, offeringId: null, session: null },
      ]);
      p.educationSubmission.findMany.mockResolvedValue([{ assignmentId: "a-done" }]);
      const out = await listCatalog("U-Ada");
      expect(out.find((o) => o.id === "o1")).toMatchObject({ myStatus: "Approved", openAssignments: 2 });
      expect(out.find((o) => o.id === "o2")).toMatchObject({ myStatus: "Waitlisted", openAssignments: 0 });
      expect(p.educationAssignment.findMany.mock.calls[0][0].where.OR[0]).toEqual({
        offeringId: { in: ["o1"] },
      });
    });
  });

  describe("listMyApplications", () => {
    it("flattens each application with its offering and certificate id", async () => {
      const submittedAt = new Date("2026-09-01T00:00:00Z");
      appDb.findMany.mockResolvedValue([
        {
          id: "a1",
          status: "Approved",
          submittedAt,
          offering: { id: "o1", title: "T", type: "Workshop", endsAt: null, closedOutAt: null },
          certificate: { id: "c1" },
        },
        {
          id: "a2",
          status: "Rejected",
          submittedAt,
          offering: { id: "o2", title: "U", type: "Miniseries", endsAt: null, closedOutAt: null },
          certificate: null,
        },
      ]);
      const out = await listMyApplications("U-Ada");
      expect(appDb.findMany.mock.calls[0][0].where).toEqual({ applicantUserId: "U-Ada" });
      expect(out.map((a) => [a.id, a.offeringId, a.certificateId])).toEqual([
        ["a1", "o1", "c1"],
        ["a2", "o2", null],
      ]);
    });
  });

  describe("listManageable", () => {
    it("returns nothing for an instructor with no offerings, without querying", async () => {
      vi.mocked(manageableOfferingIds).mockResolvedValue([]);
      expect(await listManageable("U")).toEqual([]);
      expect(offeringDb.findMany).not.toHaveBeenCalled();
    });

    it("Core sees all statuses; an instructor is scoped to their ids; pending counts only Submitted", async () => {
      offeringDb.findMany.mockResolvedValue([offeringRow("o1", { status: "Draft" })]);
      appDb.groupBy.mockImplementation(async (q: any) =>
        q.where.status === "Submitted"
          ? [{ offeringId: "o1", _count: { _all: 3 } }]
          : [{ offeringId: "o1", _count: { _all: 5 } }],
      );
      vi.mocked(manageableOfferingIds).mockResolvedValue("all");
      const out = await listManageable("U");
      expect(offeringDb.findMany.mock.calls[0][0].where).toEqual({});
      expect(out[0]).toMatchObject({ approvedCount: 5, pendingCount: 3 });

      vi.mocked(manageableOfferingIds).mockResolvedValue(["o1"]);
      await listManageable("U");
      expect(offeringDb.findMany.mock.calls[1][0].where).toEqual({ id: { in: ["o1"] } });
    });
  });

  describe("getOfferingDetail", () => {
    it("returns null for an unknown offering", async () => {
      offeringDb.findUnique.mockResolvedValue(null);
      expect(await getOfferingDetail("x")).toBeNull();
    });

    it("adds the approved count and named instructors with resolved photos", async () => {
      offeringDb.findUnique.mockResolvedValue({ ...offeringRow("o1"), sessions: [] });
      appDb.groupBy.mockResolvedValue([{ offeringId: "o1", _count: { _all: 7 } }]);
      const out = await getOfferingDetail("o1");
      expect(out?.approvedCount).toBe(7);
      expect(out?.instructors).toEqual([{ userId: "i1", name: "Grace Hopper", photoUrl: "resolved:k1" }]);
    });
  });

  describe("getHomeEducationSummary", () => {
    it("counts enrolled, pending (Submitted + Waitlisted) and open offerings; skips assignment queries when not enrolled", async () => {
      appDb.findMany.mockResolvedValue([
        { offeringId: "o1", status: "Submitted" },
        { offeringId: "o2", status: "Waitlisted" },
        { offeringId: "o3", status: "Rejected" },
      ]);
      offeringDb.count.mockResolvedValue(6);
      expect(await getHomeEducationSummary("U")).toEqual({
        enrolledCount: 0,
        openOfferings: 6,
        pendingCount: 2,
        openAssignments: 0,
      });
      expect(p.educationAssignment.findMany).not.toHaveBeenCalled();
      expect(appDb.findMany.mock.calls[0][0].where).toEqual({
        applicantUserId: "U",
        offering: { status: "Published" },
      });
    });

    it("subtracts submitted work from future-due assignments in enrolled offerings", async () => {
      appDb.findMany.mockResolvedValue([
        { offeringId: "o1", status: "Approved" },
        { offeringId: "o2", status: "Approved" },
      ]);
      offeringDb.count.mockResolvedValue(0);
      p.educationAssignment.findMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }, { id: "a3" }]);
      p.educationSubmission.findMany.mockResolvedValue([{ assignmentId: "a2" }]);
      const out = await getHomeEducationSummary("U");
      expect(out.enrolledCount).toBe(2);
      expect(out.openAssignments).toBe(2);
      expect(p.educationAssignment.findMany.mock.calls[0][0].where.dueAt).toHaveProperty("gt");
    });
  });
});
