import { describe, expect, it } from "vitest";
import { backgroundKey, failureMessage, isBackgroundKey } from "~/calendar/lib/background-submissions";

describe("background submission keys", () => {
  it("recognises its own keys and no others", () => {
    expect(isBackgroundKey(backgroundKey("event-move", "a"))).toBe(true);
    expect(isBackgroundKey("cal:fg:a")).toBe(false);
    expect(isBackgroundKey("fetcher-1")).toBe(false);
  });

  it("keeps two events' keys apart", () => {
    expect(backgroundKey("event-move", "a")).not.toBe(backgroundKey("event-move", "b"));
  });
});

describe("failureMessage", () => {
  it("leads with what failed, then the server's reason", () => {
    expect(failureMessage("event-move", "Room taken")).toBe("Couldn't move the event. Room taken");
  });

  it("stands on its own without a reason", () => {
    expect(failureMessage("event-delete", undefined)).toBe("Couldn't delete the event.");
    expect(failureMessage("event-delete", "   ")).toBe("Couldn't delete the event.");
  });

  it("has a lead for every optimistic intent", () => {
    for (const intent of ["event-update", "event-create", "add-time-entry", "update-time-entry", "delete-time-entry"]) {
      expect(failureMessage(intent, null)).not.toBe("Couldn't save that change.");
    }
  });

  it("falls back for an intent it does not know", () => {
    expect(failureMessage("other", null)).toBe("Couldn't save that change.");
  });
});
