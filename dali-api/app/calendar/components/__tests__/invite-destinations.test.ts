import { describe, it, expect } from "vitest";
import { inviteDestinations, inviteOrganizerFields } from "~/calendar/components/composer";
import type { CalendarLinkDTO, SubCalendarDTO } from "~/calendar/lib/types";

const cal = (id: string, over: Partial<SubCalendarDTO> = {}): SubCalendarDTO => ({
  id,
  summary: id,
  primary: false,
  color: null,
  enabled: true,
  writable: true,
  ...over,
});

const link = (over: Partial<CalendarLinkDTO> = {}): CalendarLinkDTO => ({
  id: "link1",
  provider: "Google",
  externalEmail: "me@dali.dartmouth.edu",
  displayName: null,
  enabled: true,
  primary: true,
  syncError: null,
  subCalendars: [],
  ...over,
});

describe("inviteDestinations", () => {
  it("lists every writable sub-calendar in a Google account", () => {
    const opts = inviteDestinations([
      link({
        subCalendars: [
          cal("me@dali.dartmouth.edu", { primary: true }),
          cal("team@group.calendar.google.com", { summary: "Team" }),
          cal("holidays", { writable: false }),
        ],
      }),
    ]);
    expect(opts).toEqual([
      { value: "link1:me@dali.dartmouth.edu", label: "me@dali.dartmouth.edu · Primary" },
      { value: "link1:team@group.calendar.google.com", label: "me@dali.dartmouth.edu · Team" },
    ]);
  });

  it("falls back to the account's primary when Google listed no calendars", () => {
    expect(inviteDestinations([link({ subCalendars: null, displayName: "Work" })])).toEqual([
      { value: "link1:", label: "Work" },
    ]);
  });

  it("skips disabled and non-Google links", () => {
    expect(
      inviteDestinations([link({ enabled: false }), link({ id: "o", provider: "Outlook" })]),
    ).toEqual([]);
  });
});

describe("inviteOrganizerFields", () => {
  it("sends both the link and the calendar", () => {
    expect(inviteOrganizerFields("link1:team@group.calendar.google.com")).toEqual({
      organizerCalendarLinkId: "link1",
      organizerCalendarId: "team@group.calendar.google.com",
    });
  });

  it("sends only the link for the primary fallback", () => {
    expect(inviteOrganizerFields("link1:")).toEqual({ organizerCalendarLinkId: "link1" });
  });

  it("sends nothing for no invite", () => {
    expect(inviteOrganizerFields("")).toEqual({});
  });
});
