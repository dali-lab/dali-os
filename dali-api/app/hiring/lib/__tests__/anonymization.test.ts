import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import {
  anonLabel,
  anonLabelMapForCycle,
  blindUser,
  applicationBlindLabel,
  domainApplicationBlindLabel,
  domainApplicationBlindLabels,
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

const PAST = new Date("2020-01-01");
const FUTURE = new Date("2100-01-01");

type Row = { id: string; domainId: string; applicationId: string };

const ENG_ROWS: Row[] = [
  { id: "da1", domainId: "eng", applicationId: "app1" },
  { id: "da2", domainId: "eng", applicationId: "app2" },
];

function setup(opts: {
  anonymizeReview?: boolean;
  status: string;
  closeDate?: Date | null;
  domains?: { domainId: string; closeDate: Date | null }[];
  timeline?: unknown;
  released?: string[];
  closedBoards?: { domainId: string; roundId?: string }[];
  inReview?: string[];
  rows?: Row[];
}) {
  const rows = opts.rows ?? ENG_ROWS;
  mockPrisma.applicationCycle.findUniqueOrThrow.mockResolvedValue({
    anonymizeReview: opts.anonymizeReview ?? true,
    closeDate: opts.closeDate === undefined ? PAST : opts.closeDate,
    timeline: opts.timeline ?? null,
    domains: opts.domains ?? [],
    statusUpdates: [{ newStatus: opts.status }],
  });
  mockPrisma.domainApplication.findMany.mockImplementation(async ({ where }: any) => {
    if (where.decisions) return (opts.released ?? []).map((domainId) => ({ domainId }));
    if (where.id) return rows;
    const ids: string[] | undefined = where.domainId?.in;
    return rows.filter(
      (r) => r.applicationId === where.applicationId && (!ids || ids.includes(r.domainId)),
    );
  });
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

const labels = (domainApplicationIds = ["da1", "da2"]) =>
  domainApplicationBlindLabels({ cycleId: "cy1", domainApplicationIds });

describe("domainApplicationBlindLabels", () => {
  it("names everyone when the toggle is off, without loading the rows", async () => {
    setup({ anonymizeReview: false, status: "Open", closeDate: FUTURE });
    expect((await labels()).size).toBe(0);
    expect(mockPrisma.domainApplication.findMany).not.toHaveBeenCalled();
  });

  it("names everyone on a Completed cycle, even with a board never closed", async () => {
    setup({ status: "Completed", inReview: ["app1"] });
    expect((await labels()).size).toBe(0);
  });

  it("blinds everyone before the cycle opens", async () => {
    setup({ status: "Draft", closeDate: FUTURE });
    expect((await labels()).size).toBe(2);
  });

  it("blinds everyone while the domain's window is open, submitted or not", async () => {
    setup({ status: "Open", closeDate: FUTURE, inReview: ["app1"] });
    expect([...(await labels()).entries()]).toEqual([
      ["da1", "Applicant 1"],
      ["da2", "Applicant 2"],
    ]);
  });

  it("keeps an open window blinded even after the domain released invites or closed a delib", async () => {
    setup({
      status: "Open",
      closeDate: FUTURE,
      released: ["eng"],
      closedBoards: [{ domainId: "eng" }],
    });
    expect((await labels()).size).toBe(2);
  });

  it("past close, blinds only applications in review", async () => {
    setup({ status: "UnderReview", inReview: ["app2"] });
    expect([...(await labels()).entries()]).toEqual([["da2", "Applicant 2"]]);
  });

  it("reads an Open cycle past its close as under review", async () => {
    setup({ status: "Open", closeDate: PAST, inReview: ["app2"] });
    expect([...(await labels()).keys()]).toEqual(["da2"]);
  });

  it("treats a cycle moved to review early as closed, whatever the dates say", async () => {
    setup({ status: "UnderReview", closeDate: FUTURE, inReview: ["app2"] });
    expect([...(await labels()).keys()]).toEqual(["da2"]);
  });

  it("asks only for submitted, non-withdrawn applications", async () => {
    setup({ status: "UnderReview" });
    await labels();
    expect(mockPrisma.application.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ["app1", "app2"] },
      statusUpdates: { some: { newStatus: "Submitted" } },
      NOT: { statusUpdates: { some: { newStatus: "Withdrawn" } } },
    });
  });

  it("names every applicant in a domain once it releases interview invites", async () => {
    setup({ status: "UnderReview", released: ["eng"], inReview: ["app1", "app2"] });
    expect((await labels()).size).toBe(0);
  });

  it("counts only released interview invites", async () => {
    setup({ status: "UnderReview", inReview: ["app1"] });
    await labels();
    const inviteQuery = mockPrisma.domainApplication.findMany.mock.calls
      .map(([args]: any) => args.where)
      .find((where: any) => where.decisions);
    expect(inviteQuery).toEqual({
      application: { applicationCycleId: "cy1" },
      decisions: { some: { type: "InvitedToInterview", stage: "Released" } },
    });
  });

  it("names every applicant in a domain once it closes its first delib", async () => {
    setup({
      status: "UnderReview",
      closedBoards: [{ domainId: "eng" }],
      inReview: ["app1", "app2"],
    });
    expect((await labels()).size).toBe(0);
  });

  it("ignores a closed board from a later round", async () => {
    setup({
      status: "UnderReview",
      closedBoards: [{ domainId: "eng", roundId: "final" }],
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
      closedBoards: [{ domainId: "eng", roundId: "only" }],
      inReview: ["app1"],
    });
    expect((await labels()).size).toBe(0);
  });

  it("lifts one domain without touching another", async () => {
    setup({
      status: "UnderReview",
      released: ["eng"],
      inReview: ["app1", "app2"],
      rows: [
        { id: "da1", domainId: "eng", applicationId: "app1" },
        { id: "da2", domainId: "design", applicationId: "app2" },
      ],
    });
    expect([...(await labels()).keys()]).toEqual(["da2"]);
  });

  it("names a two-domain applicant in the lifted domain and blinds them in the other", async () => {
    setup({
      status: "UnderReview",
      released: ["eng"],
      inReview: ["app1"],
      rows: [
        { id: "da1", domainId: "eng", applicationId: "app1" },
        { id: "da2", domainId: "design", applicationId: "app1" },
      ],
    });
    expect([...(await labels()).entries()]).toEqual([["da2", "Applicant 1"]]);
  });

  it("lifts a closed domain while an extended domain's window stays open", async () => {
    setup({
      status: "Open",
      closeDate: PAST,
      domains: [
        { domainId: "eng", closeDate: PAST },
        { domainId: "design", closeDate: FUTURE },
      ],
      released: ["eng"],
      rows: [
        { id: "da1", domainId: "eng", applicationId: "app1" },
        { id: "da2", domainId: "design", applicationId: "app2" },
      ],
    });
    expect([...(await labels()).keys()]).toEqual(["da2"]);
  });

  it("short-circuits on no rows without querying", async () => {
    expect((await labels([])).size).toBe(0);
    expect(mockPrisma.applicationCycle.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("falls back to Applicant 1 for an application missing from the label map", async () => {
    setup({
      status: "Open",
      closeDate: FUTURE,
      rows: [{ id: "da9", domainId: "eng", applicationId: "app-new" }],
    });
    expect((await labels(["da9"])).get("da9")).toBe("Applicant 1");
  });
});

describe("domainApplicationBlindLabel", () => {
  const one = () => domainApplicationBlindLabel({ cycleId: "cy1", domainApplicationId: "da1" });

  it("returns the label when the row is blinded", async () => {
    setup({ status: "Open", closeDate: FUTURE, rows: [ENG_ROWS[0]] });
    expect(await one()).toBe("Applicant 1");
  });

  it("returns null when the row is named", async () => {
    setup({ status: "UnderReview", released: ["eng"], rows: [ENG_ROWS[0]] });
    expect(await one()).toBeNull();
  });
});

describe("applicationBlindLabel", () => {
  const TWO_DOMAINS: Row[] = [
    { id: "da1", domainId: "eng", applicationId: "app1" },
    { id: "da2", domainId: "design", applicationId: "app1" },
  ];
  const label = (domainIds?: string[]) =>
    applicationBlindLabel({ cycleId: "cy1", applicationId: "app1", domainIds });

  it("stays blinded while any selected domain is", async () => {
    setup({ status: "UnderReview", released: ["eng"], inReview: ["app1"], rows: TWO_DOMAINS });
    expect(await label()).toBe("Applicant 1");
  });

  it("names the applicant once all selected domains have lifted", async () => {
    setup({
      status: "UnderReview",
      released: ["eng", "design"],
      inReview: ["app1"],
      rows: TWO_DOMAINS,
    });
    expect(await label()).toBeNull();
  });

  it("looks only at the given domains", async () => {
    setup({ status: "UnderReview", released: ["eng"], inReview: ["app1"], rows: TWO_DOMAINS });
    expect(await label(["eng"])).toBeNull();
    expect(await label(["design"])).toBe("Applicant 1");
  });

  it("looks at every domain for a viewer with none assigned", async () => {
    setup({ status: "UnderReview", released: ["eng"], inReview: ["app1"], rows: TWO_DOMAINS });
    expect(await label([])).toBe("Applicant 1");
  });

  it("blinds an application with no selected domains while the cycle is open", async () => {
    setup({ status: "Open", closeDate: FUTURE, rows: [] });
    expect(await label()).toBe("Applicant 1");
  });

  it("names an unsubmitted application with no selected domains once the cycle closes", async () => {
    setup({ status: "UnderReview", rows: [] });
    expect(await label()).toBeNull();
  });

  it("returns null when the toggle is off", async () => {
    setup({ anonymizeReview: false, status: "Open", closeDate: FUTURE, rows: TWO_DOMAINS });
    expect(await label()).toBeNull();
  });
});
