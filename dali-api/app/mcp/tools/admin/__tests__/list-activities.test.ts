import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/activities.server", () => ({ listActivitiesForAdmin: vi.fn() }));

import { isCore } from "~/lib/roles";
import { listActivitiesForAdmin } from "~/lib/activities.server";
import { runListActivities, LIST_ACTIVITIES_TOOL } from "~/mcp/tools/admin/list-activities";
import type { McpCtx } from "~/mcp/registry";

function makeCtx(userId = "u-core"): McpCtx {
  return {
    user: { id: userId, daliEmail: null, dartmouthEmail: null, netId: null, firstName: "Core", lastName: "Lead" },
    scopes: ["mcp:read"],
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
  vi.mocked(listActivitiesForAdmin).mockResolvedValue([ACTIVITY_ROW]);
});

it("is a read tool", () => {
  expect(LIST_ACTIVITIES_TOOL.requiredScope).toBe("mcp:read");
});

it("throws McpForbiddenError when caller is not Core", async () => {
  vi.mocked(isCore).mockResolvedValue(false);
  await expect(runListActivities(makeCtx("u-nobody"), {})).rejects.toMatchObject({ name: "McpForbiddenError", status: 403 });
  expect(listActivitiesForAdmin).not.toHaveBeenCalled();
});

describe("list_activities", () => {
  const row = (id: string, day: number) => ({
    ...ACTIVITY_ROW,
    id,
    startsAt: new Date(`2026-09-${String(day).padStart(2, "0")}T00:00:00Z`),
  });

  it("walks pages newest first with the cursor and ends with a null cursor", async () => {
    vi.mocked(listActivitiesForAdmin).mockResolvedValue([row("a-1", 1), row("a-3", 3), row("a-2", 2)]);
    const first = (await runListActivities(makeCtx(), { limit: 2 })) as {
      activities: { id: string }[];
      page: { nextCursor: string | null; hasMore: boolean; total: number };
    };
    expect(first.activities.map((a) => a.id)).toEqual(["a-3", "a-2"]);
    expect(first.page).toMatchObject({ hasMore: true, limit: 2, total: 3 });

    const second = (await runListActivities(makeCtx(), {
      limit: 2,
      cursor: first.page.nextCursor!,
    })) as typeof first;
    expect(second.activities.map((a) => a.id)).toEqual(["a-1"]);
    expect(second.page.nextCursor).toBeNull();
    expect(second.page.hasMore).toBe(false);
  });

  it("breaks start-time ties on id", async () => {
    vi.mocked(listActivitiesForAdmin).mockResolvedValue([row("b", 1), row("a", 1)]);
    const out = (await runListActivities(makeCtx(), {})) as {
      activities: { id: string }[];
    };
    expect(out.activities.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("returns activities with ISO timestamps", async () => {
    const out = (await runListActivities(makeCtx(), {})) as {
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
