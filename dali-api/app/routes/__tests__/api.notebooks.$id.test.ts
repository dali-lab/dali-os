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
    addToNotebook: vi.fn(),
    dissolveNotebook: vi.fn(),
    getNotebook: vi.fn(),
    mergeNotebooks: vi.fn(),
    setNotebookTemplate: vi.fn(),
    trashNotebook: vi.fn(),
  };
});

import { requireMemberSession } from "~/lib/auth";
import * as lib from "~/lib/notebooks.server";
import { action, loader } from "~/routes/api.notebooks.$id";

const NotebookError = lib.NotebookError;

function post(body: unknown, method = "POST") {
  return action({
    request: new Request("http://os.test/api/notebooks/nb1", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    }),
    params: { id: "nb1" },
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as never);
});

describe("GET /api/notebooks/:id", () => {
  it("returns the notebook with its tabs", async () => {
    vi.mocked(lib.getNotebook).mockResolvedValue({ id: "nb1", tabs: [] } as never);
    const res = (await loader({ request: new Request("http://os.test/api/notebooks/nb1"), params: { id: "nb1" } } as never)) as Response;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "nb1", tabs: [] });
    expect(lib.getNotebook).toHaveBeenCalledWith("nb1", "u1");
  });

  it("gates on membership and maps a hidden notebook to 404", async () => {
    vi.mocked(requireMemberSession).mockResolvedValueOnce({
      ok: false,
      response: new Response("no", { status: 403 }),
    } as never);
    const request = new Request("http://os.test/api/notebooks/nb1");
    expect(((await loader({ request, params: { id: "nb1" } } as never)) as Response).status).toBe(403);

    vi.mocked(lib.getNotebook).mockRejectedValue(new NotebookError("Notebook not found", 404));
    expect(((await loader({ request, params: { id: "nb1" } } as never)) as Response).status).toBe(404);
  });
});

describe("POST /api/notebooks/:id", () => {
  it("set-template", async () => {
    expect((await post({ intent: "set-template", templatePageId: "t1" })).status).toBe(200);
    expect(lib.setNotebookTemplate).toHaveBeenCalledWith("nb1", "t1", "u1");
  });

  it("set-template clears with null", async () => {
    await post({ intent: "set-template", templatePageId: null });
    expect(lib.setNotebookTemplate).toHaveBeenCalledWith("nb1", null, "u1");
  });

  it("add-page", async () => {
    expect((await post({ intent: "add-page", pageId: "d1" })).status).toBe(200);
    expect(lib.addToNotebook).toHaveBeenCalledWith("d1", "nb1", "u1");
  });

  it("merge-into reports how many tabs moved", async () => {
    vi.mocked(lib.mergeNotebooks).mockResolvedValue({ moved: 3 });
    const res = await post({ intent: "merge-into", targetId: "nb2" });
    expect(await res.json()).toEqual({ ok: true, moved: 3 });
    expect(lib.mergeNotebooks).toHaveBeenCalledWith("nb1", "nb2", "u1");
  });

  it("dissolve", async () => {
    vi.mocked(lib.dissolveNotebook).mockResolvedValue({ moved: 2 });
    expect(await (await post({ intent: "dissolve" })).json()).toEqual({ ok: true, moved: 2 });
    expect(lib.dissolveNotebook).toHaveBeenCalledWith("nb1", "u1");
  });

  it("trash", async () => {
    expect((await post({ intent: "trash" })).status).toBe(200);
    expect(lib.trashNotebook).toHaveBeenCalledWith("nb1", "u1");
  });

  it("returns the session gate's response when not a member", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({
      ok: false,
      response: new Response("no", { status: 403 }),
    } as never);
    expect((await post({ intent: "trash" })).status).toBe(403);
    expect(lib.trashNotebook).not.toHaveBeenCalled();
  });

  it("400s an unknown intent or a missing field", async () => {
    expect((await post({ intent: "explode" })).status).toBe(400);
    expect((await post({ intent: "add-page" })).status).toBe(400);
    expect((await post({ intent: "merge-into" })).status).toBe(400);
  });

  it("405s anything but POST", async () => {
    expect((await post(null, "PUT")).status).toBe(405);
  });

  it.each([
    ["set-template", { intent: "set-template", templatePageId: "t1" }, "setNotebookTemplate"],
    ["add-page", { intent: "add-page", pageId: "d1" }, "addToNotebook"],
    ["merge-into", { intent: "merge-into", targetId: "nb2" }, "mergeNotebooks"],
    ["dissolve", { intent: "dissolve" }, "dissolveNotebook"],
    ["trash", { intent: "trash" }, "trashNotebook"],
  ] as const)("maps a %s refusal to its status", async (_name, body, fn) => {
    (lib[fn] as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new NotebookError("You can't edit this notebook", 403));
    const res = await post(body);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You can't edit this notebook" });
  });
});
