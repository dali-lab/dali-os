import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    emailTemplate: { findMany: vi.fn() },
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
import type { McpCtx } from "~/mcp/registry";

const mockPrisma = prisma as unknown as {
  emailTemplate: { findMany: ReturnType<typeof vi.fn> };
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
});

const TEMPLATE = {
  id: "tmpl-1",
  name: "Offer Letter",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  versions: [
    {
      id: "v-1",
      versionNumber: 1,
      subject: "Welcome to DALI",
      body: "<p>Hello</p>",
      createdById: "u-author",
      createdBy: { id: "u-author", firstName: "Alice", lastName: "Smith" },
    },
  ],
};

describe("list_email_templates", () => {
  it("requires the mcp:admin scope", () => {
    expect(LIST_EMAIL_TEMPLATES_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws McpForbiddenError when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);

    await expect(runListEmailTemplates(makeCtx())).rejects.toMatchObject({
      name: "McpForbiddenError",
      status: 403,
    });
  });

  it("returns templates with versions on happy path", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.emailTemplate.findMany.mockResolvedValue([TEMPLATE]);

    const out = await runListEmailTemplates(makeCtx());
    expect(out.templates).toHaveLength(1);
    expect(out.templates[0].id).toBe("tmpl-1");
    expect(out.templates[0].name).toBe("Offer Letter");
    expect(out.templates[0].versions).toHaveLength(1);
    expect(out.templates[0].versions[0].subject).toBe("Welcome to DALI");
    expect(out.templates[0].versions[0].createdBy.firstName).toBe("Alice");
  });

  it("returns an empty array when no templates exist", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    mockPrisma.emailTemplate.findMany.mockResolvedValue([]);

    const out = await runListEmailTemplates(makeCtx());
    expect(out.templates).toHaveLength(0);
  });
});
