import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import { loadFormHiringLinks, unlinkHiringForm } from "~/hiring/lib/form-links.server";

const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.applicationCycle = { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() };
  db.cycleDomainForm = { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn(), delete: vi.fn() };
  db.applicationCycleStatusUpdate = { findFirst: vi.fn().mockResolvedValue(null) };
  db.domainApplication = { count: vi.fn().mockResolvedValue(0) };
});

describe("loadFormHiringLinks", () => {
  it("lists application and challenge links, locking any cycle past Draft", async () => {
    db.applicationCycle.findMany.mockResolvedValue([
      { id: "c1", name: "26F", statusUpdates: [{ newStatus: "Open" }] },
      { id: "c2", name: "27W", statusUpdates: [] },
    ]);
    db.cycleDomainForm.findMany.mockResolvedValue([
      {
        id: "cdf1",
        applicationCycle: { id: "c1", name: "26F", statusUpdates: [{ newStatus: "Draft" }] },
        domain: { displayName: "Design" },
      },
    ]);

    const links = await loadFormHiringLinks("f1");

    expect(links).toEqual([
      {
        linkType: "application",
        label: "26F — application form",
        cycleId: "c1",
        cycleName: "26F",
        cycleStatus: "Open",
        locked: true,
        lockReason: "Cycle is no longer a draft",
      },
      {
        linkType: "application",
        label: "27W — application form",
        cycleId: "c2",
        cycleName: "27W",
        cycleStatus: "Draft",
        locked: false,
        lockReason: undefined,
      },
      {
        linkType: "challenge",
        label: "26F — Design challenge",
        cycleId: "c1",
        cycleName: "26F",
        cycleStatus: "Draft",
        cycleDomainFormId: "cdf1",
        domainName: "Design",
        locked: false,
        lockReason: undefined,
      },
    ]);
  });

  it("looks up links by this form id on both tables", async () => {
    await loadFormHiringLinks("f1");

    expect(db.applicationCycle.findMany.mock.calls[0][0].where).toEqual({ applicationFormId: "f1" });
    expect(db.cycleDomainForm.findMany.mock.calls[0][0].where).toEqual({ formId: "f1" });
  });
});

describe("unlinkHiringForm, application form", () => {
  it("clears the cycle's application form while the cycle is a draft", async () => {
    const res = await unlinkHiringForm({ linkType: "application", cycleId: "c1" }, "u1");

    expect(res).toEqual({ ok: true });
    expect(db.applicationCycle.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { applicationFormId: null } });
  });

  it("requires a cycle id", async () => {
    expect(await unlinkHiringForm({ linkType: "application" }, "u1")).toEqual({
      error: "cycleId is required for application unlink",
    });
    expect(db.applicationCycle.update).not.toHaveBeenCalled();
  });

  it("refuses once the latest status is past Draft", async () => {
    db.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Open" });

    expect(await unlinkHiringForm({ linkType: "application", cycleId: "c1" }, "u1")).toEqual({
      error: "Cannot unlink — cycle is no longer a draft",
    });
    expect(db.applicationCycle.update).not.toHaveBeenCalled();
  });
});

describe("unlinkHiringForm, challenge form", () => {
  beforeEach(() => {
    db.cycleDomainForm.findUnique.mockResolvedValue({ id: "cdf1", formId: "f1", applicationCycleId: "c1" });
  });

  it("deletes the link when the cycle is a draft and nobody answered it", async () => {
    const res = await unlinkHiringForm({ linkType: "challenge", cycleDomainFormId: "cdf1" }, "u1");

    expect(res).toEqual({ ok: true });
    expect(db.cycleDomainForm.delete).toHaveBeenCalledWith({ where: { id: "cdf1" } });
  });

  it("requires a link id", async () => {
    expect(await unlinkHiringForm({ linkType: "challenge" }, "u1")).toEqual({
      error: "cycleDomainFormId is required for challenge unlink",
    });
  });

  it("reports a missing link", async () => {
    db.cycleDomainForm.findUnique.mockResolvedValue(null);

    expect(await unlinkHiringForm({ linkType: "challenge", cycleDomainFormId: "cdf1" }, "u1")).toEqual({
      error: "Challenge form link not found",
    });
  });

  it("refuses once the cycle is past Draft", async () => {
    db.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "UnderReview" });

    const res = await unlinkHiringForm({ linkType: "challenge", cycleDomainFormId: "cdf1" }, "u1");

    expect(res).toEqual({ error: "Cannot unlink — cycle is no longer a draft" });
    expect(db.cycleDomainForm.delete).not.toHaveBeenCalled();
  });

  it("refuses when an applicant in that cycle already answered a version of the form", async () => {
    db.domainApplication.count.mockResolvedValue(2);

    const res = await unlinkHiringForm({ linkType: "challenge", cycleDomainFormId: "cdf1" }, "u1");

    expect(res).toEqual({ error: "Cannot unlink — this challenge form has already been answered by applicants" });
    expect(db.domainApplication.count).toHaveBeenCalledWith({
      where: { challengeFormVersion: { formId: "f1" }, application: { applicationCycleId: "c1" } },
    });
    expect(db.cycleDomainForm.delete).not.toHaveBeenCalled();
  });
});
