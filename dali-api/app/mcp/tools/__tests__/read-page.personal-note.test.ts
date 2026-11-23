import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
const db = vi.hoisted(() => ({ pages: {} as Record<string, any>, shares: [] as Array<Record<string, any>> }));

vi.mock("~/lib/db.server", () => ({
  prisma: {
    page: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.pages[where.id] ?? null),
      findFirst: vi.fn(async () => null),
    },
    pageShare: {
      findMany: vi.fn(async ({ where }: { where: { pageId: { in: string[] }; OR: Array<{ principalType: string; principalId: string | { in: string[] } }> } }) =>
        db.shares.filter(
          (s) =>
            where.pageId.in.includes(s.pageId) &&
            where.OR.some((c) => c.principalType === s.principalType && (typeof c.principalId === "string" ? c.principalId === s.principalId : c.principalId.in.includes(s.principalId))),
        ),
      ),
    },
  },
}));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isLabMemberOrAlum: vi.fn(),
  isProjectMember: vi.fn(),
  isDomainLead: vi.fn(),
}));
vi.mock("~/partners/lib/partner-access", () => ({
  partnerHasProjectAccess: vi.fn().mockResolvedValue(false),
  partnerOrgIdsForUser: vi.fn().mockResolvedValue([]),
}));
vi.mock("~/lib/groups.server", () => ({ resolveGroupMembers: vi.fn().mockResolvedValue([]), listVisibleGroupIdsForUser: vi.fn().mockResolvedValue([]) }));
vi.mock("~/lib/page-sharing.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/page-sharing.server")>()),
  groupIdsForUser: vi.fn().mockResolvedValue([]),
}));
vi.mock("~/hiring/lib/confidentiality", () => ({ confidentialityCleared: vi.fn(), getCycleConfidentialityState: vi.fn() }));
vi.mock("~/forms/lib/form-access.server", () => ({ canBuildForm: vi.fn() }));
vi.mock("~/collab/read", () => ({ readDocAsBlocks: vi.fn().mockResolvedValue([]) }));
vi.mock("~/collab/blocknote-server", () => ({ blocksToMarkdown: vi.fn().mockResolvedValue("") }));
vi.mock("~/collab/agent-presence.server", () => ({ announceAgent: vi.fn(), pagePresenceRoom: vi.fn() }));

import { isCore, isLabMemberOrAlum } from "~/lib/roles";
import { runReadPage } from "../read-page";

const note = (over: Row = {}) => ({
  id: "n1",
  title: "Journal",
  kind: "FreeForm",
  workspaceType: "Member",
  workspaceId: "owner",
  contentDocId: null,
  iconEmoji: null,
  parentPageId: "folder1",
  profileVisible: false,
  labListing: "None",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-02-01T00:00:00Z"),
  tags: [{ tag: { id: "t1", label: "Ideas", color: "blue" } }],
  _count: { shares: 2 },
  archivedAt: null,
  partnerVisible: false,
  createdById: "owner",
  linkAccess: "Restricted",
  linkPermission: "View",
  studentEditable: false,
  meetingNoteId: null,
  scopeKind: null,
  ...over,
});

beforeEach(() => {
  db.pages = { n1: note() };
  db.shares = [];
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isLabMemberOrAlum).mockResolvedValue(true);
});

describe("read_page on a personal note", () => {
  it("returns the note's metadata to its owner", async () => {
    const out = await runReadPage("owner", { pageId: "n1" });
    expect(out).toMatchObject({ id: "n1", workspaceType: "Member", workspaceId: "owner" });
    expect(out.note).toEqual({
      parentPageId: "folder1",
      visibility: "private",
      labListing: "None",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
      tags: [{ id: "t1", label: "Ideas", color: "blue" }],
      shareCount: 2,
      isOwner: true,
      canEdit: true,
    });
  });

  it("returns it, read-only, to someone it is shared with", async () => {
    db.shares = [{ pageId: "n1", principalType: "User", principalId: "reader", permission: "View" }];
    const out = await runReadPage("reader", { pageId: "n1" });
    expect(out.note).toMatchObject({ isOwner: false, canEdit: false, shareCount: 2 });
  });

  it.each([
    ["public on the profile", { profileVisible: true }, "public"],
    ["listed for the lab", { labListing: "Listed" }, "private"],
  ])("returns it to a viewer when it is %s", async (_label, over, visibility) => {
    db.pages.n1 = note(over);
    const out = await runReadPage("stranger", { pageId: "n1" });
    expect(out.note).toMatchObject({ visibility, isOwner: false, canEdit: false });
  });

  it("is forbidden to a Core user who is not the owner, shared with, or looking at a public or listed note", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await expect(runReadPage("core-user", { pageId: "n1" })).rejects.toMatchObject({ status: 403 });
  });

  it("is forbidden to a lab member with no share and no public flag", async () => {
    await expect(runReadPage("stranger", { pageId: "n1" })).rejects.toMatchObject({ status: 403 });
  });

  it("leaves note metadata off pages in other workspaces", async () => {
    db.pages.n1 = note({ workspaceType: "Lab", workspaceId: null });
    vi.mocked(isCore).mockResolvedValue(true);
    const out = await runReadPage("anyone", { pageId: "n1" });
    expect(out).not.toHaveProperty("note");
  });
});
