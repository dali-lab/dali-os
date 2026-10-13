import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    projectFile: { count: vi.fn() },
    form: { count: vi.fn() },
    signingDocument: { count: vi.fn() },
    rubric: { count: vi.fn() },
  },
}));
vi.mock("~/lib/auth", () => ({
  requireMemberSession: vi.fn(),
  requireProjectEditAccess: vi.fn(),
}));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/notebooks.server", () => {
  class NotebookError extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  }
  return {
    NotebookError,
    notebookErrorResponse: (err: unknown) => {
      if (err instanceof NotebookError) return Response.json({ error: err.message }, { status: err.status });
      throw err;
    },
    trashNotebook: vi.fn(),
  };
});
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));

import { prisma } from "~/lib/db";
import { requireMemberSession, requireProjectEditAccess } from "~/lib/auth";
import { getPageAccess } from "~/lib/pageAccess.server";
import { NotebookError, trashNotebook } from "~/lib/notebooks.server";
import { action } from "../api.documents.$id";

const m = prisma as any;

function post(body: unknown) {
  return action({
    request: new Request("http://localhost/api/documents/p1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: "p1" },
  } as any);
}
function del(query = "") {
  return action({
    request: new Request(`http://localhost/api/documents/p1${query}`, { method: "DELETE" }),
    params: { id: "p1" },
  } as any);
}

/** A personal note in My Drive, owned by u1. */
function notePage(over: Record<string, unknown> = {}) {
  return { id: "p1", workspaceType: "Member", workspaceId: "u1", kind: "FreeForm", ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({
    ok: true,
    auth: { user: { sub: "u1" } },
  } as any);
  vi.mocked(requireProjectEditAccess).mockResolvedValue({
    ok: true,
    auth: { user: { sub: "u1" } },
  } as any);
  vi.mocked(getPageAccess).mockResolvedValue({ canEdit: false } as any);
  m.page.update.mockResolvedValue({});
  m.page.count.mockResolvedValue(0);
  m.projectFile.count.mockResolvedValue(0);
  m.form.count.mockResolvedValue(0);
  m.signingDocument.count.mockResolvedValue(0);
  m.rubric.count.mockResolvedValue(0);
});

/** A Lab folder — the container the delete guard has to check the contents of. */
function labFolder(over: Record<string, unknown> = {}) {
  return { id: "p1", workspaceType: "Lab", workspaceId: null, kind: "Folder", ...over };
}

// "Empty" has to mean empty of everything a folder holds. Counting only
// sub-pages let a folder full of uploads be archived, stranding every file
// inside it behind a dead parent with no way back.
describe("DELETE /api/documents/:id — folder contents guard", () => {
  beforeEach(() => {
    // Lab pages now resolve through getPageAccess; these cases are about the
    // contents guard, so grant edit and let that run.
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: true } as any);
  });

  it("archives a folder that holds nothing", async () => {
    m.page.findUnique.mockResolvedValue(labFolder());
    const res = await del();
    expect(res.status).toBe(200);
    expect(m.page.update.mock.calls[0][0].data.archivedAt).toBeInstanceOf(Date);
  });

  it.each([
    ["files", "projectFile"],
    ["forms", "form"],
    ["agreements", "signingDocument"],
    ["rubrics", "rubric"],
    ["sub-pages", "page"],
  ])("refuses a folder that still holds %s", async (_label, model) => {
    m.page.findUnique.mockResolvedValue(labFolder());
    m[model].count.mockResolvedValue(2);
    const res = await del();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/still holds 2 items/);
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("counts every kind together in the message", async () => {
    m.page.findUnique.mockResolvedValue(labFolder());
    m.page.count.mockResolvedValue(1);
    m.projectFile.count.mockResolvedValue(1);
    m.form.count.mockResolvedValue(1);
    const res = await del();
    expect((await res.json()).error).toMatch(/still holds 3 items/);
  });

  it("leaves non-folder deletes alone (no content queries)", async () => {
    m.page.findUnique.mockResolvedValue(labFolder({ kind: "FreeForm" }));
    const res = await del();
    expect(res.status).toBe(200);
    expect(m.projectFile.count).not.toHaveBeenCalled();
  });
});

// The filing toast's Undo trashes the notebook it created, but only if the note
// it just removed was the last one in it.
describe("DELETE /api/documents/:id?ifEmpty=1 — notebooks", () => {
  beforeEach(() => {
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: true } as any);
    m.page.findUnique.mockResolvedValue(labFolder({ kind: "Notebook" }));
  });

  it("trashes a notebook with no live notes", async () => {
    const res = await del("?ifEmpty=1");
    expect(res.status).toBe(200);
    expect(m.page.count).toHaveBeenCalledWith({ where: { parentPageId: "p1", archivedAt: null } });
    expect(trashNotebook).toHaveBeenCalledWith("p1", expect.any(String));
  });

  it("keeps a notebook that still has notes", async () => {
    m.page.count.mockResolvedValue(1);
    const res = await del("?ifEmpty=1");
    expect(res.status).toBe(409);
    expect(trashNotebook).not.toHaveBeenCalled();
  });

  it("trashes a notebook with notes when the guard is not asked for", async () => {
    m.page.count.mockResolvedValue(3);
    const res = await del();
    expect(res.status).toBe(200);
    expect(trashNotebook).toHaveBeenCalledWith("p1", expect.any(String));
  });

  it("ignores the guard on a page that is not a notebook", async () => {
    m.page.findUnique.mockResolvedValue(labFolder({ kind: "FreeForm" }));
    m.page.count.mockResolvedValue(5);
    const res = await del("?ifEmpty=1");
    expect(res.status).toBe(200);
  });
});

// The doc editor's title box posts here whatever workspace the page is in, so a
// personal note has to be renameable through this route.
describe("DELETE /api/documents/:id — Drive roots", () => {
  beforeEach(() => {
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: true } as any);
  });

  it("400s on a root and archives nothing, even an empty one", async () => {
    m.page.findUnique.mockResolvedValue(labFolder({ folderType: "Root" }));
    const res = await del();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("This is a Drive root and can't be deleted");
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("still archives a folder that only carries a receiver type", async () => {
    m.page.findUnique.mockResolvedValue(labFolder({ folderType: "Meetings" }));
    const res = await del();
    expect(res.status).toBe(200);
  });

  it("clears the receiver columns in the same update that archives the folder", async () => {
    m.page.findUnique.mockResolvedValue(labFolder({ folderType: "HiringForms" }));
    const res = await del();
    expect(res.status).toBe(200);
    expect(m.page.update).toHaveBeenCalledTimes(1);
    expect(m.page.update.mock.calls[0][0].data).toEqual({
      archivedAt: expect.any(Date),
      folderType: null,
      processType: null,
      processId: null,
    });
  });
});

describe("POST /api/documents/:id — personal notes", () => {
  it("renames the owner's own note", async () => {
    m.page.findUnique.mockResolvedValue(notePage());
    const res = await post({ title: "  Retreat notes  " });
    expect(res.status).toBe(200);
    expect(m.page.update.mock.calls[0][0].data.title).toBe("Retreat notes");
  });

  it("lets someone with an Edit share rename it", async () => {
    m.page.findUnique.mockResolvedValue(notePage({ workspaceId: "u2" }));
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: true } as any);
    const res = await post({ title: "Retreat notes" });
    expect(res.status).toBe(200);
  });

  it("404 when the caller has no edit grant on someone else's note", async () => {
    m.page.findUnique.mockResolvedValue(notePage({ workspaceId: "u2" }));
    const res = await post({ title: "Retreat notes" });
    expect(res.status).toBe(404);
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("archives only for the owner, never an Edit sharee", async () => {
    m.page.findUnique.mockResolvedValue(notePage({ workspaceId: "u2" }));
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: true } as any);
    const res = await del();
    expect(res.status).toBe(404);
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("archives the owner's own note", async () => {
    m.page.findUnique.mockResolvedValue(notePage());
    const res = await del();
    expect(res.status).toBe(200);
    expect(m.page.update.mock.calls[0][0].data.archivedAt).toBeInstanceOf(Date);
  });
});

// The Lab workspace also holds the Core-scoped folders, so the bare
// lab-member gate let any member rename or delete Core's Agreements folder
// through this endpoint. The Drive hid those folders; the API didn't.
describe("Lab pages resolve through getPageAccess, not bare lab membership", () => {
  it("404s a rename when the caller can't edit the page", async () => {
    m.page.findUnique.mockResolvedValue(labFolder({ kind: "FreeForm" }));
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: false } as any);
    const res = await post({ title: "Renamed" });
    expect(res.status).toBe(404);
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("404s a delete when the caller can't edit the page", async () => {
    m.page.findUnique.mockResolvedValue(labFolder());
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: false } as any);
    const res = await del();
    expect(res.status).toBe(404);
    expect(m.page.update).not.toHaveBeenCalled();
  });

  it("allows both when the caller can edit", async () => {
    m.page.findUnique.mockResolvedValue(labFolder({ kind: "FreeForm" }));
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: true } as any);
    expect((await post({ title: "Renamed" })).status).toBe(200);
    expect((await del()).status).toBe(200);
  });
});

// The Drive's Education space routes rename and delete through this endpoint,
// and the route used to reject EducationOffering outright — so neither worked
// anywhere in that space.
describe("EducationOffering pages", () => {
  const offeringPage = (over: Record<string, unknown> = {}) => ({
    id: "p1",
    workspaceType: "EducationOffering",
    workspaceId: "off1",
    kind: "FreeForm",
    ...over,
  });

  it("renames one the caller can edit", async () => {
    m.page.findUnique.mockResolvedValue(offeringPage());
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: true } as any);
    const res = await post({ title: "Week 3 notes" });
    expect(res.status).toBe(200);
    expect(m.page.update.mock.calls[0][0].data.title).toBe("Week 3 notes");
  });

  it("deletes one the caller can edit", async () => {
    m.page.findUnique.mockResolvedValue(offeringPage());
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: true } as any);
    const res = await del();
    expect(res.status).toBe(200);
    expect(m.page.update.mock.calls[0][0].data.archivedAt).toBeInstanceOf(Date);
  });

  it("404s for a student with no edit grant", async () => {
    m.page.findUnique.mockResolvedValue(offeringPage());
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: false } as any);
    expect((await post({ title: "x" })).status).toBe(404);
    expect(m.page.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/documents/:id — notebooks", () => {
  const notebook = (over: Record<string, unknown> = {}) => labFolder({ kind: "Notebook", ...over });

  beforeEach(() => {
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: true } as any);
    vi.mocked(trashNotebook).mockReset();
  });

  it("trashes the notebook with its tabs instead of archiving the container alone", async () => {
    m.page.findUnique.mockResolvedValue(notebook());
    const res = await del();
    expect(res.status).toBe(200);
    expect(trashNotebook).toHaveBeenCalledWith("p1", "u1");
    expect(m.page.update).not.toHaveBeenCalled();
    expect(m.page.count).not.toHaveBeenCalled();
  });

  it("does the same for a project notebook behind the project gate", async () => {
    m.page.findUnique.mockResolvedValue(notebook({ workspaceType: "Project", workspaceId: "proj1" }));
    const res = await del();
    expect(res.status).toBe(200);
    expect(requireProjectEditAccess).toHaveBeenCalled();
    expect(trashNotebook).toHaveBeenCalledWith("p1", "u1");
  });

  it("maps a library refusal to its status", async () => {
    m.page.findUnique.mockResolvedValue(notebook());
    vi.mocked(trashNotebook).mockRejectedValue(new NotebookError("You can't edit this notebook", 403));
    expect((await del()).status).toBe(403);
  });

  it("404s a caller who cannot edit the page before trashing anything", async () => {
    m.page.findUnique.mockResolvedValue(notebook());
    vi.mocked(getPageAccess).mockResolvedValue({ canEdit: false } as any);
    expect((await del()).status).toBe(404);
    expect(trashNotebook).not.toHaveBeenCalled();
  });

  it("leaves a rename of a notebook on the ordinary path", async () => {
    m.page.findUnique.mockResolvedValue(notebook());
    expect((await post({ title: "Renamed" })).status).toBe(200);
    expect(m.page.update.mock.calls[0][0].data.title).toBe("Renamed");
    expect(trashNotebook).not.toHaveBeenCalled();
  });
});
