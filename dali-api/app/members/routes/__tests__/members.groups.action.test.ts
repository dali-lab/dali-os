import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => Response.json({ error: "Forbidden" }, { status: 403 })),
}));
vi.mock("~/lib/roles", () => ({
  canViewForms: vi.fn(),
  currentTermMemberWhere: vi.fn(),
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { canViewForms } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { action } from "~/members/routes/members.groups";

const ACTOR = "actor-1";
const mockPrisma = prisma as any;

function run(body: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(body)) fd.append(k, v);
  return action({
    request: new Request("http://localhost/members/groups", { method: "POST", body: fd }),
    params: {},
    context: {},
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: ACTOR } } as any);
  vi.mocked(canViewForms).mockResolvedValue(true);
  mockPrisma.term = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.groupDefinition = {
    create: vi.fn().mockResolvedValue({ id: "g1" }),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
});

describe("members.groups action audit", () => {
  it("create-group logs group.create", async () => {
    await run({ intent: "create-group", name: "Crew", memberIds: "a,b" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "group.create",
        userId: ACTOR,
        targetId: "g1",
        metadata: { name: "Crew", memberCount: 2 },
      }),
    );
  });

  it("delete-group logs group.delete with the name", async () => {
    mockPrisma.groupDefinition.findUnique.mockResolvedValue({ systemKey: null, name: "Crew" });
    await run({ intent: "delete-group", groupId: "g1" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "group.delete",
        targetId: "g1",
        metadata: { name: "Crew" },
      }),
    );
  });

  it("does not log a rejected delete of a system group", async () => {
    mockPrisma.groupDefinition.findUnique.mockResolvedValue({ systemKey: "core", name: "Core" });
    await run({ intent: "delete-group", groupId: "g1" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["archive-group", true],
    ["unarchive-group", false],
  ])("%s logs group.update with archived=%s", async (intent, archived) => {
    mockPrisma.groupDefinition.findUnique.mockResolvedValue({ systemKey: null });
    await run({ intent, groupId: "g1" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "group.update",
        targetId: "g1",
        metadata: { archived },
      }),
    );
  });

  it("add-member logs group.member.add and skips an existing member", async () => {
    mockPrisma.groupDefinition.findUnique.mockResolvedValue({
      type: "Static",
      staticMemberIds: ["a"],
    });
    await run({ intent: "add-member", groupId: "g1", userId: "b" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "group.member.add",
        targetId: "g1",
        metadata: { memberId: "b", memberCount: 2 },
      }),
    );
    vi.mocked(logAuditEvent).mockClear();
    await run({ intent: "add-member", groupId: "g1", userId: "a" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("remove-member logs group.member.remove and skips a non-member", async () => {
    mockPrisma.groupDefinition.findUnique.mockResolvedValue({
      type: "Static",
      staticMemberIds: ["a", "b"],
    });
    await run({ intent: "remove-member", groupId: "g1", userId: "b" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "group.member.remove",
        targetId: "g1",
        metadata: { memberId: "b", memberCount: 1 },
      }),
    );
    vi.mocked(logAuditEvent).mockClear();
    await run({ intent: "remove-member", groupId: "g1", userId: "zzz" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
