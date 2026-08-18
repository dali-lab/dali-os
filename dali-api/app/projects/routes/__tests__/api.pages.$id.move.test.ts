import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
  isProjectMember: vi.fn(),
  isLabMember: vi.fn(),
}));
vi.mock("~/lib/page-share-access.server", () => ({ canManageSharing: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/education/lib/access.server", () => ({ isOfferingManager: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { canManageSharing } from "~/lib/page-share-access.server";
import { isOfferingManager } from "~/education/lib/access.server";
import { logAuditEvent } from "~/lib/audit";
import { action } from "../api.pages.$id.move";

const m = prisma as any;

function req(body: unknown) {
  return new Request("http://localhost/api/pages/p1/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const call = (body: unknown) => action({ request: req(body), params: { id: "p1" } } as any);

function labPage(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    workspaceType: "Lab",
    workspaceId: null,
    kind: "FreeForm",
    archivedAt: null,
    createdById: "u1",
    systemKey: null,
    partnerVisible: false,
    publicVisible: false,
    projectAsOverview: null,
    projectAsPRD: null,
    ...over,
  };
}
function projectPage(over: Record<string, unknown> = {}) {
  return labPage({ workspaceType: "Project", workspaceId: "projA", ...over });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as any);
  vi.mocked(canManageSharing).mockResolvedValue(true);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(false);
  vi.mocked(isLabMember).mockResolvedValue(false);
  vi.mocked(isOfferingManager).mockResolvedValue(false);
  m.page.findMany.mockResolvedValue([]); // siblings + children default empty
  m.$transaction.mockResolvedValue([]);
});

/** Data passed to the FIRST prisma.page.update — the moved page. */
function movedUpdateData() {
  return m.page.update.mock.calls[0][0].data;
}

describe("POST /api/pages/:id/move", () => {
  it("same-workspace reorder works with no workspace fields (back-compat)", async () => {
    m.page.findUnique.mockResolvedValue(labPage());
    const res = await call({ parentPageId: null });
    expect(res.status).toBe(200);
    const data = movedUpdateData();
    expect(data.parentPageId).toBeNull();
    expect(data.workspaceType).toBeUndefined();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("moves Lab → Project when actor manages source and can edit destination", async () => {
    m.page.findUnique.mockResolvedValue(labPage());
    vi.mocked(isProjectMember).mockResolvedValue(true);
    const res = await call({ parentPageId: null, workspaceType: "Project", workspaceId: "projA" });
    expect(res.status).toBe(200);
    const data = movedUpdateData();
    expect(data.workspaceType).toBe("Project");
    expect(data.workspaceId).toBe("projA");
    expect(data.pinnedAt).toBeNull();
    // Leaving the lab shelf drops lab-wide access so it can't follow the doc.
    expect(data.linkAccess).toBe("Restricted");
    expect(data.linkPermission).toBe("View");
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "page.move-workspace" }),
    );
  });

  it("resets partner/public sharing when a doc leaves a project", async () => {
    m.page.findUnique.mockResolvedValue(projectPage({ partnerVisible: true, publicVisible: true }));
    vi.mocked(isLabMember).mockResolvedValue(true);
    const res = await call({ parentPageId: null, workspaceType: "Lab", workspaceId: null });
    expect(res.status).toBe(200);
    const data = movedUpdateData();
    expect(data.workspaceType).toBe("Lab");
    expect(data.partnerVisible).toBe(false);
    expect(data.publicVisible).toBe(false);
    // Landing on the lab shelf opens it to the whole lab (edit), the shelf default.
    expect(data.linkAccess).toBe("LabMembers");
    expect(data.linkPermission).toBe("Edit");
  });

  it("403 when the actor can't manage the source", async () => {
    m.page.findUnique.mockResolvedValue(labPage());
    vi.mocked(canManageSharing).mockResolvedValue(false);
    const res = await call({ parentPageId: null, workspaceType: "Project", workspaceId: "projA" });
    expect(res.status).toBe(403);
  });

  it("403 when the actor can't edit the destination", async () => {
    m.page.findUnique.mockResolvedValue(labPage());
    vi.mocked(isProjectMember).mockResolvedValue(false);
    vi.mocked(isCore).mockResolvedValue(false);
    const res = await call({ parentPageId: null, workspaceType: "Project", workspaceId: "projA" });
    expect(res.status).toBe(403);
  });

  it("400 when moving a system folder cross-workspace", async () => {
    m.page.findUnique.mockResolvedValue(
      projectPage({ kind: "Folder", systemKey: "project:projA:team-meeting-notes" }),
    );
    vi.mocked(isLabMember).mockResolvedValue(true);
    const res = await call({ parentPageId: null, workspaceType: "Lab", workspaceId: null });
    expect(res.status).toBe(400);
  });

  it("400 when moving the Overview/PRD doc out of its project", async () => {
    m.page.findUnique.mockResolvedValue(projectPage({ projectAsOverview: { id: "projA" } }));
    vi.mocked(isLabMember).mockResolvedValue(true);
    const res = await call({ parentPageId: null, workspaceType: "Lab", workspaceId: null });
    expect(res.status).toBe(400);
  });

  it("rejects a Member destination via the enum (400)", async () => {
    m.page.findUnique.mockResolvedValue(labPage());
    const res = await call({ parentPageId: null, workspaceType: "Member", workspaceId: "u2" });
    expect(res.status).toBe(400);
  });

  it("403 moving to an EducationOffering the user doesn't manage", async () => {
    m.page.findUnique.mockResolvedValue(labPage());
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    const res = await call({ parentPageId: null, workspaceType: "EducationOffering", workspaceId: "off1" });
    expect(res.status).toBe(403);
  });

  it("moves into an EducationOffering the user manages (200)", async () => {
    m.page.findUnique.mockResolvedValue(labPage());
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    const res = await call({ parentPageId: null, workspaceType: "EducationOffering", workspaceId: "off1" });
    expect(res.status).toBe(200);
  });

  it("cascades a folder's children to the new workspace (keeping their parent)", async () => {
    m.page.findUnique.mockResolvedValue(projectPage({ kind: "Folder" }));
    vi.mocked(isProjectMember).mockResolvedValue(true);
    // first findMany = children of the folder, second = destination siblings
    m.page.findMany.mockResolvedValueOnce([{ id: "c1" }, { id: "c2" }]).mockResolvedValueOnce([]);
    const res = await call({ parentPageId: null, workspaceType: "Project", workspaceId: "projB" });
    expect(res.status).toBe(200);
    const childUpdates = m.page.update.mock.calls
      .map((c: any) => c[0])
      .filter((u: any) => u.where.id === "c1" || u.where.id === "c2");
    expect(childUpdates.length).toBe(2);
    for (const u of childUpdates) {
      expect(u.data.workspaceType).toBe("Project");
      expect(u.data.workspaceId).toBe("projB");
      expect(u.data.parentPageId).toBeUndefined(); // children stay under the folder
    }
  });
});
