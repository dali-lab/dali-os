import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    user: { findUniqueOrThrow: vi.fn() },
    term: { findUnique: vi.fn() },
    applicationCycle: { create: vi.fn() },
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles");
vi.mock("~/hiring/lib/cycle-applicants.server", () => ({ linkCoreDomain: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin, isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { action } from "~/hiring/routes/lead";

function create(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({
    request: new Request("http://localhost/hiring/lead", { method: "POST", body }),
    params: {},
    context: {},
  } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(isAdmin).mockResolvedValue(true);
  vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({ id: "u1" } as never);
  vi.mocked(prisma.applicationCycle.create).mockResolvedValue({ id: "cycle-9" } as never);
});

describe("lead action: cycle create", () => {
  it("logs the new cycle with its name and applicant group", async () => {
    await create({ name: "27W Hiring", applicants: "Students" });

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "cycle.create",
        userId: "u1",
        targetId: "cycle-9",
        metadata: { name: "27W Hiring", applicants: "Students", termId: null },
      }),
    );
  });

  it("logs nothing without a name or without permission", async () => {
    await create({ name: "  ", applicants: "Students" });
    vi.mocked(isCore).mockResolvedValue(false);
    await create({ name: "27W Hiring", applicants: "Students" });

    expect(prisma.applicationCycle.create).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
