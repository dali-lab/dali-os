import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireCore: vi.fn() }));
vi.mock("~/lib/db.server");
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { requireCore } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { action } from "~/projects/routes/api.projects.$id";

const PROJECT_ID = "proj-1";

const mockPrisma = prisma as unknown as {
  project: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  page: {
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  projectFile: { findMany: ReturnType<typeof vi.fn> };
  form: { findMany: ReturnType<typeof vi.fn> };
  timeEntry: { count: ReturnType<typeof vi.fn> };
  budgetEntry: { count: ReturnType<typeof vi.fn> };
  budgetNote: { count: ReturnType<typeof vi.fn> };
  projectAssignment: { count: ReturnType<typeof vi.fn> };
  epic: { count: ReturnType<typeof vi.fn> };
  sprint: { count: ReturnType<typeof vi.fn> };
  task: { count: ReturnType<typeof vi.fn> };
  scheduledMeeting: { count: ReturnType<typeof vi.fn> };
  mentorshipPair: { count: ReturnType<typeof vi.fn> };
  externalMentor: { count: ReturnType<typeof vi.fn> };
  projectTermStatus: { count: ReturnType<typeof vi.fn> };
  projectRoleRequest: { count: ReturnType<typeof vi.fn> };
  projectPartner: { count: ReturnType<typeof vi.fn> };
  staffingPreference: { count: ReturnType<typeof vi.fn> };
  essentialityForm: { count: ReturnType<typeof vi.fn> };
  staffingAssignment: { count: ReturnType<typeof vi.fn> };
  mentorNote: { count: ReturnType<typeof vi.fn> };
  collabDocument: { deleteMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function call() {
  const request = new Request(`http://localhost/api/projects/${PROJECT_ID}`, {
    method: "DELETE",
  });
  return action({ request, params: { id: PROJECT_ID } } as any);
}

const folder = (id: string, parentPageId: string | null = null) => ({
  id,
  kind: "Folder",
  parentPageId,
  contentDocId: null,
});
const doc = (id: string, parentPageId: string | null = null) => ({
  id,
  kind: "FreeForm",
  parentPageId,
  contentDocId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCore).mockResolvedValue({
    ok: true,
    auth: { user: { sub: "user-1" } },
  } as any);

  mockPrisma.project = {
    findUnique: vi.fn().mockResolvedValue({
      id: PROJECT_ID,
      name: "Test Project",
      overviewPageId: "page-overview",
      prdPageId: null,
    }),
    update: vi.fn().mockReturnValue("project-update-op"),
    delete: vi.fn().mockReturnValue("project-delete-op"),
  };
  mockPrisma.page = {
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockReturnValue("page-delete-op"),
  };
  mockPrisma.projectFile = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.form = { findMany: vi.fn().mockResolvedValue([]) };
  for (const model of [
    "timeEntry",
    "budgetEntry",
    "budgetNote",
    "projectChartString",
    "projectAssignment",
    "epic",
    "sprint",
    "task",
    "scheduledMeeting",
    "mentorshipPair",
    "externalMentor",
    "projectTermStatus",
    "projectRoleRequest",
    "projectPartner",
    "staffingPreference",
    "essentialityForm",
    "staffingAssignment",
    "mentorNote",
  ] as const) {
    (mockPrisma as any)[model] = { count: vi.fn().mockResolvedValue(0) };
  }
  mockPrisma.collabDocument = { deleteMany: vi.fn().mockReturnValue("doc-delete-op") };
  mockPrisma.$transaction = vi.fn().mockImplementation((cb: any) => cb(mockPrisma));
});

function livePages(...pages: Array<ReturnType<typeof folder> | ReturnType<typeof doc>>) {
  // The first findMany is the project's live pages; later ones (system pages) are not.
  mockPrisma.page.findMany.mockImplementation(({ where }: any) =>
    Promise.resolve(where.workspaceType === "Project" ? pages : []),
  );
}

describe("DELETE /api/projects/:id", () => {
  it("deletes a project whose only pages are empty folders, and removes those folders", async () => {
    livePages(folder("f-team"), folder("f-receiver"));

    const res = await call();

    expect(res.status).toBe(200);
    expect(mockPrisma.page.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["page-overview", "f-team", "f-receiver"] } },
    });
  });

  it("blocks on a genuine authored document", async () => {
    livePages(doc("d1"));

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.blocking).toEqual(expect.arrayContaining([{ label: "documents", count: 1 }]));
  });

  it("counts a folder holding a page as a blocker, plus the page itself", async () => {
    livePages(folder("f1"), doc("d1", "f1"));

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.blocking).toEqual(expect.arrayContaining([{ label: "documents", count: 2 }]));
    expect(mockPrisma.page.deleteMany).not.toHaveBeenCalled();
  });

  it("counts a folder holding a file as non-empty", async () => {
    livePages(folder("f1"));
    mockPrisma.projectFile.findMany.mockResolvedValue([{ folderPageId: "f1" }]);

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.blocking).toEqual(expect.arrayContaining([{ label: "documents", count: 1 }]));
  });

  it("counts a folder holding a form as non-empty", async () => {
    livePages(folder("f1"));
    mockPrisma.form.findMany.mockResolvedValue([{ folderPageId: "f1" }]);

    const res = await call();

    expect(res.status).toBe(409);
  });

  it("only looks at live pages in the project workspace, excluding the overview and PRD", async () => {
    await call();

    expect(mockPrisma.page.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceType: "Project",
          workspaceId: PROJECT_ID,
          id: { notIn: ["page-overview"] },
          archivedAt: null,
        },
      }),
    );
  });

  it("blocks deletion on chart string history rather than failing on the FK", async () => {
    // ProjectChartString restricts deletes; an uncounted row would be a 500.
    (mockPrisma as any).projectChartString.count.mockResolvedValueOnce(2);

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.blocking).toEqual(
      expect.arrayContaining([{ label: "chart strings", count: 2 }]),
    );
  });
});
