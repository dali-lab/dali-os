import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { deleteMentorshipPairs, reassignMentorshipPair, upsertMentorshipPair } from "../pairs.server";

type Fn = ReturnType<typeof vi.fn>;
const pairs = (prisma as unknown as {
  mentorshipPair: Record<"findMany" | "findUnique" | "findFirst" | "create" | "update" | "delete" | "deleteMany", Fn>;
}).mentorshipPair;

const request = new Request("http://localhost/x");
const base = { menteeUserId: "m1", mentorUserId: "k1", projectId: "p1", termId: "t1", domainId: "d1", actorId: "u1", request };

beforeEach(() => vi.clearAllMocks());

describe("upsertMentorshipPair", () => {
  it("creates a manual pair and audits it", async () => {
    pairs.findMany.mockResolvedValue([]);
    pairs.create.mockResolvedValue({ id: "x1" });
    expect(await upsertMentorshipPair(base)).toEqual({ id: "x1", created: true });
    expect(pairs.create.mock.calls[0]![0].data).toMatchObject({ manual: true, mentorUserId: "k1" });
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "mentorship.pair.create",
      userId: "u1",
      targetId: "x1",
      metadata: { menteeUserId: "m1", mentorUserId: "k1", projectId: "p1", termId: "t1", domainId: "d1" },
      request,
    });
  });

  it("reassigns the first row and collapses extras", async () => {
    pairs.findMany.mockResolvedValue([
      { id: "a", mentorUserId: "old" },
      { id: "b", mentorUserId: "o2" },
      { id: "c", mentorUserId: "o3" },
    ]);
    pairs.update.mockResolvedValue({ id: "a" });
    expect(await upsertMentorshipPair(base)).toEqual({ id: "a", created: false });
    expect(pairs.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["b", "c"] } } });
    expect(pairs.update).toHaveBeenCalledWith({ where: { id: "a" }, data: { mentorUserId: "k1", manual: true }, select: { id: true } });
    expect(vi.mocked(logAuditEvent).mock.calls[0]![0]).toMatchObject({
      action: "mentorship.pair.update",
      metadata: expect.objectContaining({ fromMentorUserId: "old", toMentorUserId: "k1", collapsedExtras: 2 }),
    });
  });
});

describe("reassignMentorshipPair", () => {
  const row = { menteeUserId: "m1", mentorUserId: "old", projectId: "p1", termId: "t1", domainId: "d1" };

  it("returns null for an unknown pair", async () => {
    pairs.findUnique.mockResolvedValue(null);
    expect(await reassignMentorshipPair({ id: "a", mentorUserId: "k1", actorId: "u1" })).toBeNull();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("merges into an existing identical pair", async () => {
    pairs.findUnique.mockResolvedValue(row);
    pairs.findFirst.mockResolvedValue({ id: "other" });
    expect(await reassignMentorshipPair({ id: "a", mentorUserId: "k1", actorId: "u1", request })).toEqual({ id: "other", merged: true });
    expect(pairs.delete).toHaveBeenCalledWith({ where: { id: "a" } });
    expect(vi.mocked(logAuditEvent).mock.calls[0]![0]).toMatchObject({
      targetId: "other",
      metadata: { menteeUserId: "m1", fromMentorUserId: "old", toMentorUserId: "k1", mergedFromPairId: "a" },
    });
  });

  it("updates in place and marks the pair manual", async () => {
    pairs.findUnique.mockResolvedValue(row);
    pairs.findFirst.mockResolvedValue(null);
    pairs.update.mockResolvedValue({ id: "a" });
    expect(await reassignMentorshipPair({ id: "a", mentorUserId: "k1", actorId: "u1" })).toEqual({ id: "a", merged: false });
    expect(pairs.update).toHaveBeenCalledWith({ where: { id: "a" }, data: { mentorUserId: "k1", manual: true }, select: { id: true } });
    expect(pairs.delete).not.toHaveBeenCalled();
  });
});

describe("deleteMentorshipPairs", () => {
  it("returns the count and audits the ids", async () => {
    pairs.deleteMany.mockResolvedValue({ count: 2 });
    expect(await deleteMentorshipPairs({ ids: ["a", "b"], actorId: "u1", request })).toEqual({ deleted: 2 });
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "mentorship.pair.delete",
      userId: "u1",
      targetId: "a",
      metadata: { ids: ["a", "b"], deleted: 2 },
      request,
    });
  });
});
