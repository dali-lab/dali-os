import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { partnerApplication: { findUnique: vi.fn(), delete: vi.fn() } },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { deletePartnerApplication } from "../partner-application-delete.server";

const db = prisma as unknown as {
  partnerApplication: { findUnique: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deletePartnerApplication", () => {
  it("deletes an application that never became a project and audits who did it", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      id: "a1",
      title: "Oops duplicate",
      stage: "New",
      resultingProjectId: null,
    });
    const request = new Request("http://localhost/core/partners/applications/a1", { method: "POST" });
    const out = await deletePartnerApplication("a1", "core-1", request);
    expect(out).toEqual({ ok: true, id: "a1", title: "Oops duplicate" });
    expect(db.partnerApplication.delete).toHaveBeenCalledWith({ where: { id: "a1" } });
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "partner.application.delete",
      userId: "core-1",
      targetId: "a1",
      metadata: { title: "Oops duplicate", stage: "New" },
      request,
    });
  });

  it.each(["Backlog", "Interview", "Deciding", "Accepted", "Rejected"])(
    "deletes an unpromoted application in %s",
    async (stage) => {
      db.partnerApplication.findUnique.mockResolvedValue({ id: "a1", title: "T", stage, resultingProjectId: null });
      expect((await deletePartnerApplication("a1", "core-1")).ok).toBe(true);
      expect(db.partnerApplication.delete).toHaveBeenCalledTimes(1);
    },
  );

  it("refuses an application that became a project", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      id: "a1",
      title: "Shipped",
      stage: "Accepted",
      resultingProjectId: "p1",
    });
    expect(await deletePartnerApplication("a1", "core-1")).toEqual({
      ok: false,
      reason: "promoted",
      message: "This application became a project, so it can't be deleted.",
    });
    expect(db.partnerApplication.delete).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("reports a missing application without deleting anything", async () => {
    db.partnerApplication.findUnique.mockResolvedValue(null);
    expect(await deletePartnerApplication("gone", "core-1")).toMatchObject({ ok: false, reason: "not-found" });
    expect(db.partnerApplication.delete).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
