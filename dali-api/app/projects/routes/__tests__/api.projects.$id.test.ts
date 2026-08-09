import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireCore: vi.fn() }));
vi.mock("~/lib/db");
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { requireCore } from "~/lib/auth";
import { prisma } from "~/lib/db";
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
    count: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
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

const MEETING_NOTES_FOLDERS = [
  { id: "page-team-notes", contentDocId: null },
  { id: "page-partner-notes", contentDocId: null },
];

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
    findMany: vi.fn().mockResolvedValue(MEETING_NOTES_FOLDERS),
    count: vi.fn().mockResolvedValue(0),
    deleteMany: vi.fn().mockReturnValue("page-delete-op"),
  };
  for (const model of [
    "timeEntry",
    "budgetEntry",
    "budgetNote",
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

describe("DELETE /api/projects/:id", () => {
  it("does not treat the auto-created meeting-notes folders as blocking documents", async () => {
    const res = await call();

    expect(res.status).toBe(200);
    // page.count must exclude both the overview page and the two meeting-notes
    // folders, or the delete would 409 on "documents" for every real project.
    const countArgs = mockPrisma.page.count.mock.calls[0]![0];
    expect(countArgs.where.id.notIn).toEqual(
      expect.arrayContaining(["page-overview", "page-team-notes", "page-partner-notes"]),
    );
  });

  it("cleans up the meeting-notes folders in the same transaction as overview/PRD pages", async () => {
    await call();

    expect(mockPrisma.page.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["page-overview", "page-team-notes", "page-partner-notes"] } },
    });
  });

  it("still blocks deletion when a genuine authored document exists", async () => {
    mockPrisma.page.count.mockResolvedValueOnce(1);

    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.blocking).toEqual(
      expect.arrayContaining([{ label: "documents", count: 1 }]),
    );
  });
});
