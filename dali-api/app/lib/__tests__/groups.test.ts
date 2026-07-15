import { describe, it, expect, beforeEach, vi } from "vitest";

// groups.ts pulls in ~/lib/db at import time, which loads the generated Prisma
// client — absent in CI before `prisma generate`. isGroupArchived is pure and
// never touches the DB, so mock db so importing the module doesn't require the
// real client (matches every other db-touching suite).
vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { isGroupArchived, isUserInAnyGroup } from "../groups";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

const NOW = new Date("2026-05-24T00:00:00Z");

// Two terms: 26W has ended, 26S is still running as of NOW.
const ended = new Date("2026-03-01T00:00:00Z");
const running = new Date("2026-06-15T00:00:00Z");
const termEnds = new Map([
  ["26W", ended],
  ["26S", running],
]);

describe("isGroupArchived", () => {
  it("is archived when manually archived, regardless of terms", () => {
    expect(
      isGroupArchived({ archivedAt: new Date("2026-01-01"), boundTermIds: [] }, termEnds, NOW),
    ).toBe(true);
    // Manual archive overrides a still-running bound term.
    expect(
      isGroupArchived({ archivedAt: new Date("2026-01-01"), boundTermIds: ["26S"] }, termEnds, NOW),
    ).toBe(true);
  });

  it("is not archived when ongoing (no archive, no bound terms)", () => {
    expect(isGroupArchived({ archivedAt: null, boundTermIds: [] }, termEnds, NOW)).toBe(false);
  });

  it("auto-archives once the only bound term has ended", () => {
    expect(isGroupArchived({ archivedAt: null, boundTermIds: ["26W"] }, termEnds, NOW)).toBe(true);
  });

  it("stays active while a bound term is still running", () => {
    expect(isGroupArchived({ archivedAt: null, boundTermIds: ["26S"] }, termEnds, NOW)).toBe(false);
  });

  it("uses the latest bound term: active until the last term ends", () => {
    // Bound to both an ended and a running term — the running one keeps it active.
    expect(
      isGroupArchived({ archivedAt: null, boundTermIds: ["26W", "26S"] }, termEnds, NOW),
    ).toBe(false);
  });

  it("ignores unknown (deleted) term ids; falls back to not-archived if all unknown", () => {
    expect(
      isGroupArchived({ archivedAt: null, boundTermIds: ["gone"] }, termEnds, NOW),
    ).toBe(false);
    // A known-ended term still archives even alongside an unknown id.
    expect(
      isGroupArchived({ archivedAt: null, boundTermIds: ["gone", "26W"] }, termEnds, NOW),
    ).toBe(true);
  });
});

describe("isUserInAnyGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false for an empty id list without querying", async () => {
    expect(await isUserInAnyGroup("user-1", [])).toBe(false);
    expect(mockPrisma.groupDefinition.findMany).not.toHaveBeenCalled();
  });

  it("hits a static membership without resolving any dynamic group", async () => {
    mockPrisma.groupDefinition.findMany.mockResolvedValue([
      { type: "Dynamic", dynamicQuery: "domain:d1", staticMemberIds: [] },
      { type: "Static", dynamicQuery: null, staticMemberIds: ["user-1"] },
    ]);

    expect(await isUserInAnyGroup("user-1", ["g1", "g2"])).toBe(true);
    // Static pass short-circuits: the domain resolver never runs.
    expect(mockPrisma.domainEligibility.findMany).not.toHaveBeenCalled();
  });

  it("resolves dynamic groups when no static group matches", async () => {
    mockPrisma.groupDefinition.findMany.mockResolvedValue([
      { type: "Dynamic", dynamicQuery: "domain:d1", staticMemberIds: [] },
    ]);
    mockPrisma.domainEligibility.findMany.mockResolvedValue([
      { userId: "user-1" },
    ]);

    expect(await isUserInAnyGroup("user-1", ["g1"])).toBe(true);
  });

  it("returns false when no group admits the user", async () => {
    mockPrisma.groupDefinition.findMany.mockResolvedValue([
      { type: "Static", dynamicQuery: null, staticMemberIds: ["someone-else"] },
      { type: "Dynamic", dynamicQuery: "domain:d1", staticMemberIds: [] },
    ]);
    mockPrisma.domainEligibility.findMany.mockResolvedValue([]);

    expect(await isUserInAnyGroup("user-1", ["g1", "g2"])).toBe(false);
  });
});
