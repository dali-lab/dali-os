import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  handlePreflight: () => null,
  withCors: (_req: Request, res: Response) => res,
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isProjectMember } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import { action } from "../api.pages.$id.template";

const USER_ID = "user-1";

const mockPrisma = prisma as unknown as {
  page: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  project: { update: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
};

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/pages/page-1/template", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function run(body: unknown) {
  return action({ request: makeRequest(body), params: { id: "page-1" }, context: {} } as never);
}

const FREE_FORM_PAGE = {
  id: "page-1",
  workspaceType: "Lab" as const,
  workspaceId: null,
  archivedAt: null,
  kind: "FreeForm" as const,
  isTemplate: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "user" },
  } as never);
  mockPrisma.page.findUnique.mockResolvedValue(FREE_FORM_PAGE);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(false);
});

describe("POST /api/pages/:id/template — setTemplate", () => {
  it("toggles isTemplate when the caller can edit the page", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: true, canView: true, canComment: true });

    const res = await run({ intent: "setTemplate", isTemplate: true });

    expect(res.status).toBe(200);
    expect(mockPrisma.page.update).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: { isTemplate: true },
    });
  });

  it("403s a caller without edit access", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: false, canView: true, canComment: false });

    const res = await run({ intent: "setTemplate", isTemplate: true });

    expect(res.status).toBe(403);
    expect(mockPrisma.page.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/pages/:id/template — setProjectMeetingNoteTemplate", () => {
  const PROJECT_TEMPLATE = {
    ...FREE_FORM_PAGE,
    workspaceType: "Project" as const,
    workspaceId: "proj-1",
    isTemplate: true,
  };

  it("binds the project's meeting-note template for a staffed member", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(PROJECT_TEMPLATE);
    vi.mocked(isProjectMember).mockResolvedValue(true);

    const res = await run({ intent: "setProjectMeetingNoteTemplate", active: true });

    expect(res.status).toBe(200);
    expect(mockPrisma.project.update).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: { meetingNoteTemplateId: "page-1" },
    });
  });

  it("allows Core even without project membership", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(PROJECT_TEMPLATE);
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);

    const res = await run({ intent: "setProjectMeetingNoteTemplate", active: true });

    expect(res.status).toBe(200);
    expect(mockPrisma.project.update).toHaveBeenCalled();
  });

  it("403s someone who is neither Core nor staffed on the project", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(PROJECT_TEMPLATE);

    const res = await run({ intent: "setProjectMeetingNoteTemplate", active: true });

    expect(res.status).toBe(403);
    expect(mockPrisma.project.update).not.toHaveBeenCalled();
  });

  it("conditionally clears the binding, scoped to this page, when unset", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(PROJECT_TEMPLATE);
    vi.mocked(isProjectMember).mockResolvedValue(true);

    const res = await run({ intent: "setProjectMeetingNoteTemplate", active: false });

    expect(res.status).toBe(200);
    expect(mockPrisma.project.updateMany).toHaveBeenCalledWith({
      where: { id: "proj-1", meetingNoteTemplateId: "page-1" },
      data: { meetingNoteTemplateId: null },
    });
  });

  it("400s a page that isn't marked as a template yet", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...PROJECT_TEMPLATE, isTemplate: false });
    vi.mocked(isProjectMember).mockResolvedValue(true);

    const res = await run({ intent: "setProjectMeetingNoteTemplate", active: true });

    expect(res.status).toBe(400);
    expect(mockPrisma.project.update).not.toHaveBeenCalled();
  });

  it("400s a Lab page (not in a project's Drive)", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...FREE_FORM_PAGE, isTemplate: true });
    vi.mocked(isCore).mockResolvedValue(true);

    const res = await run({ intent: "setProjectMeetingNoteTemplate", active: true });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/pages/:id/template — setLabMeetingNoteDefault", () => {
  const LAB_TEMPLATE = { ...FREE_FORM_PAGE, isTemplate: true };

  it("Core sets this page as the lab default, clearing any previous holder", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(LAB_TEMPLATE);
    vi.mocked(isCore).mockResolvedValue(true);

    const res = await run({ intent: "setLabMeetingNoteDefault", meetingType: "Team", active: true });

    expect(res.status).toBe(200);
    expect(mockPrisma.page.updateMany).toHaveBeenCalledWith({
      where: { defaultMeetingNoteFor: "Team", id: { not: "page-1" } },
      data: { defaultMeetingNoteFor: null },
    });
    expect(mockPrisma.page.update).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: { defaultMeetingNoteFor: "Team" },
    });
  });

  it("403s a non-Core caller", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(LAB_TEMPLATE);

    const res = await run({ intent: "setLabMeetingNoteDefault", meetingType: "Team", active: true });

    expect(res.status).toBe(403);
    expect(mockPrisma.page.update).not.toHaveBeenCalled();
  });

  it("clears this page's own default when unset", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(LAB_TEMPLATE);
    vi.mocked(isCore).mockResolvedValue(true);

    const res = await run({ intent: "setLabMeetingNoteDefault", meetingType: "Team", active: false });

    expect(res.status).toBe(200);
    expect(mockPrisma.page.update).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: { defaultMeetingNoteFor: null },
    });
    expect(mockPrisma.page.updateMany).not.toHaveBeenCalled();
  });

  it("400s a project-scoped page", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({
      ...LAB_TEMPLATE,
      workspaceType: "Project" as const,
      workspaceId: "proj-1",
    });
    vi.mocked(isCore).mockResolvedValue(true);

    const res = await run({ intent: "setLabMeetingNoteDefault", meetingType: "Team", active: true });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/pages/:id/template — common guards", () => {
  it("404s a missing page", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(null);

    const res = await run({ intent: "setTemplate", isTemplate: true });

    expect(res.status).toBe(404);
  });

  it("400s a non-FreeForm page", async () => {
    mockPrisma.page.findUnique.mockResolvedValue({ ...FREE_FORM_PAGE, kind: "Folder" as const });

    const res = await run({ intent: "setTemplate", isTemplate: true });

    expect(res.status).toBe(400);
  });

  it("400s an invalid body", async () => {
    const res = await run({ intent: "setLabMeetingNoteDefault", meetingType: "NotAType", active: true });

    expect(res.status).toBe(400);
  });
});
