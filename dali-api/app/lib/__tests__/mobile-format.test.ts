import { describe, it, expect } from "vitest";
import {
  assignmentTypeLabel,
  boardCounts,
  entryDayKey,
  checkInLocation,
  displayName,
  githubRef,
  googleRsvp,
  inviteForOccurrence,
  inviteRsvp,
  leadLabels,
  memberRoles,
  memberTerm,
  memberTitle,
  mobilePresence,
  orderedEmails,
  parseCalendarRange,
  parseStatusBody,
  passAccessLevel,
  passDisplayId,
  sprintNumberFromLabel,
  todayKey,
  utcDayKey,
  MAX_CALENDAR_RANGE_DAYS,
  type MemberTermFacts,
} from "../mobile-format";

const facts = (over: Partial<MemberTermFacts> = {}): MemberTermFacts => ({
  isStaff: false,
  isCore: false,
  coreLeadTitle: null,
  domainLeadOf: [],
  projectDomains: [],
  currentTermCode: "26F",
  activeThisTerm: false,
  ...over,
});

describe("mobilePresence", () => {
  it("maps server presence to the app's three states", () => {
    expect(mobilePresence("active", false)).toBe("active");
    expect(mobilePresence("recent", false)).toBe("away");
    expect(mobilePresence("away", false)).toBe("offline");
  });

  it("shows a member who set themselves away as away, never active", () => {
    expect(mobilePresence("active", true)).toBe("away");
    expect(mobilePresence("recent", true)).toBe("away");
  });

  it("keeps a manually-away member who has gone quiet as offline", () => {
    expect(mobilePresence("away", true)).toBe("offline");
  });
});

describe("parseStatusBody", () => {
  it("accepts active and away", () => {
    expect(parseStatusBody({ status: "active" })).toBe("active");
    expect(parseStatusBody({ status: "away" })).toBe("away");
  });

  it("rejects anything else", () => {
    expect(parseStatusBody({ status: "offline" })).toBeNull();
    expect(parseStatusBody({})).toBeNull();
    expect(parseStatusBody(null)).toBeNull();
    expect(parseStatusBody("away")).toBeNull();
  });
});

describe("displayName", () => {
  it("joins first and last name", () => {
    expect(displayName("Sophie", "Park")).toBe("Sophie Park");
  });

  it("drops a blank half", () => {
    expect(displayName("Sophie", null)).toBe("Sophie");
    expect(displayName("  ", "Park")).toBe("Park");
  });

  it("falls back when both are missing", () => {
    expect(displayName(null, null)).toBe("Member");
  });
});

describe("member term facts", () => {
  it("titles a project member by their domain and lead role", () => {
    const f = facts({ projectDomains: ["Fullstack Dev"], coreLeadTitle: "Delivery Lead", isCore: true, activeThisTerm: true });
    expect(memberTitle(f)).toBe("Fullstack Dev · Delivery Lead");
    expect(memberRoles(f)).toEqual(["Core", "Fullstack Dev"]);
    expect(memberTerm(f)).toBe("26F");
  });

  it("labels domain leads by domain", () => {
    const f = facts({ domainLeadOf: ["UI/UX Design"] });
    expect(leadLabels(f)).toEqual(["UI/UX Design Lead"]);
    expect(memberTitle(f)).toBe("UI/UX Design Lead");
  });

  it("puts the core lead title before domain lead labels and de-duplicates", () => {
    expect(leadLabels(facts({ coreLeadTitle: "Delivery Lead", domainLeadOf: ["Data Dev", "Data Dev"] }))).toEqual([
      "Delivery Lead",
      "Data Dev Lead",
    ]);
  });

  it("titles staff without a project as Staff and gives them the Staff term", () => {
    const f = facts({ isStaff: true, isCore: true });
    expect(memberTitle(f)).toBe("Staff");
    expect(memberTerm(f)).toBe("Staff");
    expect(memberRoles(f)).toEqual(["Core", "Staff"]);
  });

  it("titles core without a project as Core", () => {
    expect(memberTitle(facts({ isCore: true }))).toBe("Core");
  });

  it("gives an inactive member no term and no title", () => {
    expect(memberTerm(facts())).toBe("");
    expect(memberTitle(facts())).toBe("");
  });

  it("gives no term when there is no current term", () => {
    expect(memberTerm(facts({ activeThisTerm: true, currentTermCode: null }))).toBe("");
  });

  it("de-duplicates roles across project domains", () => {
    expect(memberRoles(facts({ projectDomains: ["Data Dev", "Data Dev"] }))).toEqual(["Data Dev"]);
  });
});

describe("orderedEmails", () => {
  it("orders dali, dartmouth, personal and drops blanks", () => {
    expect(
      orderedEmails({ daliEmail: "a@dali.dartmouth.edu", dartmouthEmail: null, personalEmail: "a@gmail.com" }),
    ).toEqual(["a@dali.dartmouth.edu", "a@gmail.com"]);
  });

  it("de-duplicates case-insensitively", () => {
    expect(
      orderedEmails({ daliEmail: "A@dali.edu", dartmouthEmail: "a@dali.edu", personalEmail: " " }),
    ).toEqual(["A@dali.edu"]);
  });
});

describe("project board helpers", () => {
  it("reads the sprint number off the band label", () => {
    expect(sprintNumberFromLabel("Sprint 6")).toBe(6);
    expect(sprintNumberFromLabel("Week")).toBeNull();
  });

  it("counts done against every non-cancelled task", () => {
    expect(boardCounts(["Done", "Todo", "Cancelled", "Done", "InReview"])).toEqual({ doneCount: 2, totalCount: 4 });
    expect(boardCounts([])).toEqual({ doneCount: 0, totalCount: 0 });
  });

  it("formats the GitHub issue reference", () => {
    expect(githubRef(889)).toBe("889");
    expect(githubRef(null)).toBeNull();
  });
});

describe("parseCalendarRange", () => {
  it("accepts a valid range", () => {
    const r = parseCalendarRange("2026-10-18T00:00:00Z", "2026-10-25T00:00:00Z");
    expect(r).toEqual({ ok: true, from: new Date("2026-10-18T00:00:00Z"), to: new Date("2026-10-25T00:00:00Z") });
  });

  it("requires both bounds", () => {
    expect(parseCalendarRange(null, "2026-10-25T00:00:00Z").ok).toBe(false);
    expect(parseCalendarRange("2026-10-18T00:00:00Z", null).ok).toBe(false);
  });

  it("rejects unparseable dates", () => {
    expect(parseCalendarRange("soon", "2026-10-25T00:00:00Z").ok).toBe(false);
  });

  it("rejects an empty or reversed range", () => {
    expect(parseCalendarRange("2026-10-25T00:00:00Z", "2026-10-25T00:00:00Z").ok).toBe(false);
    expect(parseCalendarRange("2026-10-26T00:00:00Z", "2026-10-25T00:00:00Z").ok).toBe(false);
  });

  it(`allows exactly ${MAX_CALENDAR_RANGE_DAYS} days and no more`, () => {
    const from = new Date("2026-10-01T00:00:00Z");
    const day = 24 * 60 * 60 * 1000;
    const atLimit = new Date(from.getTime() + MAX_CALENDAR_RANGE_DAYS * day);
    expect(parseCalendarRange(from.toISOString(), atLimit.toISOString()).ok).toBe(true);
    expect(parseCalendarRange(from.toISOString(), new Date(atLimit.getTime() + 1).toISOString()).ok).toBe(false);
  });
});

describe("RSVP mapping", () => {
  it("maps invite responses", () => {
    expect(inviteRsvp("Accepted")).toBe("accepted");
    expect(inviteRsvp("Declined")).toBe("declined");
    expect(inviteRsvp("Tentative")).toBe("tentative");
    expect(inviteRsvp(null)).toBe("needs_action");
  });

  it("maps Google responses, treating a missing one as going", () => {
    expect(googleRsvp("needsAction")).toBe("needs_action");
    expect(googleRsvp("tentative")).toBe("tentative");
    expect(googleRsvp(undefined)).toBe("accepted");
  });

  const series = { id: "n-series", scheduledMeetingId: "m1", occurrenceStart: null, rsvp: null };
  const occurrence = {
    id: "n-occ",
    scheduledMeetingId: "m1",
    occurrenceStart: new Date("2026-10-21T15:30:00Z"),
    rsvp: "Accepted" as const,
  };
  const other = { id: "n-other", scheduledMeetingId: "m2", occurrenceStart: null, rsvp: "Declined" as const };

  it("prefers the occurrence's own invite", () => {
    expect(inviteForOccurrence([series, occurrence, other], "m1", "2026-10-21T15:30:00.000Z")?.id).toBe("n-occ");
  });

  it("falls back to the series invite for other occurrences", () => {
    expect(inviteForOccurrence([series, occurrence, other], "m1", "2026-10-28T15:30:00.000Z")?.id).toBe("n-series");
  });

  it("returns null when the viewer has no invite (e.g. the organizer)", () => {
    expect(inviteForOccurrence([other], "m1", "2026-10-21T15:30:00.000Z")).toBeNull();
  });
});

describe("pass helpers", () => {
  it("builds a display id from the onboarding term and user id", () => {
    expect(passDisplayId("cluser0427", "25W")).toBe("DALI-25W-0427");
    expect(passDisplayId("clabcd", null)).toBe("DALI-ABCD");
  });

  it("describes access by Core status and domain", () => {
    expect(passAccessLevel({ isCore: true, domainCode: "Dev" })).toBe("Core · Dev");
    expect(passAccessLevel({ isCore: false, domainCode: null })).toBe("Member");
  });

  it("labels a check-in by location, then rooms, then meeting title", () => {
    expect(checkInLocation({ title: "Crit", location: "DALI Lab", rooms: [{ name: "Pod A" }] })).toBe("DALI Lab");
    expect(checkInLocation({ title: "Crit", location: null, rooms: [{ name: "Pod A" }, { name: "Pod B" }] })).toBe(
      "Pod A, Pod B",
    );
    expect(checkInLocation({ title: "Crit", location: null, rooms: [] })).toBe("Crit");
  });
});

describe("assignmentTypeLabel", () => {
  it.each([
    ["Project", "Project"],
    ["Core", "Core"],
    ["Instructor", "Instructor"],
    ["DomainLead", "Domain lead"],
    ["Admin", "Admin"],
    ["Custom", "Outside job"],
  ])("labels %s as %s", (type, label) => {
    expect(assignmentTypeLabel(type)).toBe(label);
  });

  it("passes an unknown type through", () => {
    expect(assignmentTypeLabel("Mystery")).toBe("Mystery");
  });
});

describe("utcDayKey", () => {
  it("reads a UTC-midnight day as its calendar date", () => {
    expect(utcDayKey(new Date("2026-10-18T00:00:00.000Z"))).toBe("2026-10-18");
  });
});

describe("todayKey", () => {
  it("is the calendar day in the member's zone, not in UTC", () => {
    const lateEvening = new Date("2026-10-22T02:30:00.000Z");
    expect(todayKey(lateEvening, "America/New_York")).toBe("2026-10-21");
    expect(todayKey(lateEvening, "UTC")).toBe("2026-10-22");
  });
});

describe("entryDayKey", () => {
  it("uses the start time in the member's zone when there is one", () => {
    const entry = { date: new Date("2026-10-22T01:00:00.000Z"), startTime: new Date("2026-10-22T01:00:00.000Z") };
    expect(entryDayKey(entry, "America/New_York")).toBe("2026-10-21");
  });

  it("falls back to the stored UTC date when the entry has no time range", () => {
    const entry = { date: new Date("2026-10-21T00:00:00.000Z"), startTime: null };
    expect(entryDayKey(entry, "America/Los_Angeles")).toBe("2026-10-21");
  });
});
