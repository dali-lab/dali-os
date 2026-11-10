import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    customHire: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isLabMember: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isLabMember } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { action } from "~/routes/api.custom-hires";

const hire = vi.mocked(prisma.customHire);

function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({
    request: new Request("http://localhost/api/custom-hires", { method: "POST", body }),
    params: {},
    context: {},
  } as never) as Promise<Response>;
}

const logged = () => vi.mocked(logAuditEvent).mock.calls.map(([e]) => [e.action, e.userId, e.targetId, e.metadata]);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isLabMember).mockResolvedValue(true);
  hire.findUnique.mockResolvedValue(null);
});

describe("api.custom-hires audit trail", () => {
  it("logs a new role", async () => {
    hire.create.mockResolvedValue({ id: "ch-1" } as never);
    await post({ intent: "create", label: "Camp counselor" });
    expect(logged()).toEqual([["custom-hire.create", "u1", "ch-1", { label: "Camp counselor", revived: false }]]);
  });

  it("logs reviving an archived role, and nothing for one that is already active", async () => {
    hire.findUnique.mockResolvedValue({ id: "ch-2", archivedAt: new Date() } as never);
    await post({ intent: "create", label: "Tutor" });
    hire.findUnique.mockResolvedValue({ id: "ch-2", archivedAt: null } as never);
    await post({ intent: "create", label: "Tutor" });
    expect(logged()).toEqual([["custom-hire.create", "u1", "ch-2", { label: "Tutor", revived: true }]]);
  });

  it("logs a rename with the old and new label", async () => {
    hire.findFirst.mockResolvedValue({ label: "Old" } as never);
    hire.updateMany.mockResolvedValue({ count: 1 } as never);
    await post({ intent: "rename", id: "ch-1", label: "New" });
    expect(logged()).toEqual([["custom-hire.rename", "u1", "ch-1", { before: "Old", after: "New" }]]);
  });

  it("logs an archive", async () => {
    hire.updateMany.mockResolvedValue({ count: 1 } as never);
    await post({ intent: "archive", id: "ch-1" });
    expect(logged()).toEqual([["custom-hire.archive", "u1", "ch-1", undefined]]);
  });

  it("logs nothing for someone else's hire, an invalid label or a non-member", async () => {
    hire.findFirst.mockResolvedValue(null);
    hire.updateMany.mockResolvedValue({ count: 0 } as never);
    expect((await post({ intent: "rename", id: "theirs", label: "New" })).status).toBe(404);
    expect((await post({ intent: "archive", id: "theirs" })).status).toBe(404);
    expect((await post({ intent: "create", label: "" })).status).toBe(400);
    vi.mocked(isLabMember).mockResolvedValue(false);
    expect((await post({ intent: "create", label: "Tutor" })).status).toBe(403);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
