import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/groups", () => ({
  listAllGroups: vi.fn(),
}));

import { listAllGroups } from "~/lib/groups";
import { runListGroups, LIST_GROUPS_TOOL } from "~/mcp/tools/list-groups";

beforeEach(() => {
  vi.clearAllMocks();
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

  it("lists every group, not just the caller's own", async () => {
    // A second group the caller is not a member of — it must still be returned.
    const OTHER_GROUP = { ...ACTIVE_GROUP, id: "g3", name: "Staff", memberIds: ["u9"] };
    vi.mocked(listAllGroups).mockResolvedValue([ACTIVE_GROUP, OTHER_GROUP]);
    const out = await runListGroups("u1", {});
    expect(out.groups.map((g) => g.id)).toEqual(["g1", "g3"]);
  });

  it("hides archived groups by default", async () => {
    vi.mocked(listAllGroups).mockResolvedValue([ACTIVE_GROUP, ARCHIVED_GROUP]);
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
    vi.mocked(listAllGroups).mockResolvedValue([ACTIVE_GROUP, ARCHIVED_GROUP]);
    const out = await runListGroups("u1", { includeArchived: true });
    expect(out.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("returns the full memberIds roster to any caller", async () => {
    vi.mocked(listAllGroups).mockResolvedValue([ACTIVE_GROUP]);
    const out = await runListGroups("u1", {});
    expect(out.groups[0].memberIds).toEqual(["u1", "u2"]);
    expect(out.groups[0].memberCount).toBe(2);
  });
});
