import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isLabMember: vi.fn() }));
vi.mock("~/lib/groups", () => ({ resolveGroupMembers: vi.fn() }));

import { prisma } from "~/lib/db";
import { isCore, isLabMember } from "~/lib/roles";
import { labDocAccess } from "~/lib/lab-documents.server";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const CREATOR = "creator-1";
const OTHER = "other-1";
const OUTSIDER = "outsider-1";

const OPEN_DOC = { id: "pg-1", createdById: CREATOR, labRestricted: false };
const LOCKED_DOC = { id: "pg-1", createdById: CREATOR, labRestricted: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isLabMember).mockImplementation(async (id: string) => id !== OUTSIDER);
  vi.mocked(isCore).mockResolvedValue(false);
  mockPrisma.pageShare.findFirst.mockResolvedValue(null);
  mockPrisma.groupDefinition.findMany.mockResolvedValue([]);
});

describe("labDocAccess — unrestricted documents", () => {
  it("lets any lab member read, edit and narrow it, matching the rest of the shelf", async () => {
    expect(await labDocAccess(OPEN_DOC, OTHER)).toEqual({
      canView: true,
      canEdit: true,
      canManageAccess: true,
    });
  });

  it("shuts out non-members entirely", async () => {
    expect(await labDocAccess(OPEN_DOC, OUTSIDER)).toEqual({
      canView: false,
      canEdit: false,
      canManageAccess: false,
    });
  });

  it("gives the creator the access controls", async () => {
    expect(await labDocAccess(OPEN_DOC, CREATOR)).toMatchObject({ canManageAccess: true });
  });

  it("withholds them from someone outside the lab", async () => {
    expect(await labDocAccess(OPEN_DOC, OUTSIDER)).toMatchObject({ canManageAccess: false });
  });
});

describe("labDocAccess — restricted documents", () => {
  it("hides one from a lab member who isn't on the list", async () => {
    expect(await labDocAccess(LOCKED_DOC, OTHER)).toEqual({
      canView: false,
      canEdit: false,
      canManageAccess: false,
    });
  });

  it("keeps the creator's full access", async () => {
    expect(await labDocAccess(LOCKED_DOC, CREATOR)).toEqual({
      canView: true,
      canEdit: true,
      canManageAccess: true,
    });
  });

  it("grants a directly shared member read but not write", async () => {
    mockPrisma.pageShare.findFirst.mockResolvedValue({ id: "share-1" });
    expect(await labDocAccess(LOCKED_DOC, OTHER)).toEqual({
      canView: true,
      canEdit: false,
      canManageAccess: false,
    });
  });

  it("does not let a share reach someone who isn't in the lab at all", async () => {
    mockPrisma.pageShare.findFirst.mockResolvedValue({ id: "share-1" });
    expect(await labDocAccess(LOCKED_DOC, OUTSIDER)).toMatchObject({ canView: false });
  });

  it("still admits Core — restricting takes a doc off the shelf, it doesn't seal it", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    expect(await labDocAccess(LOCKED_DOC, OTHER)).toEqual({
      canView: true,
      canEdit: true,
      canManageAccess: true,
    });
  });
});
