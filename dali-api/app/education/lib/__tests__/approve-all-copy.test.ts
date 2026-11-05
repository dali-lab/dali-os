import { describe, it, expect } from "vitest";
import { approveAllConfirm } from "../approve-all-copy";

describe("approveAllConfirm", () => {
  it("says applicants beyond capacity stay pending, not waitlisted", () => {
    const c = approveAllConfirm(7);
    expect(c.title).toBe("Approve all 7 pending applicants?");
    expect(c.description).toContain("stay pending");
    expect(c.description).not.toMatch(/waitlist/i);
  });
});
