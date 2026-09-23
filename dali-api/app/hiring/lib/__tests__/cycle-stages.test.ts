import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { delibsQualifier } from "~/hiring/lib/cycle-stages.server";
import { STANDARD_TIMELINE, defaultTimeline, type Timeline } from "~/hiring/lib/cycle-timeline";

const mockPrisma = prisma as unknown as Record<string, any>;
const cycle = (timeline: Timeline) => ({ id: "cycle-1", timeline });
const REVIEWED_UNDECIDED = {
  reviews: { every: { submittedAt: { not: null } }, some: {} },
  decisions: { none: { stage: { in: ["Final", "Released"] } } },
};
const NO_OUTCOME = {
  decisions: {
    none: { type: { in: ["Accepted", "Waitlisted", "Rejected"] }, stage: { in: ["Final", "Released"] } },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.delibsSession = { findUnique: vi.fn() };
});

describe("delibsQualifier", () => {
  it("first round: every review in, no final decision", async () => {
    expect(await delibsQualifier(cycle(STANDARD_TIMELINE), "first", "d1")).toEqual(REVIEWED_UNDECIDED);
    expect(mockPrisma.delibsSession.findUnique).not.toHaveBeenCalled();
  });

  it("a round after Interviews: invited on the previous board and interviewed", async () => {
    mockPrisma.delibsSession.findUnique.mockResolvedValue({
      status: "Closed",
      columnOrder: { "No Decision": ["a"], Interview: ["b", "c"], Reject: ["d"] },
    });
    const where = await delibsQualifier(cycle(STANDARD_TIMELINE), "final", "d1");
    expect(where).toEqual({
      id: { in: ["b", "c"] },
      ...NO_OUTCOME,
      interviews: { some: { status: "Completed" } },
    });
    expect(mockPrisma.delibsSession.findUnique.mock.calls[0][0].where).toEqual({
      domainId_applicationCycleId_roundId: { domainId: "d1", applicationCycleId: "cycle-1", roundId: "first" },
    });
  });

  it("a round with no Interviews before it: whoever advanced, no interview needed", async () => {
    mockPrisma.delibsSession.findUnique.mockResolvedValue({
      status: "Closed",
      columnOrder: { Advance: ["b"] },
    });
    const t = defaultTimeline({ firstDelib: true, interviews: false });
    expect(await delibsQualifier(cycle(t), "final", "d1")).toEqual({ id: { in: ["b"] }, ...NO_OUTCOME });
  });

  it("qualifies nobody while the previous board is still open", async () => {
    mockPrisma.delibsSession.findUnique.mockResolvedValue({ status: "Active", columnOrder: { Interview: ["b"] } });
    const where = await delibsQualifier(cycle(STANDARD_TIMELINE), "final", "d1");
    expect(where.id).toEqual({ in: [] });
  });

  it("the only round is the first round", async () => {
    const t = defaultTimeline({ firstDelib: false, interviews: false });
    expect(await delibsQualifier(cycle(t), "final", "d1")).toEqual(REVIEWED_UNDECIDED);
  });

  it("an unknown round qualifies no one", async () => {
    expect(await delibsQualifier(cycle(STANDARD_TIMELINE), "gone", "d1")).toEqual({ id: { in: [] } });
  });
});
