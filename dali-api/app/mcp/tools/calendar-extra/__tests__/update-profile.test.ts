import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  return { McpError, McpNotFoundError, McpForbiddenError, McpInvalidError };
});
vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  runUpdateProfile,
  UPDATE_PROFILE_DEF,
} from "~/mcp/tools/calendar-extra/update-profile";

const mockPrisma = prisma as unknown as {
  user: { update: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("update_profile", () => {
  it("requires the mcp:write scope", () => {
    expect(UPDATE_PROFILE_DEF.requiredScope).toBe("mcp:write");
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it("throws McpInvalidError when only firstName provided without lastName", async () => {
    await expect(
      runUpdateProfile("u1", { firstName: "Alice", lastName: "" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws McpInvalidError for an unrecognized timezone", async () => {
    await expect(
      runUpdateProfile("u1", { timezone: "Not/A/Zone" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws McpInvalidError for malformed personalEmail (no @)", async () => {
    await expect(
      runUpdateProfile("u1", { personalEmail: "notanemail" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws McpInvalidError for malformed birthday", async () => {
    await expect(
      runUpdateProfile("u1", { birthday: "not-a-date" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws McpInvalidError on handle conflict (P2002)", async () => {
    mockPrisma.user.update.mockRejectedValue({
      code: "P2002",
      meta: { target: ["handle"] },
    });
    await expect(
      runUpdateProfile("u1", { handle: "taken" }),
    ).rejects.toMatchObject({ name: "McpInvalidError", message: "That handle is already taken" });
  });

  // ── Happy path: original fields ───────────────────────────────────────────

  it("updates fields including the display timezone", async () => {
    mockPrisma.user.update.mockResolvedValue({});
    const out = await runUpdateProfile("u1", {
      firstName: "Alice",
      lastName: "Smith",
      timezone: "America/New_York",
      handle: "alice",
    });

    expect(out.ok).toBe(true);
    expect(out.updated).toMatchObject({
      firstName: "Alice",
      lastName: "Smith",
      timezone: "America/New_York",
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: expect.objectContaining({ firstName: "Alice", timeZone: "America/New_York" }),
      }),
    );
  });

  it("returns empty updated when no fields provided", async () => {
    const out = await runUpdateProfile("u1", {});
    expect(out).toEqual({ ok: true, updated: {} });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // ── Happy path: new extended fields ──────────────────────────────────────

  it("updates nullable text fields (linkedin, github, major, hometown, etc.)", async () => {
    mockPrisma.user.update.mockResolvedValue({});
    const out = await runUpdateProfile("u1", {
      linkedinUrl: "https://linkedin.com/in/alice",
      githubUsername: "alice-gh",
      major: "CS",
      hometown: "Hanover, NH",
      dietaryRestrictions: "Vegan",
      phoneNumber: "+16035550100",
      personalSite: "https://alice.dev",
    });
    expect(out.ok).toBe(true);
    expect(out.updated).toMatchObject({
      linkedinUrl: "https://linkedin.com/in/alice",
      githubUsername: "alice-gh",
      major: "CS",
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          githubUsername: "alice-gh",
          major: "CS",
          hometown: "Hanover, NH",
        }),
      }),
    );
  });

  it("clears a nullable field when empty string is passed", async () => {
    mockPrisma.user.update.mockResolvedValue({});
    const out = await runUpdateProfile("u1", { githubUsername: "" });
    expect(out.ok).toBe(true);
    expect(out.updated.githubUsername).toBeNull();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ githubUsername: null }) }),
    );
  });

  it("updates classYear as integer", async () => {
    mockPrisma.user.update.mockResolvedValue({});
    const out = await runUpdateProfile("u1", { classYear: 2027 });
    expect(out.ok).toBe(true);
    expect(out.updated.classYear).toBe(2027);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ classYear: 2027 }) }),
    );
  });

  it("accepts a valid personalEmail", async () => {
    mockPrisma.user.update.mockResolvedValue({});
    const out = await runUpdateProfile("u1", { personalEmail: "alice@personal.com" });
    expect(out.ok).toBe(true);
    expect(out.updated.personalEmail).toBe("alice@personal.com");
  });

  it("clears personalEmail when empty string", async () => {
    mockPrisma.user.update.mockResolvedValue({});
    const out = await runUpdateProfile("u1", { personalEmail: "" });
    expect(out.ok).toBe(true);
    expect(out.updated.personalEmail).toBeNull();
  });

  it("accepts a valid YYYY-MM-DD birthday", async () => {
    mockPrisma.user.update.mockResolvedValue({});
    const out = await runUpdateProfile("u1", { birthday: "1990-05-15" });
    expect(out.ok).toBe(true);
    expect(out.updated.birthday).toBe("1990-05-15");
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ birthday: expect.any(Date) }) }),
    );
  });

  it("clears birthday when empty string", async () => {
    mockPrisma.user.update.mockResolvedValue({});
    const out = await runUpdateProfile("u1", { birthday: "" });
    expect(out.ok).toBe(true);
    expect(out.updated.birthday).toBeNull();
  });
});
