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
vi.mock("~/lib/db", () => ({
  prisma: {
    userCalendarLink: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "~/lib/db";
import {
  runManageCalendarLink,
  MANAGE_CALENDAR_LINK_DEF,
} from "~/mcp/tools/calendar-extra/manage-calendar-link";

const mockPrisma = prisma as unknown as {
  userCalendarLink: {
    findUnique: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manage_calendar_link", () => {
  it("requires mcp:write scope", () => {
    expect(MANAGE_CALENDAR_LINK_DEF.requiredScope).toBe("mcp:write");
  });

  describe("remove-calendar-link", () => {
    it("throws McpNotFoundError when link doesn't exist", async () => {
      mockPrisma.userCalendarLink.findUnique.mockResolvedValue(null);
      await expect(
        runManageCalendarLink("u1", { intent: "remove-calendar-link", linkId: "lnk1" }),
      ).rejects.toMatchObject({ name: "McpNotFoundError" });
    });

    it("throws McpNotFoundError when link belongs to different user", async () => {
      mockPrisma.userCalendarLink.findUnique.mockResolvedValue({ id: "lnk1", userId: "u-other", subCalendarIds: [] });
      await expect(
        runManageCalendarLink("u1", { intent: "remove-calendar-link", linkId: "lnk1" }),
      ).rejects.toMatchObject({ name: "McpNotFoundError" });
    });

    it("deletes the link and returns ok", async () => {
      mockPrisma.userCalendarLink.findUnique.mockResolvedValue({ id: "lnk1", userId: "u1", subCalendarIds: [] });
      mockPrisma.userCalendarLink.delete.mockResolvedValue({});

      const out = await runManageCalendarLink("u1", { intent: "remove-calendar-link", linkId: "lnk1" });
      expect(out).toEqual({ ok: true });
      expect(mockPrisma.userCalendarLink.delete).toHaveBeenCalledWith({ where: { id: "lnk1" } });
    });
  });

  describe("toggle-sub-calendar", () => {
    it("throws McpNotFoundError when link doesn't exist", async () => {
      mockPrisma.userCalendarLink.findUnique.mockResolvedValue(null);
      await expect(
        runManageCalendarLink("u1", {
          intent: "toggle-sub-calendar",
          linkId: "lnk1",
          calendarId: "cal1",
          enabled: true,
        }),
      ).rejects.toMatchObject({ name: "McpNotFoundError" });
    });

    it("adds calendarId to subCalendarIds when enabled=true", async () => {
      mockPrisma.userCalendarLink.findUnique.mockResolvedValue({
        id: "lnk1",
        userId: "u1",
        subCalendarIds: ["existing-cal"],
      });
      mockPrisma.userCalendarLink.update.mockResolvedValue({});

      const out = await runManageCalendarLink("u1", {
        intent: "toggle-sub-calendar",
        linkId: "lnk1",
        calendarId: "cal2",
        enabled: true,
      });
      expect(out).toEqual({ ok: true });
      expect(mockPrisma.userCalendarLink.update).toHaveBeenCalledWith({
        where: { id: "lnk1" },
        data: { subCalendarIds: expect.arrayContaining(["existing-cal", "cal2"]) },
      });
    });

    it("removes calendarId from subCalendarIds when enabled=false", async () => {
      mockPrisma.userCalendarLink.findUnique.mockResolvedValue({
        id: "lnk1",
        userId: "u1",
        subCalendarIds: ["cal1", "cal2"],
      });
      mockPrisma.userCalendarLink.update.mockResolvedValue({});

      await runManageCalendarLink("u1", {
        intent: "toggle-sub-calendar",
        linkId: "lnk1",
        calendarId: "cal1",
        enabled: false,
      });
      expect(mockPrisma.userCalendarLink.update).toHaveBeenCalledWith({
        where: { id: "lnk1" },
        data: { subCalendarIds: ["cal2"] },
      });
    });
  });
});
