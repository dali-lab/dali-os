import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn() }));
vi.mock("~/signing/lib/audiences", () => ({
  AUDIENCE_RESOLVERS: {
    Members: { enumerable: true, listMembers: vi.fn() },
    Manual: { enumerable: false, listMembers: vi.fn() },
  },
}));

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { AUDIENCE_RESOLVERS } from "~/signing/lib/audiences";
import { getAgreementsOverview } from "~/signing/lib/console.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const PUB = new Date("2026-06-01T00:00:00Z");

// Fixtures shaped like the getAgreementsOverview findMany select.
const memberSig = (id: string, userId: string, name: string, versionId: string) => ({
  id,
  roleKey: "member",
  versionId,
  signerUserId: userId,
  typedName: name,
  signer: { firstName: name.split(" ")[0], lastName: name.split(" ")[1] ?? "" },
});

const DOCS = [
  {
    // Current-term binding, partially signed (1 of 3 Members).
    id: "docA",
    name: "Term Agreement",
    kind: "MemberAgreement",
    gateScope: "App",
    audience: "Members",
    cadence: "PerTerm",
    versions: [{ id: "vA1", versionNumber: 1, publishedAt: PUB }],
    bindings: [
      {
        id: "bA",
        versionId: "vA1",
        scopeKey: "term:term-26f",
        termId: "term-26f",
        cycleId: null,
        lastRemindedAt: null,
        version: { versionNumber: 1 },
        term: { code: "26F" },
        cycle: null,
        signatures: [memberSig("gA1", "u1", "Ada L", "vA1")],
      },
    ],
  },
  {
    // Published, but its only binding is for a PAST term → needs activation.
    id: "docB",
    name: "Mentor Agreement",
    kind: "MentorshipAgreement",
    gateScope: "App",
    audience: "Members",
    cadence: "PerTerm",
    versions: [{ id: "vB1", versionNumber: 1, publishedAt: PUB }],
    bindings: [
      {
        id: "bB",
        versionId: "vB1",
        scopeKey: "term:term-25f",
        termId: "term-25f",
        cycleId: null,
        lastRemindedAt: null,
        version: { versionNumber: 1 },
        term: { code: "25F" },
        cycle: null,
        signatures: [],
      },
    ],
  },
  {
    // Newest version is an unpublished draft → draftPending; not enforced.
    id: "docC",
    name: "Handbook",
    kind: "General",
    gateScope: "None",
    audience: "Manual",
    cadence: "Once",
    versions: [
      { id: "vC2", versionNumber: 2, publishedAt: null },
      { id: "vC1", versionNumber: 1, publishedAt: PUB },
    ],
    bindings: [],
  },
  {
    // Non-enumerable audience → count only (total null), app-scoped (always current).
    id: "docD",
    name: "Media Release",
    kind: "General",
    gateScope: "None",
    audience: "Manual",
    cadence: "Once",
    versions: [{ id: "vD1", versionNumber: 1, publishedAt: PUB }],
    bindings: [
      {
        id: "bD",
        versionId: "vD1",
        scopeKey: "app",
        termId: null,
        cycleId: null,
        lastRemindedAt: PUB,
        version: { versionNumber: 1 },
        term: null,
        cycle: null,
        signatures: [memberSig("gD1", "u1", "Ada L", "vD1"), memberSig("gD2", "u2", "Bo K", "vD1")],
      },
    ],
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(currentTerm).mockResolvedValue({ id: "term-26f", code: "26F" } as never);
  vi.mocked(AUDIENCE_RESOLVERS.Members.listMembers).mockResolvedValue([
    { id: "u1", firstName: "Ada", lastName: "L" },
    { id: "u2", firstName: "Bo", lastName: "K" },
    { id: "u3", firstName: "Cy", lastName: "R" },
  ]);
  mockPrisma.signingDocument.findMany.mockResolvedValue(DOCS);
  mockPrisma.signingSignature.findMany.mockResolvedValue([
    {
      id: "gA1",
      signedAt: PUB,
      typedName: "Ada L",
      signer: { firstName: "Ada", lastName: "L" },
      binding: { documentId: "docA", document: { name: "Term Agreement" } },
    },
  ]);
});

describe("getAgreementsOverview", () => {
  it("computes per-binding completion for a current, partially-signed agreement", async () => {
    const { agreements } = await getAgreementsOverview();
    const a = agreements.find((x) => x.id === "docA")!;
    expect(a.needsActivation).toBe(false);
    expect(a.draftPending).toBe(false);
    expect(a.bindings).toHaveLength(1);
    expect(a.bindings[0]).toMatchObject({
      isCurrent: true,
      signedCount: 1,
      total: 3,
      scopeLabel: "26F",
    });
    expect(a.bindings[0].outstanding).toEqual(["Bo K", "Cy R"]);
  });

  it("flags needsActivation when the only binding is for a past term", async () => {
    const { agreements } = await getAgreementsOverview();
    const b = agreements.find((x) => x.id === "docB")!;
    expect(b.needsActivation).toBe(true);
    expect(b.bindings[0].isCurrent).toBe(false);
    expect(b.bindings[0]).toMatchObject({ signedCount: 0, total: 3 });
  });

  it("marks an unpublished tail version as draftPending, not needing activation", async () => {
    const { agreements } = await getAgreementsOverview();
    const c = agreements.find((x) => x.id === "docC")!;
    expect(c.draftPending).toBe(true);
    expect(c.needsActivation).toBe(false);
    expect(c.latestPublishedVersionId).toBe("vC1");
  });

  it("reports a signed count with no percentage for a non-enumerable audience", async () => {
    const { agreements } = await getAgreementsOverview();
    const d = agreements.find((x) => x.id === "docD")!;
    expect(d.bindings[0]).toMatchObject({
      total: null,
      signedCount: 2,
      scopeLabel: "Lab-wide",
      isCurrent: true,
    });
    expect(d.bindings[0].outstanding).toEqual([]);
    // Manual audiences are never enumerated.
    expect(AUDIENCE_RESOLVERS.Manual.listMembers).not.toHaveBeenCalled();
  });

  it("returns a recent-signature activity feed and the current term", async () => {
    const overview = await getAgreementsOverview();
    expect(overview.currentTermCode).toBe("26F");
    expect(overview.activity).toHaveLength(1);
    expect(overview.activity[0]).toMatchObject({
      documentId: "docA",
      documentName: "Term Agreement",
      signerName: "Ada L",
    });
  });
});
