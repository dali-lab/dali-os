import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, gcal, markCalendarChanged } = vi.hoisted(() => ({
  prismaMock: {
    memberClass: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findFirst: vi.fn() },
    term: { findUnique: vi.fn() },
    userCalendarLink: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    courseOffering: { findUnique: vi.fn() },
  },
  gcal: {
    createGoogleCalendarEvent: vi.fn(),
    deleteGoogleCalendarEvent: vi.fn(),
    getOrCreateNamedCalendar: vi.fn(),
    listCalendarsForLink: vi.fn(),
    subscribeCalendarForLink: vi.fn(),
  },
  markCalendarChanged: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({ prisma: prismaMock }));
vi.mock("~/lib/google-calendar", () => gcal);
vi.mock("~/calendar/lib/external-cache.server", () => ({ markCalendarChanged }));

import {
  buildClassDestinations,
  createClass,
  MemberClassError,
  parseDestination,
  refreshClass,
  removeClass,
  toMemberClassDTO,
  updateClass,
} from "~/lib/member-class.server";
import type { CalendarLinkDTO } from "~/calendar/lib/types";

const term = { startDate: new Date("2026-09-14T00:00:00Z"), endDate: new Date("2026-11-20T00:00:00Z") };

const base = {
  userId: "ada",
  termId: "t1",
  title: "COSC 52",
  location: "Kemeny Hall 008",
  periodCode: "10",
  includeXHour: false,
  destination: { kind: "local" } as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.term.findUnique.mockResolvedValue(term);
  prismaMock.userCalendarLink.findFirst.mockResolvedValue({ id: "L1" });
  prismaMock.userCalendarLink.findUnique.mockResolvedValue({ subCalendarIds: ["already"] });
  gcal.createGoogleCalendarEvent.mockImplementation(async () => ({ eventId: `ev${gcal.createGoogleCalendarEvent.mock.calls.length}` }));
  gcal.deleteGoogleCalendarEvent.mockResolvedValue(undefined);
  gcal.subscribeCalendarForLink.mockResolvedValue(undefined);
  gcal.getOrCreateNamedCalendar.mockResolvedValue("classes-cal");
  gcal.listCalendarsForLink.mockResolvedValue([{ id: "ada@example.edu", primary: true }]);
});

describe("parseDestination", () => {
  it("parses every destination kind", () => {
    expect(parseDestination("local")).toEqual({ kind: "local" });
    expect(parseDestination("google:L1:dedicated")).toEqual({ kind: "google-dedicated", linkId: "L1" });
    expect(parseDestination("google:L1:primary")).toEqual({ kind: "google-primary", linkId: "L1" });
    expect(parseDestination("google:L1:cal:c9")).toEqual({ kind: "google-calendar", linkId: "L1", calendarId: "c9" });
  });

  it.each(["", "google", "google::primary", "google:L1", "google:L1:cal", "google:L1:other", "outlook:L1:primary"])(
    "rejects %j",
    (raw) => {
      expect(() => parseDestination(raw)).toThrow(MemberClassError);
      expect(() => parseDestination(raw)).toThrow("Unrecognized class destination");
    },
  );
});

describe("createClass", () => {
  it("stores a Local class with expanded period meetings and no Google calls", async () => {
    await createClass({ ...base, offeringCrn: "12345", subject: "COSC", courseNumber: "52", section: "01" });
    expect(gcal.createGoogleCalendarEvent).not.toHaveBeenCalled();
    const { data } = prismaMock.memberClass.create.mock.calls[0][0];
    expect(data).toMatchObject({
      userId: "ada",
      termId: "t1",
      title: "COSC 52",
      periodCode: "10",
      location: "Kemeny Hall 008",
      offeringCrn: "12345",
      subject: "COSC",
      courseNumber: "52",
      section: "01",
      storage: "Local",
      linkId: null,
      calendarId: null,
      googleEventIds: [],
    });
    expect(data.meetings).toEqual([expect.objectContaining({ kind: "main", days: [1, 3, 5], startMin: 610, endMin: 675 })]);
    expect(markCalendarChanged).toHaveBeenCalledWith("ada");
  });

  it("nulls the section reference when not autofilled", async () => {
    await createClass(base);
    expect(prismaMock.memberClass.create.mock.calls[0][0].data).toMatchObject({
      offeringCrn: null,
      subject: null,
      courseNumber: null,
      section: null,
    });
  });

  it("includes the x-hour meeting only when requested", async () => {
    await createClass({ ...base, includeXHour: true });
    expect(prismaMock.memberClass.create.mock.calls[0][0].data.meetings.map((m: { kind: string }) => m.kind)).toEqual(["main", "xhour"]);
  });

  it("uses custom meetings when there is no period code", async () => {
    const custom = [{ kind: "main" as const, days: [2], startMin: 600, endMin: 660 }];
    await createClass({ ...base, periodCode: null, customMeetings: custom });
    expect(prismaMock.memberClass.create.mock.calls[0][0].data.meetings).toEqual(custom);
  });

  it("rejects a class with no meeting times before touching the db or Google", async () => {
    await expect(createClass({ ...base, periodCode: "nope" })).rejects.toThrow("This class has no meeting times.");
    await expect(createClass({ ...base, periodCode: null })).rejects.toThrow("This class has no meeting times.");
    expect(prismaMock.memberClass.create).not.toHaveBeenCalled();
    expect(markCalendarChanged).not.toHaveBeenCalled();
  });

  it("rejects an unknown term", async () => {
    prismaMock.term.findUnique.mockResolvedValue(null);
    await expect(createClass(base)).rejects.toThrow("Term not found");
    expect(prismaMock.memberClass.create).not.toHaveBeenCalled();
  });

  it("only writes to a Google link owned by the member", async () => {
    prismaMock.userCalendarLink.findFirst.mockResolvedValue(null);
    await expect(
      createClass({ ...base, destination: { kind: "google-primary", linkId: "someone-elses" } }),
    ).rejects.toThrow("That calendar isn't connected to your account.");
    expect(prismaMock.userCalendarLink.findFirst).toHaveBeenCalledWith({
      where: { id: "someone-elses", userId: "ada", provider: "Google" },
      select: { id: true },
    });
    expect(gcal.createGoogleCalendarEvent).not.toHaveBeenCalled();
    expect(prismaMock.memberClass.create).not.toHaveBeenCalled();
  });

  it("creates a recurring Google event per meeting on the dedicated calendar and records the ids", async () => {
    await createClass({
      ...base,
      includeXHour: true,
      destination: { kind: "google-dedicated", linkId: "L1" },
    });
    expect(gcal.getOrCreateNamedCalendar).toHaveBeenCalledWith("L1", "Classes");
    expect(gcal.createGoogleCalendarEvent).toHaveBeenCalledTimes(2);
    const [main, x] = gcal.createGoogleCalendarEvent.mock.calls.map((c) => c[0]);
    expect(main).toMatchObject({
      linkId: "L1",
      calendarId: "classes-cal",
      summary: "COSC 52",
      location: "Kemeny Hall 008",
      timeZone: "America/New_York",
      attendees: [],
    });
    expect(main.recurrenceRule).toMatch(/^FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=/);
    expect(x.summary).toBe("COSC 52 (x-hour)");
    expect(x.recurrenceRule).toMatch(/BYDAY=TH/);
    expect(prismaMock.memberClass.create.mock.calls[0][0].data).toMatchObject({
      storage: "Google",
      linkId: "L1",
      calendarId: "classes-cal",
      googleEventIds: ["ev1", "ev2"],
    });
  });

  it("passes an undefined location to Google when the class has none", async () => {
    await createClass({ ...base, location: null, destination: { kind: "google-calendar", linkId: "L1", calendarId: "c9" } });
    expect(gcal.createGoogleCalendarEvent.mock.calls[0][0].location).toBeUndefined();
    expect(gcal.createGoogleCalendarEvent.mock.calls[0][0].calendarId).toBe("c9");
  });

  it("resolves the real primary calendar id, falling back to 'primary' if listing fails", async () => {
    await createClass({ ...base, destination: { kind: "google-primary", linkId: "L1" } });
    expect(prismaMock.memberClass.create.mock.calls[0][0].data.calendarId).toBe("ada@example.edu");

    gcal.listCalendarsForLink.mockRejectedValue(new Error("boom"));
    await createClass({ ...base, destination: { kind: "google-primary", linkId: "L1" } });
    expect(prismaMock.memberClass.create.mock.calls[1][0].data.calendarId).toBe("primary");
  });

  describe("making the calendar visible in DALI", () => {
    const dest = { kind: "google-calendar", linkId: "L1", calendarId: "c9" } as const;

    it("subscribes and adds the calendar to subCalendarIds", async () => {
      await createClass({ ...base, destination: dest });
      expect(gcal.subscribeCalendarForLink).toHaveBeenCalledWith("L1", "c9");
      expect(prismaMock.userCalendarLink.update).toHaveBeenCalledWith({
        where: { id: "L1" },
        data: { subCalendarIds: ["already", "c9"] },
      });
    });

    it("seeds the real primary first when the set was empty so it stays visible", async () => {
      prismaMock.userCalendarLink.findUnique.mockResolvedValue({ subCalendarIds: [] });
      await createClass({ ...base, destination: dest });
      expect(prismaMock.userCalendarLink.update.mock.calls[0][0].data.subCalendarIds).toEqual(["ada@example.edu", "c9"]);
    });

    it("does not rewrite when already present, and tolerates a subscribe failure", async () => {
      prismaMock.userCalendarLink.findUnique.mockResolvedValue({ subCalendarIds: ["c9"] });
      gcal.subscribeCalendarForLink.mockRejectedValue(new Error("already subscribed"));
      await createClass({ ...base, destination: dest });
      expect(prismaMock.userCalendarLink.update).not.toHaveBeenCalled();
      expect(prismaMock.memberClass.create).toHaveBeenCalled();
    });
  });
});

describe("updateClass", () => {
  const googleRow = {
    id: "c1",
    userId: "ada",
    storage: "Google",
    linkId: "L1",
    calendarId: "classes-cal",
    googleEventIds: ["old1", "old2"],
  };

  it("only finds the class when it belongs to the acting user", async () => {
    prismaMock.memberClass.findFirst.mockResolvedValue(null);
    await expect(updateClass("c1", { ...base, userId: "grace" })).rejects.toThrow("Class not found");
    expect(prismaMock.memberClass.findFirst).toHaveBeenCalledWith({ where: { id: "c1", userId: "grace" } });
    expect(prismaMock.memberClass.update).not.toHaveBeenCalled();
    expect(gcal.deleteGoogleCalendarEvent).not.toHaveBeenCalled();
  });

  it("tears down old Google events (best-effort) then rewrites the row", async () => {
    prismaMock.memberClass.findFirst.mockResolvedValue(googleRow);
    gcal.deleteGoogleCalendarEvent.mockRejectedValueOnce(new Error("gone"));
    await updateClass("c1", { ...base, title: "COSC 52 renamed" });
    expect(gcal.deleteGoogleCalendarEvent.mock.calls.map((c) => c[0])).toEqual([
      { linkId: "L1", calendarId: "classes-cal", eventId: "old1" },
      { linkId: "L1", calendarId: "classes-cal", eventId: "old2" },
    ]);
    expect(prismaMock.memberClass.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: expect.objectContaining({ title: "COSC 52 renamed", storage: "Local", linkId: null, calendarId: null, googleEventIds: [] }),
    });
    expect(markCalendarChanged).toHaveBeenCalledWith("ada");
  });

  it("does not delete anything for a Local row", async () => {
    prismaMock.memberClass.findFirst.mockResolvedValue({ ...googleRow, storage: "Local", linkId: null, googleEventIds: [] });
    await updateClass("c1", base);
    expect(gcal.deleteGoogleCalendarEvent).not.toHaveBeenCalled();
  });

  it("validates meetings before tearing down Google events", async () => {
    prismaMock.memberClass.findFirst.mockResolvedValue(googleRow);
    await expect(updateClass("c1", { ...base, periodCode: "nope" })).rejects.toThrow("no meeting times");
    expect(gcal.deleteGoogleCalendarEvent).not.toHaveBeenCalled();
  });
});

describe("removeClass", () => {
  it("rejects a class the user does not own", async () => {
    prismaMock.memberClass.findFirst.mockResolvedValue(null);
    await expect(removeClass("grace", "c1")).rejects.toThrow("Class not found");
    expect(prismaMock.memberClass.findFirst).toHaveBeenCalledWith({ where: { id: "c1", userId: "grace" } });
    expect(prismaMock.memberClass.delete).not.toHaveBeenCalled();
  });

  it("deletes Google events then the row, and marks the calendar changed", async () => {
    prismaMock.memberClass.findFirst.mockResolvedValue({
      storage: "Google", linkId: "L1", calendarId: null, googleEventIds: ["e1"],
    });
    await removeClass("ada", "c1");
    expect(gcal.deleteGoogleCalendarEvent).toHaveBeenCalledWith({ linkId: "L1", calendarId: undefined, eventId: "e1" });
    expect(prismaMock.memberClass.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(markCalendarChanged).toHaveBeenCalledWith("ada");
  });

  it("still deletes the row when Google deletion fails", async () => {
    prismaMock.memberClass.findFirst.mockResolvedValue({
      storage: "Google", linkId: "L1", calendarId: "c", googleEventIds: ["e1"],
    });
    gcal.deleteGoogleCalendarEvent.mockRejectedValue(new Error("403"));
    await removeClass("ada", "c1");
    expect(prismaMock.memberClass.delete).toHaveBeenCalled();
  });
});

describe("refreshClass", () => {
  const row = {
    id: "c1",
    userId: "ada",
    termId: "t1",
    title: "COSC 52",
    periodCode: "10",
    meetings: [{ kind: "main", days: [1, 3, 5], startMin: 610, endMin: 675 }],
    storage: "Local",
    linkId: null,
    calendarId: null,
    googleEventIds: [],
    offeringCrn: "12345",
  };

  it("rejects a class the user does not own", async () => {
    prismaMock.memberClass.findFirst.mockResolvedValue(null);
    await expect(refreshClass("grace", "c1")).rejects.toThrow("Class not found");
  });

  it("rejects a class that was not added from the timetable", async () => {
    prismaMock.memberClass.findFirst.mockResolvedValue({ ...row, offeringCrn: null });
    await expect(refreshClass("ada", "c1")).rejects.toThrow("This class wasn't added from the timetable.");
  });

  it("rejects when the section left the timetable", async () => {
    prismaMock.memberClass.findFirst.mockResolvedValue(row);
    prismaMock.courseOffering.findUnique.mockResolvedValue(null);
    await expect(refreshClass("ada", "c1")).rejects.toThrow("This section is no longer in the timetable.");
    expect(prismaMock.courseOffering.findUnique).toHaveBeenCalledWith({
      where: { termId_crn: { termId: "t1", crn: "12345" } },
    });
  });

  it("re-applies the fresh period and location, keeping title and the x-hour choice", async () => {
    prismaMock.memberClass.findFirst.mockResolvedValue({
      ...row,
      meetings: [
        { kind: "main", days: [1, 3, 5], startMin: 610, endMin: 675 },
        { kind: "xhour", days: [4], startMin: 735, endMin: 785 },
      ],
    });
    prismaMock.courseOffering.findUnique.mockResolvedValue({
      periodCode: "2", building: "Carson", room: " L01 ", subject: "COSC", number: "52", section: "02",
    });
    await refreshClass("ada", "c1");
    const { data } = prismaMock.memberClass.update.mock.calls[0][0];
    expect(data).toMatchObject({
      title: "COSC 52",
      periodCode: "2",
      location: "Carson L01",
      offeringCrn: "12345",
      subject: "COSC",
      courseNumber: "52",
      section: "02",
      storage: "Local",
    });
    expect(data.meetings.map((m: { kind: string }) => m.kind)).toEqual(["main", "xhour"]);
    expect(data.meetings[0].startMin).toBe(14 * 60 + 10);
  });

  it("keeps the current period when the fresh code can't be expanded, and nulls an empty location", async () => {
    prismaMock.memberClass.findFirst.mockResolvedValue(row);
    prismaMock.courseOffering.findUnique.mockResolvedValue({
      periodCode: "ARR", building: null, room: null, subject: "COSC", number: "52", section: "01",
    });
    await refreshClass("ada", "c1");
    const { data } = prismaMock.memberClass.update.mock.calls[0][0];
    expect(data.periodCode).toBe("10");
    expect(data.location).toBeNull();
  });

  it("keeps custom meetings for a custom class whose period isn't expandable", async () => {
    const custom = [{ kind: "main", days: [2], startMin: 600, endMin: 660 }];
    prismaMock.memberClass.findFirst.mockResolvedValue({ ...row, periodCode: null, meetings: custom });
    prismaMock.courseOffering.findUnique.mockResolvedValue({
      periodCode: null, building: "Carson", room: "1", subject: "S", number: "1", section: "1",
    });
    await refreshClass("ada", "c1");
    const { data } = prismaMock.memberClass.update.mock.calls[0][0];
    expect(data.periodCode).toBeNull();
    expect(data.meetings).toEqual(custom);
  });

  it("re-creates Google events on the saved calendar", async () => {
    prismaMock.memberClass.findFirst.mockResolvedValue({
      ...row, storage: "Google", linkId: "L1", calendarId: "classes-cal", googleEventIds: ["old"],
    });
    prismaMock.courseOffering.findUnique.mockResolvedValue({
      periodCode: "10", building: "Carson", room: "1", subject: "COSC", number: "52", section: "01",
    });
    await refreshClass("ada", "c1");
    expect(gcal.deleteGoogleCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: "old" }));
    expect(gcal.createGoogleCalendarEvent.mock.calls[0][0]).toMatchObject({ linkId: "L1", calendarId: "classes-cal" });
  });

  it("falls back to 'primary' for a Google row without a stored calendar id", async () => {
    prismaMock.memberClass.findFirst.mockResolvedValue({
      ...row, storage: "Google", linkId: "L1", calendarId: null, googleEventIds: [],
    });
    prismaMock.courseOffering.findUnique.mockResolvedValue({
      periodCode: "10", building: null, room: null, subject: "COSC", number: "52", section: "01",
    });
    await refreshClass("ada", "c1");
    expect(gcal.createGoogleCalendarEvent.mock.calls[0][0].calendarId).toBe("primary");
  });
});

describe("toMemberClassDTO", () => {
  const link = {
    id: "L1",
    provider: "Google",
    displayName: "Ada L",
    externalEmail: "ada@example.edu",
    subCalendars: [{ id: "c9", summary: "School", primary: false }],
  } as unknown as CalendarLinkDTO;
  const row = {
    id: "c1", title: "T", periodCode: "10", meetings: null, location: null, storage: "Google",
    linkId: "L1", calendarId: "c9", termId: "t1", offeringCrn: null, subject: null, courseNumber: null, section: null,
  };

  it("labels Local classes as DALI only and coerces unknown storage to Local", () => {
    const dto = toMemberClassDTO({ ...row, storage: "Local", linkId: null, calendarId: null }, [link]);
    expect(dto.destinationLabel).toBe("In DALI only");
    expect(toMemberClassDTO({ ...row, storage: "weird" }, [link]).storage).toBe("Local");
  });

  it("labels Google classes by account and sub-calendar, with Primary and fallbacks", () => {
    expect(toMemberClassDTO(row, [link]).destinationLabel).toBe("Ada L · School");
    expect(toMemberClassDTO({ ...row, calendarId: "primary" }, [link]).destinationLabel).toBe("Ada L · Primary");
    expect(toMemberClassDTO({ ...row, calendarId: null }, [link]).destinationLabel).toBe("Ada L · Primary");
    expect(toMemberClassDTO({ ...row, calendarId: "unlisted" }, [link]).destinationLabel).toBe("Ada L · Classes");
    expect(toMemberClassDTO(row, [{ ...link, displayName: null } as unknown as CalendarLinkDTO]).destinationLabel).toBe("ada@example.edu · School");
    expect(toMemberClassDTO(row, []).destinationLabel).toBe("Google · Classes");
  });

  it("defaults null meetings to an empty list", () => {
    expect(toMemberClassDTO(row, [link]).meetings).toEqual([]);
  });
});

describe("buildClassDestinations", () => {
  it("offers a dedicated calendar plus each sub-calendar, labelling the primary", () => {
    const links = [
      {
        id: "L1", provider: "Google", displayName: "Ada L", externalEmail: "ada@example.edu",
        subCalendars: [
          { id: "p", summary: "ada@example.edu", primary: true },
          { id: "s", summary: "School", primary: false },
        ],
      },
    ] as unknown as CalendarLinkDTO[];
    expect(buildClassDestinations(links)).toEqual([
      { kind: "google-dedicated", linkId: "L1", label: "Ada L · Classes calendar" },
      { kind: "google-calendar", linkId: "L1", calendarId: "p", label: "Ada L · Primary" },
      { kind: "google-calendar", linkId: "L1", calendarId: "s", label: "Ada L · School" },
    ]);
  });

  it("falls back to a primary option when sub-calendars are unknown, skips non-Google, and has no local option", () => {
    const links = [
      { id: "L1", provider: "Google", displayName: null, externalEmail: "ada@example.edu", subCalendars: [] },
      { id: "L2", provider: "Microsoft", displayName: "X", externalEmail: "x@example.edu" },
    ] as unknown as CalendarLinkDTO[];
    const out = buildClassDestinations(links);
    expect(out).toEqual([
      { kind: "google-dedicated", linkId: "L1", label: "ada@example.edu · Classes calendar" },
      { kind: "google-primary", linkId: "L1", label: "ada@example.edu · Primary" },
    ]);
    expect(buildClassDestinations([])).toEqual([]);
  });
});
