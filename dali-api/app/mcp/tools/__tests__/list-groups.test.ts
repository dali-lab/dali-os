import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/groups", () => ({
  listVisibleGroupsForUser: vi.fn(),
}));
vi.mock("~/lib/roles", () => ({
  canViewForms: vi.fn(),
}));

import { listVisibleGroupsForUser } from "~/lib/groups";
import { canViewForms } from "~/lib/roles";
import { runListGroups, LIST_GROUPS_TOOL } from "~/mcp/tools/list-groups";

beforeEach(() => {
  vi.clearAllMocks();
  // Default: roster-privileged caller (Core/Instructor). Individual tests
  // override to exercise the non-privileged path.
  vi.mocked(canViewForms).mockResolvedValue(true);
});

const ACTIVE_GROUP = {
  id: "g1",
  name: "Core",
  type: "Dynamic" as const,
  dynamicQuery: "core",
  systemKey: "core",
  memberIds: ["u1", "u2"],
  archived: false,
  archivedAt: null,
  boundTermIds: [],
};
const ARCHIVED_GROUP = {
  ...ACTIVE_GROUP,
  id: "g2",
  name: "Old project group",
  archived: true,
  archivedAt: "2025-01-01T00:00:00.000Z",
};

describe("list_groups", () => {
  it("requires the mcp:read scope", () => {
    expect(LIST_GROUPS_TOOL.requiredScope).toBe("mcp:read");
  });

  it("hides archived groups by default", async () => {
    vi.mocked(listVisibleGroupsForUser).mockResolvedValue([ACTIVE_GROUP, ARCHIVED_GROUP]);
    const out = await runListGroups("u1", {});
    expect(out.groups.map((g) => g.id)).toEqual(["g1"]);
    expect(out.groups[0]).toMatchObject({
      id: "g1",
      name: "Core",
      type: "Dynamic",
      memberCount: 2,
      archived: false,
    });
  });

  it("includes archived groups when requested", async () => {
    vi.mocked(listVisibleGroupsForUser).mockResolvedValue([ACTIVE_GROUP, ARCHIVED_GROUP]);
    const out = await runListGroups("u1", { includeArchived: true });
    expect(out.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("returns the full memberIds roster to Core/Instructor callers", async () => {
    vi.mocked(canViewForms).mockResolvedValue(true);
    vi.mocked(listVisibleGroupsForUser).mockResolvedValue([ACTIVE_GROUP]);
    const out = await runListGroups("u1", {});
    expect(out.groups[0].memberIds).toEqual(["u1", "u2"]);
    expect(out.groups[0].memberCount).toBe(2);
  });

  it("omits memberIds for non-privileged callers (keeps the count)", async () => {
    vi.mocked(canViewForms).mockResolvedValue(false);
    vi.mocked(listVisibleGroupsForUser).mockResolvedValue([ACTIVE_GROUP]);
    const out = await runListGroups("u1", {});
    expect(out.groups[0].memberIds).toBeUndefined();
    expect(out.groups[0].memberCount).toBe(2);
  });
});
