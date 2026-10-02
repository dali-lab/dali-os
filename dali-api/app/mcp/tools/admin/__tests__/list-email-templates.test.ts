import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    emailTemplate: { findMany: vi.fn() },
    emailTemplateVersion: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import {
  runListEmailTemplates,
  LIST_EMAIL_TEMPLATES_TOOL,
} from "~/mcp/tools/admin/list-email-templates";
import { EMAIL_TEMPLATE_KEYS } from "~/email/lib/registry";
import type { McpCtx } from "~/mcp/registry";

const mockPrisma = prisma as unknown as {
  emailTemplate: { findMany: ReturnType<typeof vi.fn> };
  emailTemplateVersion: { findMany: ReturnType<typeof vi.fn> };
};

function makeCtx(userId = "u1"): McpCtx {
  return {
    user: {
      id: userId,
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
      firstName: "Test",
      lastName: "User",
    },
    scopes: ["mcp:admin"],
    request: new Request("http://localhost/"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  mockPrisma.emailTemplate.findMany.mockResolvedValue([]);
  mockPrisma.emailTemplateVersion.findMany.mockResolvedValue([]);
});

describe("list_email_templates", () => {
  it("declares the admin scope", () => {
    expect(LIST_EMAIL_TEMPLATES_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("refuses a non-Core caller", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(runListEmailTemplates(makeCtx())).rejects.toThrow(/Core/);
  });

  it("lists every registry key, written or not", async () => {
    // The point of the rewrite: the old tool read a store no send site used, so
    // it could not see the emails that actually ship. Now an unwritten email is
    // still listed, with written:false.
    const { templates } = await runListEmailTemplates(makeCtx());
    expect(templates).toHaveLength(EMAIL_TEMPLATE_KEYS.length);
    expect(templates.every((t) => t.written === false)).toBe(true);
  });

  it("covers hiring, which previously had no MCP surface at all", async () => {
    const { templates } = await runListEmailTemplates(makeCtx());
    expect(templates.some((t) => t.key === "hiring:decision:Accepted")).toBe(true);
  });

  it("surfaces the registry contract alongside the copy", async () => {
    const { templates } = await runListEmailTemplates(makeCtx());
    const accepted = templates.find((t) => t.key === "hiring:decision:Accepted")!;
    expect(accepted.area).toBe("Hiring");
    expect(accepted.sendsAs).toBe("Hiring");
    expect(accepted.variables).toContain("firstName");
    // An agent needs to know that clearing this one blocks a release.
    expect(accepted.whenMissing).toBe("error");
  });

  it("returns the stored copy for a written email", async () => {
    mockPrisma.emailTemplate.findMany.mockResolvedValue([
      {
        key: "hiring:decision:Accepted",
        subject: "Welcome",
        body: "Hi {{firstName}}",
        updatedAt: new Date("2026-01-01"),
        updatedById: "u9",
      },
    ]);
    const { templates } = await runListEmailTemplates(makeCtx());
    const accepted = templates.find((t) => t.key === "hiring:decision:Accepted")!;
    expect(accepted.written).toBe(true);
    expect(accepted.subject).toBe("Welcome");
  });

  it("can narrow to a single key", async () => {
    const { templates } = await runListEmailTemplates(makeCtx(), {
      key: "education:decision:Approved",
    });
    expect(templates).toHaveLength(1);
    expect(templates[0]!.key).toBe("education:decision:Approved");
  });

  it("returns nothing for an unknown key rather than guessing", async () => {
    const { templates } = await runListEmailTemplates(makeCtx(), { key: "nope" });
    expect(templates).toEqual([]);
  });

  it("omits history unless asked", async () => {
    const { templates } = await runListEmailTemplates(makeCtx());
    expect(templates[0]).not.toHaveProperty("versions");
    expect(mockPrisma.emailTemplateVersion.findMany).not.toHaveBeenCalled();
  });

  it("attaches history per key when asked", async () => {
    mockPrisma.emailTemplateVersion.findMany.mockResolvedValue([
      {
        templateKey: "hiring:decision:Accepted",
        versionNumber: 2,
        subject: "v2",
        body: "b2",
        createdAt: new Date("2026-02-01"),
        createdBy: { firstName: "Ada", lastName: "L" },
      },
    ]);
    const { templates } = await runListEmailTemplates(makeCtx(), { includeVersions: true });
    const accepted = templates.find((t) => t.key === "hiring:decision:Accepted")!;
    expect(accepted.versions).toHaveLength(1);
    const other = templates.find((t) => t.key === "hiring:decision:Rejected")!;
    expect(other.versions).toEqual([]);
  });

  it("selects only an author's name, never the whole user row", async () => {
    await runListEmailTemplates(makeCtx(), { includeVersions: true });
    const select = mockPrisma.emailTemplateVersion.findMany.mock.calls[0][0].select;
    expect(select.createdBy).toEqual({ select: { firstName: true, lastName: true } });
  });
});
