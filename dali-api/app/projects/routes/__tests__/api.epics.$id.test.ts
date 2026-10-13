import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireProjectEditAccess: vi.fn() }));
vi.mock("~/lib/db", () => ({ prisma: { epic: { findUnique: vi.fn(), update: vi.fn() } } }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/projects/lib/sprints.server", () => ({
  deleteEpic: vi.fn(),
  GENERAL_EPIC_TITLE: "General",
}));

import { requireProjectEditAccess } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { deleteEpic } from "~/projects/lib/sprints.server";
import { action } from "~/projects/routes/api.epics.$id";

const EPIC_ID = "epic-1";
const findEpic = vi.mocked(prisma.epic.findUnique);
const updateEpic = vi.mocked(prisma.epic.update);

function call(method: "POST" | "DELETE", body?: unknown) {
  const request = new Request(`http://localhost/api/epics/${EPIC_ID}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return action({ request, params: { id: EPIC_ID } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireProjectEditAccess).mockResolvedValue({ ok: true } as any);
  findEpic.mockResolvedValue({ id: EPIC_ID, projectId: "proj-1", title: "Auth", cancelledAt: null } as any);
});

describe("POST /api/epics/:id", () => {
  it("updates title and description", async () => {
    const res = await call("POST", { title: "  Login  ", description: "" });
    expect(res.status).toBe(200);
    expect(updateEpic).toHaveBeenCalledWith({
      where: { id: EPIC_ID },
      data: { title: "Login", description: null },
    });
  });

  it("cancels and reopens via the cancelled flag", async () => {
    await call("POST", { cancelled: true });
    expect(updateEpic.mock.calls[0]![0].data.cancelledAt).toBeInstanceOf(Date);
    findEpic.mockResolvedValue({ id: EPIC_ID, projectId: "proj-1", title: "Auth", cancelledAt: new Date() } as any);
    await call("POST", { cancelled: false });
    expect(updateEpic.mock.calls[1]![0].data).toEqual({ cancelledAt: null });
  });

  it("doesn't restamp an already-cancelled epic", async () => {
    findEpic.mockResolvedValue({ id: EPIC_ID, projectId: "proj-1", title: "Auth", cancelledAt: new Date() } as any);
    await call("POST", { cancelled: true });
    expect(updateEpic.mock.calls[0]![0].data).toEqual({});
  });

  it("rejects a blank title and the retired date/status fields' bad types", async () => {
    expect((await call("POST", { title: "  " })).status).toBe(400);
    expect((await call("POST", { cancelled: "yes" })).status).toBe(400);
  });

  it("404s an unknown epic and defers to the access gate", async () => {
    findEpic.mockResolvedValueOnce(null);
    expect((await call("POST", {})).status).toBe(404);
    vi.mocked(requireProjectEditAccess).mockResolvedValueOnce({
      ok: false,
      response: new Response(null, { status: 403 }),
    } as any);
    expect((await call("POST", {})).status).toBe(403);
  });
});

describe("DELETE /api/epics/:id", () => {
  it("deletes via deleteEpic (tasks move to General)", async () => {
    vi.mocked(deleteEpic).mockResolvedValue("ok");
    const res = await call("DELETE");
    expect(res.status).toBe(200);
    expect(deleteEpic).toHaveBeenCalledWith(EPIC_ID, "proj-1");
  });

  it("409s deleting General while it holds tasks", async () => {
    vi.mocked(deleteEpic).mockResolvedValue("general-in-use");
    expect((await call("DELETE")).status).toBe(409);
  });
});
