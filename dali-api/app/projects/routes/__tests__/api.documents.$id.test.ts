import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
  },
}));
vi.mock("~/lib/auth", () => ({
  requireMemberSession: vi.fn(),
  requireProjectEditAccess: vi.fn(),
}));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));

import { prisma } from "~/lib/db";
import { requireMemberSession, requireProjectEditAccess } from "~/lib/auth";
import { getPageAccess } from "~/lib/pageAccess.server";
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
function del() {
  return action({
    request: new Request("http://localhost/api/documents/p1", { method: "DELETE" }),
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
});

// The doc editor's title box posts here whatever workspace the page is in, so a
// personal note has to be renameable through this route.
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
