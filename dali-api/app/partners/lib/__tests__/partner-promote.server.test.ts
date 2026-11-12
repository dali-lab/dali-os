import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/github-slug", () => ({
  githubTeamSlug: (s: string) => s.toLowerCase().replace(/\s+/g, "-"),
}));
vi.mock("~/partners/lib/partner-activity.server", () => ({
  setApplicationStage: vi.fn().mockResolvedValue("New"),
}));
vi.mock("~/partners/lib/planning-notes.server", () => ({ movePlanningNoteToProject: vi.fn() }));
vi.mock("~/partners/lib/partner-returns.server", () => ({
  reopenProjectFromApplication: vi.fn().mockResolvedValue({ id: "proj-old" }),
}));

import { prisma } from "~/lib/db.server";
import { setApplicationStage } from "~/partners/lib/partner-activity.server";
import { movePlanningNoteToProject } from "~/partners/lib/planning-notes.server";
import { reopenProjectFromApplication } from "~/partners/lib/partner-returns.server";
import { promotePartnerApplication } from "../partner-promote.server";

const db = prisma as unknown as {
  partnerApplication: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const base = {
  id: "app-1",
  title: "AI Health Tool",
  iconEmoji: null,
  piUserId: null,
  summary: "A useful tool",
  resultingProjectId: null,
  continuesProjectId: null,
  partnerOrgId: "org-1",
  applicantContactId: "c1",
  applicantContact: { name: "Ada" },
  targetTerms: [] as { termId: string }[],
  domains: [] as { domainId: string; expectedMembers: number }[],
};

function makeTx() {
  return {
    project: { create: vi.fn().mockResolvedValue({ id: "proj-new", name: "AI Health Tool" }) },
    partnerOrg: {
      create: vi.fn().mockResolvedValue({ id: "org-new" }),
      update: vi.fn(),
    },
    partnerMembership: { create: vi.fn().mockResolvedValue({ id: "mem-1" }) },
  };
}

function useTx(tx: ReturnType<typeof makeTx>) {
  db.$transaction = vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx));
}

beforeEach(() => {
  vi.clearAllMocks();
  db.partnerApplication = { findUnique: vi.fn() };
});

describe("promotePartnerApplication", () => {
  it("throws NotFound for a missing application", async () => {
    db.partnerApplication.findUnique.mockResolvedValue(null);
    await expect(
      promotePartnerApplication({ applicationId: "x", actorUserId: "u1" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("is idempotent when the application already has a project", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ ...base, resultingProjectId: "proj-existing" });
    db.$transaction = vi.fn();
    const out = await promotePartnerApplication({ applicationId: "app-1", actorUserId: "u1" });
    expect(out).toEqual({ projectId: "proj-existing", alreadyExisted: true });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("creates the project, stages it with the request, and moves the planning note", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ ...base, targetTerms: [{ termId: "t26f" }] });
    const tx = makeTx();
    useTx(tx);
    const request = new Request("http://localhost/x");
    const out = await promotePartnerApplication({ applicationId: "app-1", actorUserId: "u1", request });
    expect(out).toEqual({ projectId: "proj-new", name: "AI Health Tool", alreadyExisted: false });
    expect(setApplicationStage).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        applicationId: "app-1",
        to: "Accepted",
        actorUserId: "u1",
        request,
        data: { resultingProjectId: "proj-new", partnerOrgId: "org-1" },
        meta: { projectId: "proj-new" },
      }),
    );
    expect(movePlanningNoteToProject).toHaveBeenCalledWith(tx, {
      applicationId: "app-1",
      projectId: "proj-new",
    });
  });

  it("creates role requests for the first target term only", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      ...base,
      targetTerms: [{ termId: "t26f" }, { termId: "t27w" }],
      domains: [
        { domainId: "ml", expectedMembers: 2 },
        { domainId: "web", expectedMembers: 0 },
      ],
    });
    const tx = makeTx();
    useTx(tx);
    await promotePartnerApplication({ applicationId: "app-1", actorUserId: "u1" });
    const data = tx.project.create.mock.calls[0][0].data;
    expect(data.roleRequests.create).toEqual([
      { termId: "t26f", domainId: "ml", level: "P1", slots: 2 },
    ]);
    expect(data.projectTerms.create).toEqual({ termId: "t26f", piUserId: null });
    expect(data.domains.create).toEqual([{ domainId: "ml" }]);
  });

  it("carries the icon and PI onto the project", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      ...base,
      iconEmoji: "🚀",
      piUserId: "core-1",
      targetTerms: [{ termId: "t26f" }],
    });
    const tx = makeTx();
    useTx(tx);
    await promotePartnerApplication({ applicationId: "app-1", actorUserId: "u1" });
    const data = tx.project.create.mock.calls[0][0].data;
    expect(data.iconEmoji).toBe("🚀");
    expect(data.githubTeamSlug).toBe("ai-health-tool");
    expect(data.projectTerms.create).toEqual({ termId: "t26f", piUserId: "core-1" });
  });

  it("creates no terms, role requests or domains without target terms", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({
      ...base,
      domains: [{ domainId: "ml", expectedMembers: 2 }],
    });
    const tx = makeTx();
    useTx(tx);
    await promotePartnerApplication({ applicationId: "app-1", actorUserId: "u1" });
    const data = tx.project.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("projectTerms");
    expect(data).not.toHaveProperty("roleRequests");
    expect(data).not.toHaveProperty("domains");
  });

  it("creates the org, membership and primary contact for account-first applications", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ ...base, partnerOrgId: null });
    const tx = makeTx();
    useTx(tx);
    await promotePartnerApplication({ applicationId: "app-1", actorUserId: "u1" });
    expect(tx.partnerOrg.create).toHaveBeenCalledWith({
      data: { name: "Ada", isIndividual: true },
      select: { id: true },
    });
    expect(tx.partnerMembership.create).toHaveBeenCalledWith({
      data: { contactId: "c1", orgId: "org-new" },
      select: { id: true },
    });
    expect(tx.partnerOrg.update).toHaveBeenCalledWith({
      where: { id: "org-new" },
      data: { primaryContactId: "mem-1" },
    });
    expect(tx.project.create.mock.calls[0][0].data.partners).toEqual({
      create: { partnerOrgId: "org-new" },
    });
  });

  it("names the org and marks it not individual when orgName is given", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ ...base, partnerOrgId: null });
    const tx = makeTx();
    useTx(tx);
    await promotePartnerApplication({ applicationId: "app-1", orgName: "  Acme  ", actorUserId: "u1" });
    expect(tx.partnerOrg.create).toHaveBeenCalledWith({
      data: { name: "Acme", isIndividual: false },
      select: { id: true },
    });
  });

  describe("returning project", () => {
    const returning = {
      ...base,
      continuesProjectId: "proj-old",
      piUserId: "pi-1",
      targetTerms: [{ termId: "t27w" }, { termId: "t27s" }],
      domains: [{ domainId: "eng", expectedMembers: 2 }],
    };

    it("reopens the old project, passing the request", async () => {
      db.partnerApplication.findUnique.mockResolvedValue(returning);
      const tx = makeTx();
      useTx(tx);
      const request = new Request("http://localhost/x");
      const out = await promotePartnerApplication({ applicationId: "app-1", actorUserId: "u1", request });
      expect(out).toEqual({ projectId: "proj-old", alreadyExisted: false, reopened: true });
      expect(tx.project.create).not.toHaveBeenCalled();
      expect(reopenProjectFromApplication).toHaveBeenCalledWith(tx, {
        app: {
          id: "app-1",
          continuesProjectId: "proj-old",
          partnerOrgId: "org-1",
          piUserId: "pi-1",
          targetTermIds: ["t27w", "t27s"],
          domains: [{ domainId: "eng", expectedMembers: 2 }],
        },
        actorUserId: "u1",
        request,
      });
    });

    it("rejects zero target terms", async () => {
      db.partnerApplication.findUnique.mockResolvedValue({ ...returning, targetTerms: [] });
      db.$transaction = vi.fn();
      await expect(
        promotePartnerApplication({ applicationId: "app-1", actorUserId: "u1" }),
      ).rejects.toMatchObject({
        status: 400,
        message: "Set at least one target term before reopening the project.",
      });
      expect(db.$transaction).not.toHaveBeenCalled();
    });
  });
});
