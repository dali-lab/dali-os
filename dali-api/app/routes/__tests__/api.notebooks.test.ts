import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireMemberSession: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handlePreflight: () => null,
}));
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
    createNotebook: vi.fn(),
  };
});

import { requireMemberSession } from "~/lib/auth";
import { NotebookError, createNotebook } from "~/lib/notebooks.server";
import { action } from "~/routes/api.notebooks";

function post(body: unknown, method = "POST") {
  return action({
    request: new Request("http://os.test/api/notebooks", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    }),
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as never);
  vi.mocked(createNotebook).mockResolvedValue({ id: "nb1" });
});

describe("POST /api/notebooks", () => {
  it("creates a notebook for the signed-in member", async () => {
    const res = await post({ title: "Standups", workspaceType: "Lab", parentPageId: "f1", templatePageId: "t1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "nb1" });
    expect(createNotebook).toHaveBeenCalledWith({
      title: "Standups",
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: "f1",
      templatePageId: "t1",
      actorId: "u1",
    });
  });

  it("returns the session gate's response when not a member", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({
      ok: false,
      response: new Response("no", { status: 403 }),
    } as never);
    expect((await post({ title: "x", workspaceType: "Lab" })).status).toBe(403);
    expect(createNotebook).not.toHaveBeenCalled();
  });

  it("400s a body without a title or with an unknown workspace", async () => {
    expect((await post({ workspaceType: "Lab" })).status).toBe(400);
    expect((await post({ title: "x", workspaceType: "Member" })).status).toBe(400);
    expect(createNotebook).not.toHaveBeenCalled();
  });

  it("405s anything but POST", async () => {
    expect((await post(null, "PUT")).status).toBe(405);
  });

  it("maps a library refusal to its status", async () => {
    vi.mocked(createNotebook).mockRejectedValue(new NotebookError("You can't put things in that folder", 403));
    const res = await post({ title: "x", workspaceType: "Lab", parentPageId: "f1" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You can't put things in that folder" });
  });
});
