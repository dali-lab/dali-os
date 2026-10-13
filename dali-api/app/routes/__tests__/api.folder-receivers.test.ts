import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/lib/drive-receivers.server", async () => {
  const actual = await vi.importActual<typeof import("~/lib/drive-receivers.server")>("~/lib/drive-receivers.server");
  return {
    ...actual,
    setReceiver: vi.fn(),
    clearReceiver: vi.fn(),
    setFolderHint: vi.fn(),
    findReceiver: vi.fn(),
    folderPath: vi.fn(),
  };
});

import { requireAuth } from "~/lib/auth";
import { isCore, isProjectMember } from "~/lib/roles";
import { getPageAccess } from "~/lib/pageAccess.server";
import {
  ReceiverError,
  clearReceiver,
  findReceiver,
  folderPath,
  setFolderHint,
  setReceiver,
} from "~/lib/drive-receivers.server";
import { loader, action } from "~/routes/api.folder-receivers";

function get(query: string) {
  return loader({ request: new Request(`http://os.test/api/folder-receivers?${query}`) } as any);
}
function post(body: unknown) {
  return action({
    request: new Request("http://os.test/api/folder-receivers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as any);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as any);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(false);
});

describe("GET /api/folder-receivers", () => {
  it("returns every slot of the process with the current folder and its path", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(findReceiver).mockImplementation(async (slot) => (slot.folderType === "HiringForms" ? "f1" : null));
    vi.mocked(folderPath).mockResolvedValue([
      { id: "hroot", title: "Hiring" },
      { id: "f1", title: "26F forms" },
    ]);

    const res = await get("processType=HiringCycle");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      slots: [
        {
          folderType: "HiringForms",
          label: "Hiring forms",
          folder: {
            id: "f1",
            title: "26F forms",
            path: [
              { id: "hroot", title: "Hiring" },
              { id: "f1", title: "26F forms" },
            ],
          },
        },
        { folderType: "ApplicationTemplates", label: "Application templates", folder: null },
      ],
    });
    expect(findReceiver).toHaveBeenCalledWith({ processType: "HiringCycle", processId: "hiring", folderType: "HiringForms" });
  });

  it("uses the given id for a project", async () => {
    vi.mocked(isProjectMember).mockResolvedValue(true);
    vi.mocked(findReceiver).mockResolvedValue(null);
    const res = await get("processType=Project&processId=p1");
    expect(res.status).toBe(200);
    expect(findReceiver).toHaveBeenCalledWith({ processType: "Project", processId: "p1", folderType: "Meetings" });
  });

  it("rejects an unknown process type", async () => {
    expect((await get("processType=Nope")).status).toBe(400);
  });

  it("rejects a project with no id", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    expect((await get("processType=Project")).status).toBe(400);
  });

  it("403s a non-Core member on a Core-only process", async () => {
    expect((await get("processType=Core")).status).toBe(403);
    expect((await get("processType=Lab")).status).toBe(403);
  });

  it("403s a non-member on a project", async () => {
    expect((await get("processType=Project&processId=p1")).status).toBe(403);
  });
});

describe("POST /api/folder-receivers", () => {
  const set = { intent: "set", processType: "Core", folderType: "Agreements", folderId: "f1" };

  it("sets a receiver for Core", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const res = await post(set);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, folderId: "f1" });
    expect(setReceiver).toHaveBeenCalledWith({ processType: "Core", processId: "core", folderType: "Agreements" }, "f1", "u1");
  });

  it("ignores a client-supplied processId for a singleton process", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    await post({ ...set, processId: "spoofed" });
    expect(setReceiver).toHaveBeenCalledWith(expect.objectContaining({ processId: "core" }), "f1", "u1");
  });

  it("403s a non-Core member and writes nothing", async () => {
    const res = await post(set);
    expect(res.status).toBe(403);
    expect(setReceiver).not.toHaveBeenCalled();
  });

  it("lets a project member set their project's Meetings receiver", async () => {
    vi.mocked(isProjectMember).mockResolvedValue(true);
    const res = await post({ intent: "set", processType: "Project", processId: "p1", folderType: "Meetings", folderId: "f1" });
    expect(res.status).toBe(200);
    expect(setReceiver).toHaveBeenCalledWith({ processType: "Project", processId: "p1", folderType: "Meetings" }, "f1", "u1");
  });

  it("403s a non-member on a project", async () => {
    const res = await post({ intent: "set", processType: "Project", processId: "p1", folderType: "Meetings", folderId: "f1" });
    expect(res.status).toBe(403);
  });

  it("400s a folder type the process does not accept", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const res = await post({ ...set, processType: "HiringCycle" });
    expect(res.status).toBe(400);
    expect(setReceiver).not.toHaveBeenCalled();
  });

  it("400s a body that fails validation", async () => {
    expect((await post({ intent: "set", processType: "Core" })).status).toBe(400);
    expect((await post({ intent: "wat" })).status).toBe(400);
  });

  it("surfaces a ReceiverError with its status and message", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(setReceiver).mockRejectedValue(new ReceiverError("Already used", 409));
    const res = await post(set);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Already used" });
  });

  it("clears a receiver", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(clearReceiver).mockResolvedValue("f1");
    const res = await post({ intent: "clear", processType: "Mentorship", folderType: "MentorNotebooks" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, clearedFolderId: "f1" });
    expect(clearReceiver).toHaveBeenCalledWith({ processType: "Mentorship", processId: "mentorship", folderType: "MentorNotebooks" }, "u1");
  });

  it("sets a hint when the user can edit the folder", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: true, canComment: true } as any);
    const res = await post({ intent: "hint", folderId: "f1", hint: "Meetings" });
    expect(res.status).toBe(200);
    expect(setFolderHint).toHaveBeenCalledWith("f1", "Meetings", "u1");
  });

  it("clears a hint with null", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: true, canComment: true } as any);
    await post({ intent: "hint", folderId: "f1", hint: null });
    expect(setFolderHint).toHaveBeenCalledWith("f1", null, "u1");
  });

  it("403s a hint from someone who can't edit the folder", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: false, canComment: false } as any);
    const res = await post({ intent: "hint", folderId: "f1", hint: "Meetings" });
    expect(res.status).toBe(403);
    expect(setFolderHint).not.toHaveBeenCalled();
  });

  it("404s a hint for a folder that does not exist", async () => {
    vi.mocked(getPageAccess).mockRejectedValue(new Error("Page not found"));
    const res = await post({ intent: "hint", folderId: "gone", hint: "Meetings" });
    expect(res.status).toBe(404);
  });

  it("400s a hint other than Meetings", async () => {
    expect((await post({ intent: "hint", folderId: "f1", hint: "Agreements" })).status).toBe(400);
  });

  it("405s a non-POST", async () => {
    const res = await action({ request: new Request("http://os.test/api/folder-receivers", { method: "PUT" }) } as any);
    expect(res.status).toBe(405);
  });
});
