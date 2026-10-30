import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import { loadApplicationTracker, describeOpenDomainsNote } from "~/hiring/lib/application-tracker.server";

const mockPrisma = prisma as unknown as Record<string, any>;

const USER_ID = "user-1";
const CYCLE_ID = "cycle-1";

function da(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: overrides.id ?? "da-1",
    domainId: overrides.domainId ?? "d1",
    domain: { name: overrides.domainName ?? "AI" },
    submittedAt: overrides.submittedAt ?? null,
    closureReason: overrides.closureReason ?? null,
    decisions: overrides.decisions ?? [],
    interviews: overrides.interviews ?? [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.interviewConfig = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.applicationCycle = { findUnique: vi.fn().mockResolvedValue({ closeDate: null }) };
  mockPrisma.domainApplicationCycle = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.application = { findFirst: vi.fn().mockResolvedValue(null) };
});

afterEach(() => {
  vi.useRealTimers();
});

const pinNow = (iso: string) => vi.useFakeTimers({ now: new Date(iso), toFake: ["Date"] });

describe("loadApplicationTracker", () => {
  it("has no deadline and treats having no ready domains as closed (nothing to apply to)", async () => {
    const result = await loadApplicationTracker(USER_ID, CYCLE_ID, "Open");
    expect(result.deadline).toBeNull();
    expect(result.allDomainsClosed).toBe(true);
    expect(result.hasApplication).toBe(false);
  });

  it("deadline is the latest close across every ready domain when nothing is selected yet", async () => {
    pinNow("2025-12-15T12:00:00Z");
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ closeDate: new Date("2026-01-01T04:59:59Z") });
    mockPrisma.domainApplicationCycle.findMany.mockResolvedValue([
      { domainId: "d1", closeDate: null, domain: { name: "AI" } },
      { domainId: "d2", closeDate: new Date("2026-02-01T04:59:59Z"), domain: { name: "Web" } },
    ]);

    const result = await loadApplicationTracker(USER_ID, CYCLE_ID, "Open");
    expect(result.deadline).toBe(new Date("2026-02-01T04:59:59Z").toISOString());
  });

  it("deadline narrows to only the applicant's selected domains once they've picked", async () => {
    pinNow("2025-12-15T12:00:00Z");
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ closeDate: new Date("2026-01-01T04:59:59Z") });
    mockPrisma.domainApplicationCycle.findMany.mockResolvedValue([
      { domainId: "d1", closeDate: null, domain: { name: "AI" } },
      { domainId: "d2", closeDate: new Date("2026-03-01T04:59:59Z"), domain: { name: "Web" } },
    ]);
    mockPrisma.application.findFirst.mockResolvedValue({
      id: "app-1",
      statusUpdates: [{ newStatus: "Draft", createdAt: new Date("2026-01-01") }],
      domainApplications: [da({ domainId: "d1" })],
    });

    const result = await loadApplicationTracker(USER_ID, CYCLE_ID, "Open");
    // Only d1 (inherits the cycle's close) is selected, so Web's later close
    // doesn't count even though it's the later date overall.
    expect(result.deadline).toBe(new Date("2026-01-01T04:59:59Z").toISOString());
  });

  it("deadline skips a selected domain that has closed and falls to the open ones they could still add", async () => {
    pinNow("2026-10-21T14:00:00Z");
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ closeDate: new Date("2026-10-21T03:59:59Z") });
    mockPrisma.domainApplicationCycle.findMany.mockResolvedValue([
      { domainId: "uiux", closeDate: null, domain: { name: "UI/UX Design" } },
      { domainId: "engs", closeDate: new Date("2026-10-26T03:59:59Z"), domain: { name: "Engineering" } },
    ]);
    mockPrisma.application.findFirst.mockResolvedValue({
      id: "app-1",
      statusUpdates: [{ newStatus: "Submitted", createdAt: new Date("2026-10-15") }],
      domainApplications: [da({ domainId: "uiux", domainName: "UI/UX Design" })],
    });

    const result = await loadApplicationTracker(USER_ID, CYCLE_ID, "Open");
    expect(result.deadline).toBe("2026-10-26T03:59:59.000Z");
    expect(result.hasOpenSelectedDomain).toBe(false);
    expect(result.addableDomainNames).toEqual(["Engineering"]);
  });

  it("deadline stays on the applicant's own open domain when one is open", async () => {
    pinNow("2026-10-21T14:00:00Z");
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ closeDate: new Date("2026-10-21T03:59:59Z") });
    mockPrisma.domainApplicationCycle.findMany.mockResolvedValue([
      { domainId: "uiux", closeDate: null, domain: { name: "UI/UX Design" } },
      { domainId: "engs", closeDate: new Date("2026-10-26T03:59:59Z"), domain: { name: "Engineering" } },
      { domainId: "pm", closeDate: new Date("2026-10-29T03:59:59Z"), domain: { name: "Product Management" } },
    ]);
    mockPrisma.application.findFirst.mockResolvedValue({
      id: "app-1",
      statusUpdates: [{ newStatus: "Submitted", createdAt: new Date("2026-10-15") }],
      domainApplications: [da({ domainId: "uiux" }), da({ id: "da-2", domainId: "engs" })],
    });

    const result = await loadApplicationTracker(USER_ID, CYCLE_ID, "Open");
    expect(result.deadline).toBe("2026-10-26T03:59:59.000Z");
    expect(result.hasOpenSelectedDomain).toBe(true);
    expect(result.addableDomainNames).toEqual(["Product Management"]);
  });

  it("deadline is null once every ready domain has closed", async () => {
    pinNow("2026-10-27T14:00:00Z");
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ closeDate: new Date("2026-10-21T03:59:59Z") });
    mockPrisma.domainApplicationCycle.findMany.mockResolvedValue([
      { domainId: "engs", closeDate: new Date("2026-10-26T03:59:59Z"), domain: { name: "Engineering" } },
    ]);

    const result = await loadApplicationTracker(USER_ID, CYCLE_ID, "Open");
    expect(result.deadline).toBeNull();
    expect(result.addableDomainNames).toEqual([]);
  });

  it("marks a selected DA closed with its own closeDate and leaves submittedAt through", async () => {
    mockPrisma.applicationCycle.findUnique.mockResolvedValue({ closeDate: new Date("2099-01-01T04:59:59Z") });
    mockPrisma.domainApplicationCycle.findMany.mockResolvedValue([
      { domainId: "d1", closeDate: new Date("2020-01-01T04:59:59Z"), domain: { name: "AI" } },
    ]);
    const submittedAt = new Date("2019-12-01T00:00:00Z");
    mockPrisma.application.findFirst.mockResolvedValue({
      id: "app-1",
      statusUpdates: [{ newStatus: "Submitted", createdAt: new Date("2019-12-01") }],
      domainApplications: [da({ domainId: "d1", submittedAt })],
    });

    const result = await loadApplicationTracker(USER_ID, CYCLE_ID, "Open");
    expect(result.domainApplications).toHaveLength(1);
    const [tracked] = result.domainApplications;
    expect(tracked.closed).toBe(true);
    expect(tracked.closeDate).toBe(new Date("2020-01-01T04:59:59Z").toISOString());
    expect(tracked.submittedAt).toBe(submittedAt.toISOString());
  });

  it("books slots as long as the round the applicant is invited to", async () => {
    mockPrisma.interviewConfig.findMany.mockResolvedValue([
      { interviewRoundId: "interviews", slotDurationMinutes: 30 },
      { interviewRoundId: "iv2", slotDurationMinutes: 60 },
    ]);
    const invite = (round: string, at: string) => ({
      type: "InvitedToInterview",
      stage: "Released",
      interviewRoundId: round,
      createdAt: new Date(at),
    });
    mockPrisma.application.findFirst.mockResolvedValue({
      id: "app-1",
      statusUpdates: [{ newStatus: "Submitted", createdAt: new Date("2026-10-01") }],
      domainApplications: [
        da({ submittedAt: new Date("2026-10-01"), decisions: [invite("iv2", "2026-10-10"), invite("interviews", "2026-10-02")] }),
      ],
    });
    expect((await loadApplicationTracker(USER_ID, CYCLE_ID, "UnderReview")).slotDurationMinutes).toBe(60);
  });

  it("books first-round slot lengths when nobody is invited yet", async () => {
    mockPrisma.interviewConfig.findMany.mockResolvedValue([
      { interviewRoundId: "iv2", slotDurationMinutes: 60 },
      { interviewRoundId: "interviews", slotDurationMinutes: 45 },
    ]);
    expect((await loadApplicationTracker(USER_ID, CYCLE_ID, "UnderReview")).slotDurationMinutes).toBe(45);
  });

  it("allDomainsClosed is true only once every ready domain has closed", async () => {
    mockPrisma.domainApplicationCycle.findMany.mockResolvedValue([
      { domainId: "d1", closeDate: new Date("2020-01-01T00:00:00Z"), domain: { name: "AI" } },
      { domainId: "d2", closeDate: new Date("2099-01-01T00:00:00Z"), domain: { name: "Web" } },
    ]);
    let result = await loadApplicationTracker(USER_ID, CYCLE_ID, "Open");
    expect(result.allDomainsClosed).toBe(false);

    mockPrisma.domainApplicationCycle.findMany.mockResolvedValue([
      { domainId: "d1", closeDate: new Date("2020-01-01T00:00:00Z"), domain: { name: "AI" } },
      { domainId: "d2", closeDate: new Date("2020-02-01T00:00:00Z"), domain: { name: "Web" } },
    ]);
    result = await loadApplicationTracker(USER_ID, CYCLE_ID, "Open");
    expect(result.allDomainsClosed).toBe(true);
  });

  it("openDomainsNote is null when every ready domain is open", async () => {
    mockPrisma.domainApplicationCycle.findMany.mockResolvedValue([
      { domainId: "d1", closeDate: new Date("2099-01-01T00:00:00Z"), domain: { name: "AI" } },
    ]);
    const result = await loadApplicationTracker(USER_ID, CYCLE_ID, "Open");
    expect(result.openDomainsNote).toBeNull();
  });

  it("openDomainsNote describes the mix when some ready domains have closed", async () => {
    mockPrisma.domainApplicationCycle.findMany.mockResolvedValue([
      { domainId: "d1", closeDate: new Date("2020-01-01T00:00:00Z"), domain: { name: "AI" } },
      { domainId: "d2", closeDate: new Date("2099-01-01T00:00:00Z"), domain: { name: "Web" } },
    ]);
    const result = await loadApplicationTracker(USER_ID, CYCLE_ID, "Open");
    expect(result.openDomainsNote).toMatch(/^AI closed .+\. Web is still open\.$/);
  });
});

describe("describeOpenDomainsNote", () => {
  it("returns null when nothing is closed", () => {
    expect(
      describeOpenDomainsNote([{ name: "AI", closed: false, closeDate: null }]),
    ).toBeNull();
  });

  it("returns null when nothing is open", () => {
    expect(
      describeOpenDomainsNote([{ name: "AI", closed: true, closeDate: "2020-01-01T00:00:00Z" }]),
    ).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(describeOpenDomainsNote([])).toBeNull();
  });

  it("singular closed and open domains use singular verbs", () => {
    const note = describeOpenDomainsNote([
      { name: "AI", closed: true, closeDate: "2026-01-06T04:59:59Z" },
      { name: "Web", closed: false, closeDate: null },
    ]);
    expect(note).toBe("AI closed Jan 5. Web is still open.");
  });

  it("groups multiple closed domains sharing a close date into one sentence", () => {
    const note = describeOpenDomainsNote([
      { name: "AI", closed: true, closeDate: "2026-01-06T04:59:59Z" },
      { name: "Robotics", closed: true, closeDate: "2026-01-06T04:59:59Z" },
      { name: "Web", closed: false, closeDate: null },
    ]);
    expect(note).toBe("AI and Robotics closed Jan 5. Web is still open.");
  });

  it("joins three or more open domain names with a serial comma and 'are'", () => {
    const note = describeOpenDomainsNote([
      { name: "AI", closed: true, closeDate: "2026-01-06T04:59:59Z" },
      { name: "Web", closed: false, closeDate: null },
      { name: "Design", closed: false, closeDate: null },
      { name: "Robotics", closed: false, closeDate: null },
    ]);
    expect(note).toBe("AI closed Jan 5. Web, Design, and Robotics are still open.");
  });

  it("separates distinct close dates into their own sentences", () => {
    const note = describeOpenDomainsNote([
      { name: "AI", closed: true, closeDate: "2026-01-06T04:59:59Z" },
      { name: "Robotics", closed: true, closeDate: "2026-02-11T04:59:59Z" },
      { name: "Web", closed: false, closeDate: null },
    ]);
    expect(note).toBe("AI closed Jan 5. Robotics closed Feb 10. Web is still open.");
  });
});
