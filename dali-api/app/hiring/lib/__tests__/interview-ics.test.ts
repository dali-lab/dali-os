import { describe, it, expect } from "vitest";
import { buildInviteIcs, buildCancelIcs } from "../interview-ics";

const baseInvite = {
  interviewId: "abc",
  summary: "DALI Interview",
  startTime: new Date("2026-05-27T18:00:00Z"),
  endTime: new Date("2026-05-27T18:30:00Z"),
  location: "Pod Momo, DALI Lab",
  organizer: { email: "applications@dali.dartmouth.edu", name: "DALI Lab" },
  attendees: [{ email: "kiran@example.com", name: "Kiran" }],
};

describe("buildInviteIcs — SEQUENCE", () => {
  it("uses the sequence passed in", () => {
    const ics = buildInviteIcs({ ...baseInvite, sequence: 0 });
    expect(ics).toMatch(/^SEQUENCE:0$/m);
  });

  it("emits an updated sequence for follow-up publishes", () => {
    const ics = buildInviteIcs({ ...baseInvite, sequence: 3 });
    expect(ics).toMatch(/^SEQUENCE:3$/m);
    expect(ics).not.toMatch(/^SEQUENCE:0$/m);
  });

  it("includes METHOD:REQUEST for invites/updates", () => {
    const ics = buildInviteIcs({ ...baseInvite, sequence: 0 });
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("STATUS:CONFIRMED");
  });
});

describe("buildCancelIcs — SEQUENCE", () => {
  const baseCancel = {
    interviewId: "abc",
    summary: "DALI Interview",
    startTime: new Date("2026-05-27T18:00:00Z"),
    endTime: new Date("2026-05-27T18:30:00Z"),
    organizer: { email: "applications@dali.dartmouth.edu", name: "DALI Lab" },
    attendees: [{ email: "kiran@example.com", name: "Kiran" }],
  };

  it("uses the sequence passed in", () => {
    const ics = buildCancelIcs({ ...baseCancel, sequence: 4 });
    expect(ics).toMatch(/^SEQUENCE:4$/m);
  });

  it("emits METHOD:CANCEL and STATUS:CANCELLED", () => {
    const ics = buildCancelIcs({ ...baseCancel, sequence: 1 });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
  });
});
