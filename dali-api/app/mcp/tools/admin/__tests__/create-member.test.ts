import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/handle", () => ({ assignHandleIfMissing: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/admin/lib/eligibility.server", () => ({ addOrUpdateEligibility: vi.fn() }));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { assignHandleIfMissing } from "~/lib/handle";
import { runCreateMember, CREATE_MEMBER_TOOL } from "~/mcp/tools/admin/create-member";
import type { McpCtx } from "~/mcp/registry";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

function makeCtx(userId = "core-u1"): McpCtx {
  return {
    user: {
      id: userId,
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
      firstName: "Core",
      lastName: "User",
    },
    scopes: ["mcp:admin"],
    request: new Request("https://example.com"),
  };
}

const BASE = { firstName: "Ada", lastName: "Lovelace" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  mockPrisma.user.findFirst.mockResolvedValue(null);
  mockPrisma.user.create = vi.fn().mockResolvedValue({ id: "new-1" });
  mockPrisma.user.update.mockResolvedValue({});
  mockPrisma.dALIMember = {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "m1" }),
  };
});

describe("create_member", () => {
  it("requires the mcp:admin scope", () => {
    expect(CREATE_MEMBER_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("rejects unknown properties and requires only the name", () => {
    expect(CREATE_MEMBER_TOOL.inputSchema.additionalProperties).toBe(false);
    expect(CREATE_MEMBER_TOOL.inputSchema.required).toEqual(["firstName", "lastName"]);
  });

  it("declares every identity and profile property", () => {
    expect(Object.keys(CREATE_MEMBER_TOOL.inputSchema.properties)).toEqual(
      expect.arrayContaining([
        "email",
        "daliEmail",
        "dartmouthEmail",
        "personalEmail",
        "netId",
        "githubUsername",
        "phoneNumber",
        "birthday",
        "dietaryRestrictions",
      ]),
    );
  });

  it("works with only a daliEmail and passes the new fields to the helper", async () => {
    await runCreateMember(makeCtx(), {
      ...BASE,
      daliEmail: "ada@dali.dartmouth.edu",
      netId: "F001",
      githubUsername: "ada",
      phoneNumber: "555",
      birthday: "2001-02-03",
      dietaryRestrictions: "vegan",
    });
    expect(mockPrisma.user.create.mock.calls[0][0].data).toMatchObject({
      daliEmail: "ada@dali.dartmouth.edu",
      netId: "f001",
      githubUsername: "ada",
      phoneNumber: "555",
      birthday: new Date("2001-02-03T00:00:00.000Z"),
      dietaryRestrictions: "vegan",
    });
  });

  it("throws InvalidError when no email field is given", async () => {
    await expect(runCreateMember(makeCtx(), BASE)).rejects.toMatchObject({
      name: "McpInvalidError",
      message: "An email is required.",
    });
  });

  it("throws Forbidden and writes nothing for a non-core caller", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runCreateMember(makeCtx(), { ...BASE, email: "ada@example.com" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError", status: 403 });
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  describe("email routing", () => {
    it.each([
      ["Ada@DALI.Dartmouth.edu", { daliEmail: "ada@dali.dartmouth.edu" }],
      ["Ada@Dartmouth.edu", { dartmouthEmail: "ada@dartmouth.edu" }],
      ["Ada@Example.com", { personalEmail: "ada@example.com" }],
    ])("routes %s", async (email, expected) => {
      await runCreateMember(makeCtx(), { ...BASE, email });
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining(expected),
        select: { id: true },
      });
    });

    it("stores the optional dartmouth alias beside a non-dartmouth primary", async () => {
      await runCreateMember(makeCtx(), {
        ...BASE,
        email: "ada@example.com",
        dartmouthEmail: "Ada@Dartmouth.edu",
      });
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          personalEmail: "ada@example.com",
          dartmouthEmail: "ada@dartmouth.edu",
        }),
        select: { id: true },
      });
    });
  });

  it("creates a new member with a DALIMember marker and a handle", async () => {
    const out = await runCreateMember(makeCtx(), {
      ...BASE,
      email: "ada@example.com",
      classYear: 2027,
      major: " Math ",
    });
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        firstName: "Ada",
        lastName: "Lovelace",
        personalEmail: "ada@example.com",
        major: "Math",
        classYear: 2027,
        daliMember: { create: {} },
      },
      select: { id: true },
    });
    expect(assignHandleIfMissing).toHaveBeenCalledWith("new-1");
    expect(out).toEqual({ id: "new-1", created: true });
  });

  it("promotes an existing user and reports created false", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: "existing-1",
      dartmouthEmail: null,
      daliMember: null,
    });
    const out = await runCreateMember(makeCtx(), { ...BASE, email: "ada@example.com" });
    expect(mockPrisma.dALIMember.create).toHaveBeenCalledWith({ data: { userId: "existing-1" } });
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(assignHandleIfMissing).not.toHaveBeenCalled();
    expect(out).toEqual({ id: "existing-1", created: false });
  });

  it.each([
    [{ dartmouthEmail: "ada@gmail.com" }, "The Dartmouth email must be an @dartmouth.edu address."],
    [{ classYear: 1800 }, "Class year must be a 4-digit year."],
    [{ classYear: 2101 }, "Class year must be a 4-digit year."],
    [{ classYear: 2020.5 }, "Class year must be a 4-digit year."],
  ])("throws InvalidError for %j", async (extra, message) => {
    await expect(
      runCreateMember(makeCtx(), { ...BASE, email: "ada@example.com", ...extra }),
    ).rejects.toMatchObject({ name: "McpInvalidError", status: 400, message });
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it("logs an audit event with the target and outcome", async () => {
    await runCreateMember(makeCtx("core-u9"), { ...BASE, email: "ada@example.com" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member.create",
        userId: "core-u9",
        targetId: "new-1",
        metadata: { created: true, email: "ada@example.com", identityFields: ["email"] },
      }),
    );
  });

  it("lists which identity fields were provided in the audit metadata", async () => {
    await runCreateMember(makeCtx(), { ...BASE, daliEmail: "ada@dali.dartmouth.edu", netId: "f1" });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ identityFields: ["daliEmail", "netId"] }),
      }),
    );
  });
});
