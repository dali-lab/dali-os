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

  it("explains the in-domain plus cross-domain pairing when a cycle has one domain of interviewers", () => {
    expect(slotBlockerMessage("no-cross-domain-interviewer", { bookingNoticeHours: 12 })).toMatch(/cross-domain/);
  });

  it("tells the lead in-person slots need a room", () => {
    expect(slotBlockerMessage("no-rooms", { bookingNoticeHours: 12 })).toMatch(/room/);
  });
});
