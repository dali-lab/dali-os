import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireMemberSession: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/pageAccess.server", async (orig) => ({ ...(await orig<typeof import("~/lib/pageAccess.server")>()), getPageAccessBulk: vi.fn() }));
vi.mock("~/lib/drive-scopes.server", () => ({ loadDriveScopes: vi.fn() }));
vi.mock("~/lib/move-constraint.server", () => ({ moveConstraintFor: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireMemberSession } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { getPageAccessBulk } from "~/lib/pageAccess.server";
import { loadDriveScopes } from "~/lib/drive-scopes.server";
import { moveConstraintFor } from "~/lib/move-constraint.server";
import { loader } from "~/routes/api.drive.destinations";

const mockPrisma = prisma as unknown as {
  project: { findMany: ReturnType<typeof vi.fn> };
  educationOffering: { findMany: ReturnType<typeof vi.fn> };
  page: { findMany: ReturnType<typeof vi.fn> };
};

const folder = (id: string, parentFolderId: string | null, title = id, folderType: string | null = null) => ({
  type: "folder" as const,
  id,
  title,
  iconEmoji: null,
  parentFolderId,
  folderType,
});

const scopes = [
  { id: "mine", label: "My Drive", iconEmoji: null, scopeAudience: "Private", items: [folder("my-f", null, "Mine")] },
  {
    id: "lab",
    label: "Lab-wide",
    iconEmoji: null,
    scopeAudience: "Everyone in the lab",
    items: [folder("lab-ok", null, "Operations"), folder("lab-ro", null, "Locked"), folder("lab-kid", "lab-ro", "Kid")],
  },
  {
    id: "core",
    label: "Core",
    iconEmoji: null,
    rootFolderId: "core-root",
    scopeAudience: "Core only",
    items: [folder("core-m", "core-root", "Meeting notes", "Meetings")],
  },
  {
    id: "hiring",
    label: "Hiring",
    iconEmoji: null,
    rootFolderId: "hiring-root",
    scopeAudience: "Core only",
    items: [folder("hire-f", "hiring-root", "Forms")],
  },
  {
    id: "projects",
    label: "Projects",
    iconEmoji: null,
    scopeAudience: "Project members",
    items: [folder("p1", null, "Atlas"), folder("p1-docs", "p1", "Docs")],
  },
];

const editable = new Set(["lab-ok", "lab-kid", "core-root", "core-m", "p1-docs"]);

function request(qs = "") {
  return new Request(`http://localhost/api/drive/destinations${qs}`);
}

async function call(qs = "") {
  const res = (await loader({ request: request(qs) } as never)) as Response;
  return { res, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({
    ok: true,
    auth: { user: { sub: "u1", email: "u@test.com", type: "user" } },
  } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  mockPrisma.project.findMany.mockResolvedValue([{ id: "p1", name: "Atlas", iconEmoji: null }]);
  mockPrisma.educationOffering.findMany.mockResolvedValue([]);
  mockPrisma.page.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map((id) => ({ id })),
  );
  vi.mocked(getPageAccessBulk).mockImplementation(
    async (_u, pages) =>
      new Map(pages.map((p) => [p.id, { canView: true, canEdit: editable.has(p.id), canComment: true }])) as never,
  );
  vi.mocked(loadDriveScopes).mockResolvedValue(scopes as never);
});

describe("GET /api/drive/destinations?moving=", () => {
  it("offers only the root's own drive for a page under a typed root", async () => {
    vi.mocked(moveConstraintFor).mockResolvedValue({ rootFolderIds: ["core-root"], workspaces: [] });
    const { body } = await call("?moving=a,b");
    expect(moveConstraintFor).toHaveBeenCalledWith(["a", "b"]);
    expect(body.drives.map((d: { id: string }) => d.id)).toEqual(["core"]);
    expect(body.folders.map((f: { id: string }) => f.id)).toEqual(["core-m"]);
  });

  it("does not constrain the rows without a moving param", async () => {
    const { body } = await call();
    expect(moveConstraintFor).not.toHaveBeenCalled();
    expect(body.drives.length).toBeGreaterThan(1);
  });
});

describe("GET /api/drive/destinations", () => {
  it("returns the gate's response for a non-member", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Not a DALI member" }, { status: 403 }),
    });
    const { res, body } = await call();
    expect(res.status).toBe(403);
    expect(body.error).toBe("Not a DALI member");
    expect(loadDriveScopes).not.toHaveBeenCalled();
  });

  it("returns drives and folders in the picker's shape", async () => {
    const { res, body } = await call();
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["drives", "folders"]);
    expect(body.drives[0]).toEqual({
      id: "mine",
      label: "My Drive",
      iconEmoji: null,
      audience: "Private",
      rootFolderId: null,
    });
    const core = body.folders.find((f: { id: string }) => f.id === "core-m");
    expect(core).toEqual({
      id: "core-m",
      driveId: "core",
      parentId: null,
      title: "Meeting notes",
      iconEmoji: null,
      itemCount: 0,
      folderType: "Meetings",
    });
  });

  it("keeps My Drive and its folders without an access check", async () => {
    const { body } = await call();
    expect(body.drives.map((d: { id: string }) => d.id)).toContain("mine");
    expect(body.folders.map((f: { id: string }) => f.id)).toContain("my-f");
    const checked = vi.mocked(getPageAccessBulk).mock.calls[0][1].map((p) => p.id);
    expect(checked).not.toContain("my-f");
  });

  it("drops folders the viewer cannot edit, lifting orphans to the top level", async () => {
    const { body } = await call();
    const ids = body.folders.map((f: { id: string }) => f.id);
    expect(ids).not.toContain("lab-ro");
    expect(ids).toContain("lab-ok");
    const kid = body.folders.find((f: { id: string }) => f.id === "lab-kid");
    expect(kid.parentId).toBeNull();
  });

  it("drops a process-root drive whose root the viewer cannot edit", async () => {
    const { body } = await call();
    const driveIds = body.drives.map((d: { id: string }) => d.id);
    expect(driveIds).toContain("core");
    expect(driveIds).not.toContain("hiring");
    expect(body.folders.map((f: { id: string }) => f.id)).not.toContain("hire-f");
  });

  it("checks the root folders along with the folders", async () => {
    await call();
    const checked = vi.mocked(getPageAccessBulk).mock.calls[0][1].map((p) => p.id);
    expect(checked).toEqual(expect.arrayContaining(["core-root", "hiring-root", "lab-ok", "p1-docs"]));
    expect(checked).not.toContain("p1");
  });

  it("offers a project's synthetic folder without a page access check", async () => {
    const { body } = await call();
    expect(body.folders.map((f: { id: string }) => f.id)).toEqual(expect.arrayContaining(["p1", "p1-docs"]));
  });

  it("loads every project for Core and only assigned ones otherwise", async () => {
    await call();
    expect(mockPrisma.project.findMany.mock.calls[0][0].where).toEqual({});
    vi.mocked(isCore).mockResolvedValue(false);
    await call();
    expect(mockPrisma.project.findMany.mock.calls[1][0].where).toEqual({ assignments: { some: { userId: "u1" } } });
    expect(mockPrisma.educationOffering.findMany.mock.calls[1][0].where).toEqual({
      instructors: { some: { userId: "u1" } },
    });
  });

  it("filters by q on title or path, returning matching folders and their drives", async () => {
    const { body } = await call("?q=MEETING");
    expect(body.folders.map((f: { id: string }) => f.id)).toEqual(["core-m"]);
    expect(body.drives.map((d: { id: string }) => d.id)).toEqual(["core"]);
  });

  it("matches q against the ancestor path", async () => {
    const { body } = await call("?q=atlas");
    expect(body.folders.map((f: { id: string }) => f.id)).toEqual(["p1", "p1-docs"]);
  });

  it("returns empty rows when q matches nothing", async () => {
    const { body } = await call("?q=zzz");
    expect(body).toEqual({ drives: [], folders: [] });
  });
});
