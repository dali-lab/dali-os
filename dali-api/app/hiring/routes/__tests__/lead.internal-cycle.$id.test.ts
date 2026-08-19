import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn((_req: Request) => Response.json({ error: "Forbidden" }, { status: 403 })),
  unauthorized: vi.fn((_req: Request) => Response.json({ error: "Unauthorized" }, { status: 401 })),
}));
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { action } from "~/hiring/routes/lead.internal-cycle.$id";

const CORE_ID = "core-1";
const CYCLE_ID = "cycle-1";

const mockPrisma = prisma as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.applicationCycle = {
    update: vi.fn().mockResolvedValue({}),
  };
  mockPrisma.signingBinding = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  };
  mockPrisma.signingDocumentVersion = {
    findUnique: vi.fn().mockResolvedValue({ documentId: "doc-1" }),
  };

  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: CORE_ID, email: "core@x.com", type: "user" },
  } as any);
  vi.mocked(isCore).mockResolvedValue(true);
});

function makeRequest(form: Record<string, string>) {
  const body = new URLSearchParams(form);
  return new Request(`http://localhost/hiring/lead/internal-cycle/${CYCLE_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

function callAction(form: Record<string, string>) {
  return action({
    request: makeRequest(form),
    params: { id: CYCLE_ID },
    context: {},
  } as any);
}

describe("lead.internal-cycle.$id action — set-close-date", () => {
  it("returns 403 when caller is not core", async () => {
    vi.mocked(isCore).mockResolvedValueOnce(false);
    const res = await callAction({ intent: "set-close-date", closeDate: "2026-06-01" });
    expect((res as Response).status).toBe(403);
    expect(mockPrisma.applicationCycle.update).not.toHaveBeenCalled();
  });

  it("stores the picked date as 11:59:59 PM ET (EDT) as a UTC instant", async () => {
    // Use a far-future date so the route's "past close date" guard doesn't trip
    // and pull in prisma.applicationCycleStatusUpdate.findFirst.
    await callAction({ intent: "set-close-date", closeDate: "2099-06-01" });

    expect(mockPrisma.applicationCycle.update).toHaveBeenCalledTimes(1);
    const updateArgs = mockPrisma.applicationCycle.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: CYCLE_ID });
    const stored = updateArgs.data.closeDate as Date;
    expect(stored).toBeInstanceOf(Date);
    // 2099-06-01 23:59:59 EDT (UTC-4) === 2099-06-02 03:59:59 UTC.
    expect(stored.toISOString()).toBe("2099-06-02T03:59:59.000Z");
  });

  it("clears the close date when the picker is empty", async () => {
    await callAction({ intent: "set-close-date", closeDate: "" });

    expect(mockPrisma.applicationCycle.update).toHaveBeenCalledTimes(1);
    const updateArgs = mockPrisma.applicationCycle.update.mock.calls[0][0];
    expect(updateArgs.data.closeDate).toBeNull();
  });
});

describe("lead.internal-cycle.$id action — set-confidentiality-agreement", () => {
  it("returns 403 when caller is not core", async () => {
    vi.mocked(isCore).mockResolvedValueOnce(false);
    const res = await callAction({
      intent: "set-confidentiality-agreement",
      confidentialityAgreementVersionId: "ver-1",
    });
    expect((res as Response).status).toBe(403);
    expect(mockPrisma.signingBinding.create).not.toHaveBeenCalled();
  });

  it("creates a binding scoped to the cycle when none exists", async () => {
    mockPrisma.signingBinding.findFirst.mockResolvedValueOnce(null);
    await callAction({
      intent: "set-confidentiality-agreement",
      confidentialityAgreementVersionId: "ver-1",
    });

    expect(mockPrisma.signingBinding.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.signingBinding.create.mock.calls[0][0].data).toEqual({
      documentId: "doc-1",
      versionId: "ver-1",
      scopeKey: `cycle:${CYCLE_ID}`,
      cycleId: CYCLE_ID,
    });
    expect(mockPrisma.signingBinding.update).not.toHaveBeenCalled();
  });

  it("updates the existing binding in place on a rebind", async () => {
    mockPrisma.signingBinding.findFirst.mockResolvedValueOnce({ id: "bind-1" });
    await callAction({
      intent: "set-confidentiality-agreement",
      confidentialityAgreementVersionId: "ver-2",
    });

    expect(mockPrisma.signingBinding.update).toHaveBeenCalledTimes(1);
    const updateArgs = mockPrisma.signingBinding.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: "bind-1" });
    expect(updateArgs.data).toEqual({
      versionId: "ver-2",
      documentId: "doc-1",
      scopeKey: `cycle:${CYCLE_ID}`,
    });
    expect(mockPrisma.signingBinding.create).not.toHaveBeenCalled();
  });

  it("deletes the binding when the picker is cleared", async () => {
    mockPrisma.signingBinding.findFirst.mockResolvedValueOnce({ id: "bind-1" });
    await callAction({
      intent: "set-confidentiality-agreement",
      confidentialityAgreementVersionId: "",
    });

    expect(mockPrisma.signingBinding.delete).toHaveBeenCalledTimes(1);
    expect(mockPrisma.signingBinding.delete.mock.calls[0][0]).toEqual({
      where: { id: "bind-1" },
    });
    expect(mockPrisma.signingDocumentVersion.findUnique).not.toHaveBeenCalled();
  });

  it("no-ops when clearing an already-unbound cycle", async () => {
    mockPrisma.signingBinding.findFirst.mockResolvedValueOnce(null);
    await callAction({
      intent: "set-confidentiality-agreement",
      confidentialityAgreementVersionId: "",
    });

    expect(mockPrisma.signingBinding.delete).not.toHaveBeenCalled();
    expect(mockPrisma.signingBinding.create).not.toHaveBeenCalled();
  });
});
