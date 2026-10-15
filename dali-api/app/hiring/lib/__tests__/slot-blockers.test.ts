import { describe, it, expect } from "vitest";
import { SLOT_BLOCKERS, slotBlockerMessage } from "~/hiring/lib/slot-blockers";

describe("slotBlockerMessage", () => {
  it("gives every blocker a sentence with no em dash", () => {
    for (const blocker of SLOT_BLOCKERS) {
      const message = slotBlockerMessage(blocker, { bookingNoticeHours: 12 });
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toContain("—");
    }
  });

  it("puts the configured booking notice into the booking-notice reason", () => {
    expect(slotBlockerMessage("booking-notice", { bookingNoticeHours: 48 })).toContain("48 hour");
  });

  it("says a lone interviewer cannot fill both seats", () => {
    expect(slotBlockerMessage("one-interviewer", { bookingNoticeHours: 12 })).toMatch(/two different people/);
  });

  it("tells the lead in-person slots need a room", () => {
    expect(slotBlockerMessage("no-rooms", { bookingNoticeHours: 12 })).toMatch(/room/);
  });
});
