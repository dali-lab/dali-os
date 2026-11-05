import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    partnerApplication: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    partnerContact: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/partners/lib/partner-returns.server", () => ({ startProjectReturn: vi.fn() }));
vi.mock("~/partners/lib/application-form.server", () => ({
  setApplicationFormBinding: vi.fn(),
  clearApplicationFormBinding: vi.fn(),
}));
vi.mock("~/partners/lib/partner-activity.server", () => ({
  setApplicationStage: vi.fn(),
  logPartnerActivity: vi.fn(),
}));
vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  function requireForAction(action: string, args: Record<string, unknown>, spec: Record<string, string[]>) {
    const required = spec[action];
    if (!required) throw new McpInvalidError(`Unknown action '${action}'`);
    const missing = required.filter((k) => args[k] === undefined || args[k] === null);
    if (missing.length) throw new McpInvalidError(`action '${action}' requires: ${missing.join(", ")}`);
  }
  return { McpError, McpForbiddenError, McpNotFoundError, McpInvalidError, requireForAction, REGISTRY_TOOLS: [], findRegistryTool: () => undefined, registryToolDefs: () => [] };
});

import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { startProjectReturn } from "~/partners/lib/partner-returns.server";
import { MANAGE_PARTNER_APPLICATION_TOOL, runManagePartnerApplication } from "../manage-partner-application";

const db = prisma as unknown as {
  partnerApplication: Record<string, ReturnType<typeof vi.fn>>;
  partnerContact: Record<string, ReturnType<typeof vi.fn>>;
  project: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
});

describe("manage_partner_application schema", () => {
  it("adds start_return and delete without dropping existing actions", () => {
    const actions = (MANAGE_PARTNER_APPLICATION_TOOL.inputSchema.properties.action as { enum: string[] }).enum;
    expect(actions).toEqual(expect.arrayContaining(["create", "update_stage", "remove_domain", "start_return", "delete"]));
  });
});

describe("start_return", () => {
  it("opens a return for the project and terms", async () => {
    vi.mocked(startProjectReturn).mockResolvedValue({ ok: true, applicationId: "app-9" });
    const out = await runManagePartnerApplication("core-1", {
      action: "start_return",
      projectId: "proj-1",
      targetTermIds: ["t27w"],
    });
    expect(out).toEqual({ id: "app-9" });
    expect(startProjectReturn).toHaveBeenCalledWith({ projectId: "proj-1", targetTermIds: ["t27w"], actorUserId: "core-1" });
  });

  it.each([
    ["not-found", "McpNotFoundError"],
    ["no-contact", "McpInvalidError"],
    ["already-open", "McpInvalidError"],
    ["no-terms", "McpInvalidError"],
  ] as const)("maps %s to %s", async (error, name) => {
    vi.mocked(startProjectReturn).mockResolvedValue({ ok: false, error });
    await expect(
      runManagePartnerApplication("core-1", { action: "start_return", projectId: "proj-1", targetTermIds: [] }),
    ).rejects.toMatchObject({ name });
  });

  it("rejects non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManagePartnerApplication("u1", { action: "start_return", projectId: "p", targetTermIds: ["t"] }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
    expect(startProjectReturn).not.toHaveBeenCalled();
  });
});

describe("delete", () => {
  it("deletes an application that never became a project and audits it", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ id: "a1", title: "Renew: Deserto", stage: "Rejected", resultingProjectId: null });
    const out = await runManagePartnerApplication("core-1", { action: "delete", applicationId: "a1" });
    expect(out).toEqual({ deleted: true, id: "a1", title: "Renew: Deserto" });
    expect(db.partnerApplication.delete).toHaveBeenCalledWith({ where: { id: "a1" } });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "partner.application.delete", userId: "core-1", targetId: "a1" }),
    );
  });

  it("refuses to delete a promoted application", async () => {
    db.partnerApplication.findUnique.mockResolvedValue({ id: "a1", title: "X", stage: "Accepted", resultingProjectId: "p1" });
    await expect(runManagePartnerApplication("core-1", { action: "delete", applicationId: "a1" })).rejects.toMatchObject({
      name: "McpInvalidError",
    });
    expect(db.partnerApplication.delete).not.toHaveBeenCalled();
  });

  it("404s a missing application", async () => {
    db.partnerApplication.findUnique.mockResolvedValue(null);
    await expect(runManagePartnerApplication("core-1", { action: "delete", applicationId: "gone" })).rejects.toMatchObject({
      name: "McpNotFoundError",
    });
  });
});

describe("create with continuesProjectId", () => {
  beforeEach(() => {
    db.partnerContact.findUnique.mockResolvedValue({ id: "c1" });
    db.partnerApplication.create.mockResolvedValue({ id: "new-app" });
  });

  it("marks the application as a return of the project", async () => {
    db.project.findUnique.mockResolvedValue({ id: "proj-1" });
    await runManagePartnerApplication("core-1", {
      action: "create",
      title: "Research Computing",
      applicantContactId: "c1",
      continuesProjectId: "proj-1",
    });
    expect(db.partnerApplication.create.mock.calls[0][0].data).toMatchObject({
      continuesProjectId: "proj-1",
      source: "Renewal",
    });
  });

  it("stays a plain manual application without it", async () => {
    await runManagePartnerApplication("core-1", { action: "create", title: "ITC", applicantContactId: "c1" });
    expect(db.partnerApplication.create.mock.calls[0][0].data).toMatchObject({ continuesProjectId: null, source: "Manual" });
    expect(db.project.findUnique).not.toHaveBeenCalled();
  });

  it("404s an unknown project", async () => {
    db.project.findUnique.mockResolvedValue(null);
    await expect(
      runManagePartnerApplication("core-1", {
        action: "create",
        title: "X",
        applicantContactId: "c1",
        continuesProjectId: "gone",
      }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
    expect(db.partnerApplication.create).not.toHaveBeenCalled();
  });
});
