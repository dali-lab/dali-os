// Calendar mutations used to pay a full Google re-fetch (events + calendar
// list) on every write, even for writes that never touch Google. These cover
// the two pieces of that fix: which intents skip the cache-drop, and that the
// calendarList read itself is now cached like the events read already was.

import { describe, it, expect, beforeEach, vi } from "vitest";

// calendar.server pulls in the Prisma client; CI has no generated client.
vi.mock("~/lib/db");
vi.mock("~/lib/google-calendar", () => ({
  listCalendarsForLink: vi.fn(),
}));

import { listCalendarsForLink } from "~/lib/google-calendar";
import {
  shouldInvalidateExternalCache,
  invalidateExternalCache,
  fetchCachedCalendarList,
} from "~/calendar/routes/calendar.server";

const mockListCalendarsForLink = listCalendarsForLink as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockListCalendarsForLink.mockResolvedValue([{ id: "primary", summary: "Primary" }]);
  // Scrub any entries a previous test left in the shared module-level cache.
  invalidateExternalCache("user-1");
  invalidateExternalCache("user-2");
});

describe("shouldInvalidateExternalCache", () => {
  it("skips invalidation for a DB-only write that can't change what Google returns", () => {
    expect(shouldInvalidateExternalCache("add-meeting-note")).toBe(false);
    expect(shouldInvalidateExternalCache("add-meeting-whiteboard")).toBe(false);
    expect(shouldInvalidateExternalCache("set-meeting-core")).toBe(false);
    expect(shouldInvalidateExternalCache("set-meeting-project")).toBe(false);
    expect(shouldInvalidateExternalCache("set-working-segments")).toBe(false);
    expect(shouldInvalidateExternalCache("copy-weekdays")).toBe(false);
    expect(shouldInvalidateExternalCache("reset-working-hours")).toBe(false);
    expect(shouldInvalidateExternalCache("seed-working-hours")).toBe(false);
    expect(shouldInvalidateExternalCache("set-event-buffer")).toBe(false);
  });

  it("invalidates for intents that write to Google or change which calendars are read", () => {
    expect(shouldInvalidateExternalCache("event-rsvp")).toBe(true);
    expect(shouldInvalidateExternalCache("event-create")).toBe(true);
    expect(shouldInvalidateExternalCache("event-update")).toBe(true);
    expect(shouldInvalidateExternalCache("event-delete")).toBe(true);
    expect(shouldInvalidateExternalCache("event-move")).toBe(true);
    expect(shouldInvalidateExternalCache("cal-create")).toBe(true);
    expect(shouldInvalidateExternalCache("class-create")).toBe(true);
    expect(shouldInvalidateExternalCache("toggle-sub-calendar")).toBe(true);
    expect(shouldInvalidateExternalCache("remove-calendar-link")).toBe(true);
    expect(shouldInvalidateExternalCache("subscribe-general-calendar")).toBe(true);
    expect(shouldInvalidateExternalCache("set-timesheet-sync")).toBe(true);
    expect(shouldInvalidateExternalCache("add-time-entry")).toBe(true);
    expect(shouldInvalidateExternalCache("update-time-entry")).toBe(true);
    expect(shouldInvalidateExternalCache("delete-time-entry")).toBe(true);
    expect(shouldInvalidateExternalCache("toggle-meeting-time-entry")).toBe(true);
    expect(shouldInvalidateExternalCache("track-event-as-meeting")).toBe(true);
  });

  it("defaults to invalidating an intent it has never seen (safe default)", () => {
    expect(shouldInvalidateExternalCache("some-future-intent")).toBe(true);
  });
});

describe("fetchCachedCalendarList", () => {
  it("fetches once and serves the second loader-equivalent read from cache", async () => {
    const first = await fetchCachedCalendarList("user-1", "link-1", "token-1");
    const second = await fetchCachedCalendarList("user-1", "link-1", "token-1");

    expect(first).toEqual(second);
    expect(mockListCalendarsForLink).toHaveBeenCalledTimes(1);
  });

  it("is dropped by invalidateExternalCache like the events cache", async () => {
    await fetchCachedCalendarList("user-1", "link-1", "token-1");
    invalidateExternalCache("user-1");
    await fetchCachedCalendarList("user-1", "link-1", "token-1");

    expect(mockListCalendarsForLink).toHaveBeenCalledTimes(2);
  });

  it("keys by user, so one user's cache never serves another's list", async () => {
    await fetchCachedCalendarList("user-1", "link-1", "token-1");
    await fetchCachedCalendarList("user-2", "link-1", "token-1");

    expect(mockListCalendarsForLink).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed read", async () => {
    mockListCalendarsForLink.mockRejectedValueOnce(new Error("Google calendarList failed (500)"));

    await expect(fetchCachedCalendarList("user-1", "link-1", "token-1")).rejects.toThrow();

    mockListCalendarsForLink.mockResolvedValueOnce([{ id: "primary", summary: "Primary" }]);
    await fetchCachedCalendarList("user-1", "link-1", "token-1");

    expect(mockListCalendarsForLink).toHaveBeenCalledTimes(2);
  });
});
