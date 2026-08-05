import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    emailTemplate: {
      create: vi.fn(),
      update: vi.fn(),
    },
    emailTemplateVersion: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    dALIMember: {
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  runManageEmailTemplate,
  MANAGE_EMAIL_TEMPLATE_TOOL,
} from "~/mcp/tools/admin/manage-email-template";
import type { McpCtx } from "~/mcp/registry";

const mockPrisma = prisma as unknown as {
  emailTemplate: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  emailTemplateVersion: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  dALIMember: { findUnique: ReturnType<typeof vi.fn> };
};

function makeCtx(userId = "u-core"): McpCtx {
  return {
    user: {
      id: userId,
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
      firstName: "Core",
      lastName: "Lead",
    },
    scopes: ["mcp:admin"],
    request: new Request("http://localhost/"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manage_email_template", () => {
  it("requires the mcp:admin scope", () => {
    expect(MANAGE_EMAIL_TEMPLATE_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws McpForbiddenError when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);

    await expect(
      runManageEmailTemplate(makeCtx(), { action: "create", name: "Test" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError", status: 403 });
  });

  describe("action: create", () => {
    it("creates a template and returns it", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.emailTemplate.create.mockResolvedValue({
        id: "tmpl-new",
        name: "New Template",
        createdAt: new Date(),
      });

      const out = await runManageEmailTemplate(makeCtx(), {
        action: "create",
        name: "New Template",
      });
      expect(out).toMatchObject({ id: "tmpl-new", name: "New Template" });
      expect(mockPrisma.emailTemplate.create).toHaveBeenCalledWith({
        data: { name: "New Template" },
      });
    });

    it("throws McpInvalidError when name is missing for create", async () => {
      vi.mocked(isCore).mockResolvedValue(true);

      await expect(
        runManageEmailTemplate(makeCtx(), { action: "create" }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
    });
  });

  describe("action: update", () => {
    it("renames a template when only name is provided", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.emailTemplate.update.mockResolvedValue(undefined);

      const out = await runManageEmailTemplate(makeCtx(), {
        action: "update",
        templateId: "tmpl-1",
        name: "Renamed Template",
      });
      expect(out).toMatchObject({ ok: true });
      expect(mockPrisma.emailTemplate.update).toHaveBeenCalledWith({
        where: { id: "tmpl-1" },
        data: { name: "Renamed Template" },
      });
      expect(mockPrisma.emailTemplateVersion.create).not.toHaveBeenCalled();
    });

    it("creates a new version when subject is provided", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.dALIMember.findUnique.mockResolvedValue({ id: "m1", userId: "u-core" });
      mockPrisma.emailTemplateVersion.findFirst.mockResolvedValue({ versionNumber: 2 });
      mockPrisma.emailTemplateVersion.create.mockResolvedValue(undefined);

      const out = await runManageEmailTemplate(makeCtx(), {
        action: "update",
        templateId: "tmpl-1",
        subject: "Updated Subject",
        body: "<p>Updated</p>",
      });
      expect(out).toMatchObject({ ok: true });
      expect(mockPrisma.emailTemplateVersion.create).toHaveBeenCalledWith({
        data: {
          templateId: "tmpl-1",
          versionNumber: 3,
          subject: "Updated Subject",
          body: "<p>Updated</p>",
          createdById: "u-core",
        },
      });
    });

    it("defaults body to empty string when not provided", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.dALIMember.findUnique.mockResolvedValue({ id: "m1", userId: "u-core" });
      mockPrisma.emailTemplateVersion.findFirst.mockResolvedValue(null);
      mockPrisma.emailTemplateVersion.create.mockResolvedValue(undefined);

      await runManageEmailTemplate(makeCtx(), {
        action: "update",
        templateId: "tmpl-1",
        subject: "No Body",
      });
      expect(mockPrisma.emailTemplateVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ body: "", versionNumber: 1 }) }),
      );
    });

    it("throws McpInvalidError when neither name nor subject is provided", async () => {
      vi.mocked(isCore).mockResolvedValue(true);

      await expect(
        runManageEmailTemplate(makeCtx(), { action: "update", templateId: "tmpl-1" }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
    });

    it("throws McpInvalidError when templateId is missing for update", async () => {
      vi.mocked(isCore).mockResolvedValue(true);

      await expect(
        runManageEmailTemplate(makeCtx(), { action: "update", name: "x" }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
    });

    it("throws McpForbiddenError when user has no DALI member row during version creation", async () => {
      vi.mocked(isCore).mockResolvedValue(true);
      mockPrisma.dALIMember.findUnique.mockResolvedValue(null);

      await expect(
        runManageEmailTemplate(makeCtx(), {
          action: "update",
          templateId: "tmpl-1",
          subject: "Oops",
        }),
      ).rejects.toMatchObject({ name: "McpForbiddenError", status: 403 });
    });
  });
});
