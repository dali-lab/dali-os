import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    pageShare: { findMany: vi.fn() },
    instructorAssignment: { findFirst: vi.fn() },
    educationOffering: { findUnique: vi.fn() },
    educationApplication: { findFirst: vi.fn() },
  },
}));

vi.mock("~/lib/roles", () => ({
  isDomainLead: vi.fn().mockResolvedValue(false),
  isCore: vi.fn().mockResolvedValue(false),
  isProjectMember: vi.fn().mockResolvedValue(false),
  isLabMember: vi.fn().mockResolvedValue(true),
}));

vi.mock("~/partners/lib/partner-access", () => ({
  partnerHasProjectAccess: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/hiring/lib/confidentiality", () => ({
  confidentialityCleared: vi.fn(),
  getCycleConfidentialityState: vi.fn(),
}));

vi.mock("~/lib/groups", () => ({
  resolveGroupMembers: vi.fn(),
  listVisibleGroupIdsForUser: vi.fn().mockResolvedValue([]),
}));

import { prisma } from "~/lib/db";
import { isCore, isLabMember } from "~/lib/roles";
import { resolveGroupMembers, listVisibleGroupIdsForUser } from "~/lib/groups";
import { authorizeCollabDoc } from "../collabAuth";

const mockPrisma = prisma as any;

const GROUP = "g-design";
const FOLDER_ID = "design-root";

type Row = Record<string, unknown>;

/** The Prisma mock answers findUnique from a table keyed by page id and honours `select`. */
function seedPages(rows: Row[]) {
  mockPrisma.page.findUnique.mockImplementation(
    async ({ where, select }: { where: { id: string }; select: Record<string, true> }) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) return null;
      return Object.fromEntries(Object.keys(select).map((k) => [k, row[k] ?? null]));
    },
  );
}

function scopedFolder(scopePermission: "View" | "Edit"): Row {
  return {
    id: FOLDER_ID,
    workspaceType: "Lab",
    workspaceId: null,
    parentPageId: null,
    archivedAt: null,
    scopeKind: "Group",
    scopeGroupId: GROUP,
    scopePermission,
    createdById: "someone-else",
    linkAccess: "Restricted",
  };
}

function childPage(id: string, kind: "doc" | "whiteboard"): Row {
  return {
    id,
    kind,
    workspaceType: "Lab",
    workspaceId: null,
    parentPageId: FOLDER_ID,
    archivedAt: null,
    scopeKind: null,
    createdById: "someone-else",
    linkAccess: "Restricted",
    linkPermission: "View",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isLabMember).mockResolvedValue(true);
  vi.mocked(listVisibleGroupIdsForUser).mockResolvedValue([]);
  vi.mocked(resolveGroupMembers).mockResolvedValue(["design-member"]);
  mockPrisma.pageShare.findMany.mockResolvedValue([]);
  mockPrisma.page.findFirst.mockResolvedValue(null);
  mockPrisma.page.findMany.mockResolvedValue([]);
});

describe.each([
  { label: "doc", name: "doc:child:body", kind: "doc" as const },
  { label: "whiteboard", name: "whiteboard:child:canvas", kind: "whiteboard" as const },
])("$label under a Group-scoped folder (non-Core group)", ({ name, kind }) => {
  it("admits a group member read-write when scopePermission is Edit", async () => {
    seedPages([scopedFolder("Edit"), childPage("child", kind)]);
    expect(await authorizeCollabDoc("design-member", name)).toEqual({
      allowed: true,
      readOnly: false,
    });
  });

  it("admits a group member read-only when scopePermission is View", async () => {
    seedPages([scopedFolder("View"), childPage("child", kind)]);
    expect(await authorizeCollabDoc("design-member", name)).toEqual({
      allowed: true,
      readOnly: true,
    });
  });

  it("denies a lab member outside the group", async () => {
    seedPages([scopedFolder("Edit"), childPage("child", kind)]);
    expect(await authorizeCollabDoc("other-lab-member", name)).toMatchObject({ allowed: false });
  });

  it("denies a non-member without a lab role", async () => {
    vi.mocked(isLabMember).mockResolvedValue(false);
    seedPages([scopedFolder("Edit"), childPage("child", kind)]);
    expect(await authorizeCollabDoc("outsider", name)).toMatchObject({ allowed: false });
  });
});
