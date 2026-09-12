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
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  return { McpError, McpInvalidError, McpNotFoundError, McpForbiddenError };
});
vi.mock("~/lib/member-class.server", () => ({
  createClass: vi.fn(),
  updateClass: vi.fn(),
  removeClass: vi.fn(),
  parseDestination: vi.fn((raw: string) => {
    if (raw === "local") return { kind: "local" };
    if (raw.startsWith("google-dedicated:")) return { kind: "google-dedicated", linkId: raw.split(":")[1] };
    if (raw === "invalid") return null;
    return { kind: "local" };
  }),
  MemberClassError: class MemberClassError extends Error {
    constructor(message: string) { super(message); this.name = "MemberClassError"; }
  },
}));

import { createClass, updateClass, removeClass, parseDestination } from "~/lib/member-class.server";
import { runManageClass, MANAGE_CLASS_DEF } from "~/mcp/tools/calendar-extra/manage-class";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manage_class", () => {
  it("requires mcp:write scope", () => {
    expect(MANAGE_CLASS_DEF.requiredScope).toBe("mcp:write");
  });

  it("throws McpInvalidError when deleting without classId", async () => {
    await expect(
      runManageClass("u1", { intent: "delete" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("calls removeClass for delete intent", async () => {
    vi.mocked(removeClass).mockResolvedValue(undefined);
    const out = await runManageClass("u1", { intent: "delete", classId: "cls1" });
    expect(out).toEqual({ ok: true });
    expect(removeClass).toHaveBeenCalledWith("u1", "cls1");
  });

  it("throws McpInvalidError when adding without termId", async () => {
    await expect(
      runManageClass("u1", { intent: "add", title: "COSC 89", destination: "local", periodCode: "2A" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws McpInvalidError when adding without periodCode or customMeetings", async () => {
    await expect(
      runManageClass("u1", { intent: "add", termId: "t1", title: "COSC 89", destination: "local" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("calls createClass for add intent", async () => {
    vi.mocked(createClass).mockResolvedValue(undefined);
    const out = await runManageClass("u1", {
      intent: "add",
      termId: "t1",
      title: "COSC 89",
      destination: "local",
      periodCode: "2A",
    });
    expect(out).toEqual({ ok: true });
    expect(createClass).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        termId: "t1",
        title: "COSC 89",
        periodCode: "2A",
      }),
    );
  });

  it("calls updateClass for update intent", async () => {
    vi.mocked(updateClass).mockResolvedValue(undefined);
    const out = await runManageClass("u1", {
      intent: "update",
      classId: "cls1",
      termId: "t1",
      title: "COSC 89",
      destination: "local",
      periodCode: "3B",
    });
    expect(out).toEqual({ ok: true });
    expect(updateClass).toHaveBeenCalledWith("cls1", expect.objectContaining({ periodCode: "3B" }));
  });

  it("throws McpInvalidError for invalid destination via MemberClassError", async () => {
    // parseDestination returns null for unrecognized destinations, which the
    // mock converts into throwing MemberClassError
    vi.mocked(parseDestination).mockImplementation(() => {
      // The module factory defines MemberClassError inline — simulate the throw
      const err = new Error("Unrecognized class destination");
      err.name = "MemberClassError";
      throw err;
    });
    await expect(
      runManageClass("u1", {
        intent: "add",
        termId: "t1",
        title: "COSC 89",
        destination: "invalid",
        periodCode: "2A",
      }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });
});
