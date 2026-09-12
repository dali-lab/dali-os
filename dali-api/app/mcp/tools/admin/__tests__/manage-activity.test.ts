import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    activity: { findUnique: vi.fn() },
    activityEvent: { count: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/activities.server", () => ({
  listActivitiesForAdmin: vi.fn(),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  setActivityStatus: vi.fn(),
  deleteActivity: vi.fn(),
}));
vi.mock("~/lib/activities", () => ({ isActivityKind: vi.fn() }));

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  listActivitiesForAdmin,
  createActivity,
  updateActivity,
  setActivityStatus,
  deleteActivity,
} from "~/lib/activities.server";
import { isActivityKind } from "~/lib/activities";
import { runManageActivity, MANAGE_ACTIVITY_TOOL } from "~/mcp/tools/admin/manage-activity";
import type { McpCtx } from "~/mcp/registry";

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

const ACTIVITY_ROW = {
  id: "act-1",
  kind: "scavenger_hunt",
  name: "Fall Hunt",
  status: "Draft" as const,
  termId: "term-26F",
  startsAt: new Date("2026-09-01T00:00:00Z"),
  endsAt: new Date("2026-09-08T00:00:00Z"),
  participantCount: 0,
  eventCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(isActivityKind).mockReturnValue(true);
  vi.mocked(listActivitiesForAdmin).mockResolvedValue([ACTIVITY_ROW]);
  vi.mocked(createActivity).mockResolvedValue({ id: "act-new" } as any);
  vi.mocked(updateActivity).mockResolvedValue({} as any);
  vi.mocked(setActivityStatus).mockResolvedValue({} as any);
  vi.mocked(deleteActivity).mockResolvedValue(undefined);
  (prisma.activity.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "act-1",
    status: "Draft",
  });
  (prisma.activityEvent.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
});

describe("manage_activity", () => {
  it("requires mcp:admin scope", () => {
    expect(MANAGE_ACTIVITY_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws McpForbiddenError when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runManageActivity(makeCtx("u-nobody"), { action: "list" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError", status: 403 });
    expect(listActivitiesForAdmin).not.toHaveBeenCalled();
  });

  describe("action: list", () => {
    it("returns activities with ISO timestamps", async () => {
      const out = (await runManageActivity(makeCtx(), { action: "list" })) as {
        activities: any[];
      };
      expect(out).toHaveProperty("activities");
      expect(out.activities).toHaveLength(1);
      expect(out.activities[0]).toMatchObject({
        id: "act-1",
        kind: "scavenger_hunt",
        name: "Fall Hunt",
        status: "Draft",
        startsAt: "2026-09-01T00:00:00.000Z",
        endsAt: "2026-09-08T00:00:00.000Z",
        participantCount: 0,
        eventCount: 0,
      });
    });
  });

  describe("action: create", () => {
    it("creates an activity and logs audit event", async () => {
      const out = await runManageActivity(makeCtx(), {
        action: "create",
        name: "Spring Hunt",
        kind: "scavenger_hunt",
        termId: "term-26S",
        startsAt: "2026-03-01T00:00:00Z",
        endsAt: "2026-03-08T00:00:00Z",
      });
      expect(out).toEqual({ ok: true, id: "act-new" });
      expect(createActivity).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Spring Hunt", kind: "scavenger_hunt" }),
        "u-core",
      );
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "activities.create", targetId: "act-new" }),
      );
    });

    it("throws McpInvalidError when name is missing", async () => {
      await expect(
        runManageActivity(makeCtx(), { action: "create", kind: "scavenger_hunt" }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
      expect(createActivity).not.toHaveBeenCalled();
    });

    it("throws McpInvalidError when kind is invalid", async () => {
      vi.mocked(isActivityKind).mockReturnValue(false);
      await expect(
        runManageActivity(makeCtx(), { action: "create", name: "Hunt", kind: "bad_kind" }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
      expect(createActivity).not.toHaveBeenCalled();
    });
  });

  describe("action: update", () => {
    it("updates an activity and logs audit event", async () => {
      const out = await runManageActivity(makeCtx(), {
        action: "update",
        activityId: "act-1",
        name: "Renamed Hunt",
      });
      expect(out).toEqual({ ok: true });
      expect(updateActivity).toHaveBeenCalledWith(
        "act-1",
        expect.objectContaining({ name: "Renamed Hunt" }),
      );
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "activities.update", targetId: "act-1" }),
      );
    });

    it("throws McpInvalidError when activityId is missing", async () => {
      await expect(
        runManageActivity(makeCtx(), { action: "update", name: "X" }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
    });

    it("throws McpNotFoundError when activity does not exist", async () => {
      (prisma.activity.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      await expect(
        runManageActivity(makeCtx(), { action: "update", activityId: "act-missing" }),
      ).rejects.toMatchObject({ name: "McpNotFoundError", status: 404 });
    });
  });

  describe("action: set_status", () => {
    it("transitions status and logs audit event", async () => {
      const out = await runManageActivity(makeCtx(), {
        action: "set_status",
        activityId: "act-1",
        status: "Published",
      });
      expect(out).toEqual({ ok: true });
      expect(setActivityStatus).toHaveBeenCalledWith("act-1", "Published");
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "activities.status", metadata: { status: "Published" } }),
      );
    });

    it("throws McpInvalidError for invalid status", async () => {
      await expect(
        runManageActivity(makeCtx(), {
          action: "set_status",
          activityId: "act-1",
          status: "Deleted",
        }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
    });

    it("throws McpNotFoundError when activity does not exist", async () => {
      (prisma.activity.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      await expect(
        runManageActivity(makeCtx(), {
          action: "set_status",
          activityId: "act-missing",
          status: "Published",
        }),
      ).rejects.toMatchObject({ name: "McpNotFoundError", status: 404 });
    });
  });

  describe("action: delete", () => {
    it("deletes a Draft activity with no events", async () => {
      const out = await runManageActivity(makeCtx(), {
        action: "delete",
        activityId: "act-1",
      });
      expect(out).toEqual({ ok: true });
      expect(deleteActivity).toHaveBeenCalledWith("act-1");
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: "activities.delete", targetId: "act-1" }),
      );
    });

    it("throws McpInvalidError when activity has events", async () => {
      (prisma.activityEvent.count as ReturnType<typeof vi.fn>).mockResolvedValue(5);
      await expect(
        runManageActivity(makeCtx(), { action: "delete", activityId: "act-1" }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
      expect(deleteActivity).not.toHaveBeenCalled();
    });

    it("throws McpInvalidError when activity is not Draft", async () => {
      (prisma.activity.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "act-1",
        status: "Published",
      });
      await expect(
        runManageActivity(makeCtx(), { action: "delete", activityId: "act-1" }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
      expect(deleteActivity).not.toHaveBeenCalled();
    });

    it("throws McpNotFoundError when activity does not exist", async () => {
      (prisma.activity.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      await expect(
        runManageActivity(makeCtx(), { action: "delete", activityId: "act-missing" }),
      ).rejects.toMatchObject({ name: "McpNotFoundError", status: 404 });
    });

    it("throws McpInvalidError when activityId is missing", async () => {
      await expect(
        runManageActivity(makeCtx(), { action: "delete" }),
      ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
    });
  });

  it("throws McpInvalidError for unknown action", async () => {
    await expect(
      runManageActivity(makeCtx(), { action: "explode" }),
    ).rejects.toMatchObject({ name: "McpInvalidError", status: 400 });
  });
});
