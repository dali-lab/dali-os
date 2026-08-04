import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isLabMember: vi.fn() }));
vi.mock("~/lib/page-sharing.server", () => ({ groupIdsForUser: vi.fn() }));

import { isCore, isLabMember } from "~/lib/roles";
import { groupIdsForUser } from "~/lib/page-sharing.server";
import { labDocAccess, visibleLabDocFilter } from "~/lib/lab-documents.server";

const CREATOR = "creator-1";
const OTHER = "other-1";
const OUTSIDER = "outsider-1";
const DOC = { id: "pg-1", createdById: CREATOR };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isLabMember).mockImplementation(async (id: string) => id !== OUTSIDER);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(groupIdsForUser).mockResolvedValue([]);
});

// View/edit for lab docs is now resolved by getPageAccess (General access +
// named shares); labDocAccess only answers who may change the sharing.
describe("labDocAccess — who may manage a lab doc's sharing", () => {
  it("lets the creator manage it", async () => {
    expect(await labDocAccess(DOC, CREATOR)).toEqual({ canManageAccess: true });
  });

  it("does not let another lab member manage it", async () => {
    expect(await labDocAccess(DOC, OTHER)).toEqual({ canManageAccess: false });
  });

  it("lets Core manage any lab doc — they curate the shelf", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    expect(await labDocAccess(DOC, OTHER)).toEqual({ canManageAccess: true });
  });

  it("shuts out non-members entirely", async () => {
    expect(await labDocAccess(DOC, OUTSIDER)).toEqual({ canManageAccess: false });
  });
});

describe("visibleLabDocFilter", () => {
  it("matches lab-open, public, authored, and directly shared docs", async () => {
    const where = await visibleLabDocFilter(OTHER);
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { linkAccess: { in: ["LabMembers", "Public"] } },
        { createdById: OTHER },
        { shares: { some: { principalType: "User", principalId: OTHER } } },
      ]),
    );
  });

  it("adds a group-share clause when the viewer is in groups", async () => {
    vi.mocked(groupIdsForUser).mockResolvedValue(["grp-1"]);
    const where = await visibleLabDocFilter(OTHER);
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { shares: { some: { principalType: "Group", principalId: { in: ["grp-1"] } } } },
      ]),
    );
  });
});
