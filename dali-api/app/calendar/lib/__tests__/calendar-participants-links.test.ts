import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: () => new Response("forbidden", { status: 403 }),
  redirectNonMemberToPortal: vi.fn(),
  isImpersonating: vi.fn(),
}));
vi.mock("~/lib/roles", () => ({
  isLabMember: vi.fn(),
  canViewForms: vi.fn(),
  isCore: vi.fn(),
  currentTerm: vi.fn(),
  currentTermMemberWhere: vi.fn(),
  getUserRoleInstances: vi.fn(),
  resolveRoleRef: vi.fn(),
}));
vi.mock("~/calendar/lib/external-cache.server", () => ({
  cachedExternalRead: vi.fn(),
  invalidateExternalCache: vi.fn(),
  markCalendarChanged: vi.fn(async () => {}),
}));
vi.mock("~/calendar/lib/sub-calendar.server", () => ({ setSubCalendarEnabled: vi.fn() }));
vi.mock("~/lib/groups", () => ({ listAllGroups: vi.fn() }));
vi.mock("~/mentorship/lib/pair-suggestion.server", () => ({ listMentorPairs: vi.fn() }));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn() }));
vi.mock("~/lib/member-class.server", () => {
  class MemberClassError extends Error {}
  return {
    createClass: vi.fn(),
    updateClass: vi.fn(),
    removeClass: vi.fn(),
    refreshClass: vi.fn(),
    parseDestination: vi.fn((raw: string) => ({ parsed: raw })),
    toMemberClassDTO: vi.fn(),
    buildClassDestinations: vi.fn(),
    MemberClassError,
  };
});
vi.mock("~/calendar/lib/time-entries.server", () => ({
  addTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn(),
  updateTimeEntry: vi.fn(),
  timeEntryResult: vi.fn(),
}));
vi.mock("~/calendar/lib/timesheet-mirror.server", () => ({
  setUserTimesheetSync: vi.fn(),
  removeTimeEntryFromGoogle: vi.fn(),
}));
vi.mock("~/calendar/lib/google-calendar.server", () => ({
  fetchCalendarEvents: vi.fn(),
  createGoogleCalendarEvent: vi.fn(),
  patchGoogleCalendarEvent: vi.fn(),
  deleteGoogleCalendarEvent: vi.fn(),
  getGoogleEvent: vi.fn(),
  createCalendar: vi.fn(),
  patchCalendar: vi.fn(),
  deleteCalendar: vi.fn(),
  getValidAccessTokenForLink: vi.fn(),
  listCalendarsForLink: vi.fn(),
  subscribeCalendarForLink: vi.fn(),
  respondToGoogleEventAsSelf: vi.fn(),
  NotAGuestError: class NotAGuestError extends Error {},
}));
vi.mock("~/calendar/lib/general-calendar", () => ({
  generalCalendarId: vi.fn(),
  isGeneralCalendarEvent: vi.fn(),
  generalCalendarState: vi.fn(),
}));
vi.mock("~/lib/notify-stream.server", () => ({ publishNotificationChange: vi.fn() }));
vi.mock("~/calendar/lib/scheduled-meeting.server", () => ({
  attachMeetingNote: vi.fn(),
  attachMeetingWhiteboard: vi.fn(),
  cancelScheduledMeeting: vi.fn(),
  setMeetingProject: vi.fn(),
  trackExternalEventAsMeeting: vi.fn(),
  updateScheduledMeeting: vi.fn(),
}));
vi.mock("~/calendar/lib/meeting-roster.server", () => ({
  resolveMeetingOccurrence: vi.fn(),
}));
vi.mock("~/calendar/lib/meeting-occurrences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/calendar/lib/meeting-occurrences")>()),
  ownsGoogleEvent: vi.fn(),
  parseOccurrenceParam: vi.fn((v: unknown) => (v ? { parsed: v } : undefined)),
}));
vi.mock("~/lib/note-path.server", () => ({ meetingNotePath: vi.fn() }));
vi.mock("~/rooms/lib/rooms.server", () => ({
  bookRoomsForEvent: vi.fn(),
  claimEventRoomBookings: vi.fn(),
  releaseEventRoomBookings: vi.fn(),
  releaseRoomBookings: vi.fn(),
  retimeEventRoomBookings: vi.fn(),
  truncateEventRoomBookings: vi.fn(),
}));
vi.mock("~/calendar/lib/meeting-link.server", () => ({ meetingLinkRedirect: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { currentTermMemberWhere } from "~/lib/roles";
import { listAllGroups } from "~/lib/groups";
import { listMentorPairs } from "~/mentorship/lib/pair-suggestion.server";
import { buildCalendarLinkDTO, loadParticipantOptions } from "~/calendar/lib/calendar-participants.server";

const findUsers = vi.mocked(prisma.user.findMany);

const link = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  provider: "Google" as const,
  externalEmail: "ada@example.edu",
  displayName: "Ada",
  enabled: true,
  primary: true,
  syncError: null,
  subCalendarIds: [] as string[],
  ...over,
});
const cal = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  summary: id,
  primary: false,
  accessRole: "reader",
  backgroundColor: "#fff",
  ...over,
});

describe("buildCalendarLinkDTO", () => {
  it("has no sub-calendars for a non-Google provider", async () => {
    const dto = await buildCalendarLinkDTO(link({ provider: "Outlook" }), new Map(), null);

    expect(dto.subCalendars).toBeNull();
    expect(dto.externalEmail).toBe("ada@example.edu");
  });

  it("has no sub-calendars when the calendar list could not be fetched", async () => {
    const dto = await buildCalendarLinkDTO(link(), new Map([["l1", undefined]]), null);

    expect(dto.subCalendars).toBeNull();
  });

  it("enables only the primary calendar when none are explicitly selected", async () => {
    const items = [cal("main", { primary: true, accessRole: "owner" }), cal("other")];

    const dto = await buildCalendarLinkDTO(link(), new Map([["l1", items as never]]), null);

    expect(dto.subCalendars!.map((c) => [c.id, c.enabled])).toEqual([
      ["main", true],
      ["other", false],
    ]);
  });

  it("enables exactly the selected calendars once any are selected, even if the primary is not among them", async () => {
    const items = [cal("main", { primary: true }), cal("other")];

    const dto = await buildCalendarLinkDTO(link({ subCalendarIds: ["other"] }), new Map([["l1", items as never]]), null);

    expect(dto.subCalendars!.map((c) => [c.id, c.enabled])).toEqual([
      ["main", false],
      ["other", true],
    ]);
  });

  it("marks only owner and writer calendars writable, and carries colour and primary", async () => {
    const items = [
      cal("o", { accessRole: "owner", primary: true }),
      cal("w", { accessRole: "writer" }),
      cal("r", { accessRole: "reader", backgroundColor: undefined }),
      cal("f", { accessRole: "freeBusyReader" }),
    ];

    const dto = await buildCalendarLinkDTO(link(), new Map([["l1", items as never]]), null);

    expect(dto.subCalendars!.map((c) => [c.id, c.writable])).toEqual([
      ["o", true],
      ["w", true],
      ["r", false],
      ["f", false],
    ]);
    expect(dto.subCalendars![0]).toMatchObject({ primary: true, color: "#fff" });
    expect(dto.subCalendars![2]!.color).toBeNull();
  });

  it("hides the timesheet mirror calendar even when it was auto-subscribed", async () => {
    const items = [cal("main", { primary: true }), cal("mirror")];

    const dto = await buildCalendarLinkDTO(link({ subCalendarIds: ["mirror", "main"] }), new Map([["l1", items as never]]), "mirror");

    expect(dto.subCalendars!.map((c) => c.id)).toEqual(["main"]);
  });
});

describe("loadParticipantOptions", () => {
  const req = new Request("http://localhost/x");
  const group = (over: Record<string, unknown>) => ({
    id: "g",
    name: "G",
    memberIds: [] as string[],
    archived: false,
    dynamicQuery: null,
    systemKey: null,
    ...over,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(currentTermMemberWhere).mockResolvedValue({ term: "t1" } as never);
    vi.mocked(listMentorPairs).mockResolvedValue([] as never);
    vi.mocked(listAllGroups).mockResolvedValue([] as never);
    findUsers.mockResolvedValue([]);
  });

  it("lists current members alphabetically using the term's member filter", async () => {
    findUsers.mockResolvedValue([{ id: "u1" }] as never);

    const r = await loadParticipantOptions(req, "viewer");

    expect(r.users).toEqual([{ id: "u1" }]);
    expect(findUsers).toHaveBeenCalledWith({
      where: { term: "t1" },
      select: { id: true, firstName: true, lastName: true, daliEmail: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
    expect(listMentorPairs).toHaveBeenCalledWith("viewer", req);
  });

  it("drops archived groups and exposes a project-backed group's project and system key", async () => {
    vi.mocked(listAllGroups).mockResolvedValue([
      group({ id: "a", archived: true }),
      group({ id: "b", dynamicQuery: "project:p7", systemKey: "core" }),
      group({ id: "c", dynamicQuery: "role:core" }),
    ] as never);

    const r = await loadParticipantOptions(req, "viewer");

    expect(r.groups).toEqual([
      { id: "b", name: "G", memberIds: [], projectId: "p7", systemKey: "core" },
      { id: "c", name: "G", memberIds: [], projectId: null, systemKey: null },
    ]);
  });

  it("fetches names only for group members outside the current-term set, once each", async () => {
    findUsers.mockResolvedValueOnce([{ id: "u1" }] as never);
    findUsers.mockResolvedValueOnce([{ id: "alum" }] as never);
    vi.mocked(listAllGroups).mockResolvedValue([
      group({ id: "a", memberIds: ["u1", "alum"] }),
      group({ id: "b", memberIds: ["alum"] }),
    ] as never);

    const r = await loadParticipantOptions(req, "viewer");

    expect(findUsers).toHaveBeenLastCalledWith({
      where: { id: { in: ["alum"] } },
      select: { id: true, firstName: true, lastName: true, daliEmail: true },
    });
    expect(r.users).toEqual([{ id: "u1" }, { id: "alum" }]);
  });

  it("skips the extra lookup when every group member is already listed", async () => {
    findUsers.mockResolvedValue([{ id: "u1" }] as never);
    vi.mocked(listAllGroups).mockResolvedValue([group({ memberIds: ["u1"] })] as never);

    await loadParticipantOptions(req, "viewer");

    expect(findUsers).toHaveBeenCalledTimes(1);
  });
});
