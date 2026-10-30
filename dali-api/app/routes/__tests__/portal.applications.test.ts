import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

import { hiringPillLabel } from "~/routes/portal.applications";

describe("hiringPillLabel", () => {
  it("leaves non-ApplicationOpen statuses alone", () => {
    expect(hiringPillLabel({ status: "Pending", closed: false, closeDate: null })).toBe("Under review");
    expect(hiringPillLabel({ status: "Accepted", closed: true, closeDate: "2026-01-06T04:59:59Z" })).toBe(
      "Accepted",
    );
  });

  it("appends 'closes <Mon D>' for an open, unsubmitted domain", () => {
    expect(
      hiringPillLabel({ status: "ApplicationOpen", closed: false, closeDate: "2026-01-06T12:00:00Z" }),
    ).toBe("Not submitted · closes Jan 6");
  });

  it("appends 'closed <Mon D>' for a closed, unsubmitted domain", () => {
    expect(
      hiringPillLabel({ status: "ApplicationOpen", closed: true, closeDate: "2026-01-06T12:00:00Z" }),
    ).toBe("Not submitted · closed Jan 6");
  });

  it("falls back to the base label when there's no close date to show", () => {
    expect(hiringPillLabel({ status: "ApplicationOpen", closed: false, closeDate: null })).toBe(
      "Not submitted",
    );
  });

  it("falls back to the raw status string for an unrecognized status", () => {
    expect(hiringPillLabel({ status: "SomethingNew", closed: false, closeDate: null })).toBe("SomethingNew");
  });
});
