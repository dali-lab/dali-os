import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import {
  anonLabel,
  anonLabelMapForCycle,
  blindUser,
  applicationBlindLabel,
  applicationBlindLabelsForCycle,
} from "~/hiring/lib/anonymization.server";

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("anonLabel", () => {
  it("formats a 1-indexed pseudonym", () => {
    expect(anonLabel(1)).toBe("Applicant 1");
    expect(anonLabel(7)).toBe("Applicant 7");
  });
});

describe("blindUser", () => {
  it("replaces the name and nulls selected identity fields, keeps opaque id", () => {
    const out = blindUser(
      {
        id: "u1",
        firstName: "Ada",
        lastName: "Lovelace",
        photoUrl: "s3://x",
        classYear: 2027,
        netId: "abc123",
        pronouns: "she/her",
      },
      "Applicant 3",
    );
    expect(out.firstName).toBe("Applicant 3");
    expect(out.lastName).toBe("");
    expect(out.photoUrl).toBeNull();
    expect(out.classYear).toBeNull();
    expect(out.netId).toBeNull();
    expect(out.pronouns).toBeNull();
    expect(out.id).toBe("u1");
  });

  it("does not add identity keys that weren't selected", () => {
    const out = blindUser({ firstName: "Ada", lastName: "Lovelace" }, "Applicant 2");
    expect(out).toEqual({ firstName: "Applicant 2", lastName: "" });
    expect("photoUrl" in out).toBe(false);
  });
});

describe("anonLabelMapForCycle", () => {
  it("assigns stable 1-indexed labels ordered by [createdAt, id]", async () => {
    mockPrisma.application.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const map = await anonLabelMapForCycle("cycle1");
    expect(map.get("a")).toBe("Applicant 1");
    expect(map.get("b")).toBe("Applicant 2");
    expect(map.get("c")).toBe("Applicant 3");
    expect(mockPrisma.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { applicationCycleId: "cycle1" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    );
  });
});

describe("applicationBlindLabelsForCycle", () => {
  const PAST = new Date("2020-01-01");
  const FUTURE = new Date("2100-01-01");

  function setup(opts: {
    anonymizeReview?: boolean;
    status: string;
    closeDate?: Date | null;
    domainCloseDates?: (Date | null)[];
    timeline?: unknown;
    domainsInReview?: string[];
    closedBoards?: { domainId: string; roundId?: string }[];
    inReview?: string[];
  }) {
    mockPrisma.applicationCycle.findUniqueOrThrow.mockResolvedValue({
      anonymizeReview: opts.anonymizeReview ?? true,
      closeDate: opts.closeDate === undefined ? PAST : opts.closeDate,
      timeline: opts.timeline ?? null,
      domains: (opts.domainCloseDates ?? []).map((closeDate) => ({ closeDate })),
      statusUpdates: [{ newStatus: opts.status }],
    });
    mockPrisma.domainApplication.findMany.mockResolvedValue(
      (opts.domainsInReview ?? []).map((domainId) => ({ domainId })),
    );
    const boards = opts.closedBoards ?? [];
    mockPrisma.delibsSession.findMany.mockImplementation(async ({ where }: any) =>
      boards
        .filter((b) => (b.roundId ?? "first") === where.roundId)
        .map(({ domainId }) => ({ domainId })),
    );
    // The in-review lookup filters by id; anonLabelMapForCycle by cycle.
    mockPrisma.application.findMany.mockImplementation(async ({ where }: any) =>
      where.id
        ? (opts.inReview ?? []).map((id) => ({ id }))
        : [{ id: "app1" }, { id: "app2" }],
    );
  }

  const labels = (applicationIds = ["app1", "app2"]) =>
    applicationBlindLabelsForCycle({ cycleId: "cy1", applicationIds });

  it("names everyone when the toggle is off, whatever the stage", async () => {
    setup({ anonymizeReview: false, status: "Open", closeDate: FUTURE });
    expect((await labels()).size).toBe(0);
  });

  it("blinds everyone while applications are open, submitted or not", async () => {
    setup({ status: "Open", closeDate: FUTURE, inReview: ["app1"] });
    expect([...(await labels()).entries()]).toEqual([
      ["app1", "Applicant 1"],
      ["app2", "Applicant 2"],
    ]);
  });

  it("blinds everyone before the cycle opens", async () => {
    setup({ status: "Draft", closeDate: FUTURE });
    expect((await labels()).size).toBe(2);
  });

  it("treats an extended domain as still open past the cycle's own close", async () => {
    setup({
      status: "Open",
      closeDate: PAST,
      domainCloseDates: [PAST, FUTURE],
      domainsInReview: ["dom1"],
      closedBoards: [{ domainId: "dom1" }],
    });
    expect((await labels()).size).toBe(2);
  });

  it("stays blinded while open even when every domain with submissions has closed its first delib", async () => {
    setup({
      status: "Open",
      closeDate: FUTURE,
      domainsInReview: ["dom1"],
      closedBoards: [{ domainId: "dom1" }],
    });
    expect((await labels()).size).toBe(2);
  });

  it("past close, blinds only applications in review", async () => {
    setup({ status: "UnderReview", domainsInReview: ["dom1"], inReview: ["app2"] });
    expect([...(await labels()).entries()]).toEqual([["app2", "Applicant 2"]]);
  });

  it("reads an Open cycle past its close as under review", async () => {
    setup({ status: "Open", closeDate: PAST, domainsInReview: ["dom1"], inReview: ["app2"] });
    expect([...(await labels()).keys()]).toEqual(["app2"]);
  });

  it("asks only for submitted, non-withdrawn applications", async () => {
    setup({ status: "UnderReview", domainsInReview: ["dom1"], inReview: [] });
    await labels();
    expect(mockPrisma.application.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ["app1", "app2"] },
      statusUpdates: { some: { newStatus: "Submitted" } },
      NOT: { statusUpdates: { some: { newStatus: "Withdrawn" } } },
    });
  });

  it("stays blinded until the first delib closes in every domain with someone in review", async () => {
    setup({
      status: "UnderReview",
      domainsInReview: ["dom1", "dom2"],
      closedBoards: [{ domainId: "dom1" }],
      inReview: ["app1"],
    });
    expect((await labels()).size).toBe(1);
  });

  it("names everyone once the first delib has closed in every such domain", async () => {
    setup({
      status: "UnderReview",
      domainsInReview: ["dom1", "dom2"],
      closedBoards: [{ domainId: "dom1" }, { domainId: "dom2" }],
      inReview: ["app1"],
    });
    expect((await labels()).size).toBe(0);
  });

  it("doesn't let a domain with nobody in review hold blinding open", async () => {
    setup({
      status: "UnderReview",
      domainsInReview: ["dom1"],
      closedBoards: [{ domainId: "dom1" }],
    });
    expect((await labels()).size).toBe(0);
    expect(mockPrisma.domainApplication.findMany.mock.calls[0][0].where).toMatchObject({
      selected: true,
      submittedAt: { not: null },
    });
  });

  it("ignores a closed board from a later round", async () => {
    setup({
      status: "UnderReview",
      domainsInReview: ["dom1"],
      closedBoards: [{ domainId: "dom1", roundId: "final" }],
      inReview: ["app1"],
    });
    expect((await labels()).size).toBe(1);
  });

  it("uses the timeline's first delib round, whatever its id", async () => {
    setup({
      status: "UnderReview",
      timeline: [
        { kind: "phase", key: "setup", weeks: [1, 5] },
        { kind: "phase", key: "review", weeks: [6, 6] },
        { kind: "delib", id: "only", label: "Delib", weeks: [6, 6] },
        { kind: "phase", key: "decisions", weeks: [7, 7] },
      ],
      domainsInReview: ["dom1"],
      closedBoards: [{ domainId: "dom1", roundId: "only" }],
    });
    expect((await labels()).size).toBe(0);
  });

  it("names everyone on a Completed cycle, even with a board never closed", async () => {
    setup({ status: "Completed", domainsInReview: ["dom1"], inReview: ["app1"] });
    expect((await labels()).size).toBe(0);
  });

  it("short-circuits on no applications without querying", async () => {
    expect((await labels([])).size).toBe(0);
    expect(mockPrisma.applicationCycle.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("falls back to Applicant 1 for an id missing from the label map", async () => {
    setup({ status: "Open", closeDate: FUTURE });
    expect((await labels(["app-new"])).get("app-new")).toBe("Applicant 1");
  });
});

describe("applicationBlindLabel", () => {
  const openCycle = {
    anonymizeReview: true,
    closeDate: null,
    timeline: null,
    domains: [],
    statusUpdates: [{ newStatus: "Open" }],
  };

  it("returns the label when blinded", async () => {
    mockPrisma.applicationCycle.findUniqueOrThrow.mockResolvedValue(openCycle);
    mockPrisma.application.findMany.mockResolvedValue([{ id: "app1" }]);
    expect(await applicationBlindLabel({ cycleId: "cy1", applicationId: "app1" })).toBe("Applicant 1");
  });

  it("returns null when named", async () => {
    mockPrisma.applicationCycle.findUniqueOrThrow.mockResolvedValue({
      ...openCycle,
      anonymizeReview: false,
    });
    expect(await applicationBlindLabel({ cycleId: "cy1", applicationId: "app1" })).toBeNull();
  });
});
