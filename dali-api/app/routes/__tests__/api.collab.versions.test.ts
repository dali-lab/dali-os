// POST /api/collab/versions — forces an immediate, labeled snapshot (used by
// Enhance's "Before enhance" save, specs/meeting-notes-model.md §2).

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), forbidden: vi.fn(() => Response.json({ error: "Forbidden" }, { status: 403 })) }));
vi.mock("~/lib/collabAuth", () => ({ authorizeCollabDoc: vi.fn(), hydrateAuthors: vi.fn() }));
vi.mock("~/collab/server", () => ({ getCollabServer: vi.fn() }));
vi.mock("~/collab/persistence", () => ({ forceSnapshot: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { authorizeCollabDoc } from "~/lib/collabAuth";
import { getCollabServer } from "~/collab/server";
import { forceSnapshot } from "~/collab/persistence";
import { action } from "~/routes/api.collab.versions";

function post(body: unknown): Request {
  return new Request("http://localhost/api/collab/versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const run = (body: unknown) => action({ request: post(body), params: {}, context: {} } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "u1", email: "u@dali.edu", type: "member" },
    sessionId: "s1",
  } as never);
  vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: false });
  vi.mocked(getCollabServer).mockReturnValue({} as never);
  vi.mocked(forceSnapshot).mockResolvedValue(undefined);
});

const BODY = { name: "doc:p1:body", label: "Before enhance" };

describe("POST /api/collab/versions", () => {
  it("forces a labeled snapshot for an editor of the doc", async () => {
    const res = await run(BODY);
    expect(res.status).toBe(200);
    expect(forceSnapshot).toHaveBeenCalledWith({}, "doc:p1:body", "Before enhance", ["u1"]);
  });

  it("rejects a read-only viewer", async () => {
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: true });
    const res = await run(BODY);
    expect(res.status).toBe(403);
    expect(forceSnapshot).not.toHaveBeenCalled();
  });

  it("rejects someone with no access to the doc", async () => {
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: false, readOnly: false });
    const res = await run(BODY);
    expect(res.status).toBe(403);
    expect(forceSnapshot).not.toHaveBeenCalled();
  });

  it("503s when the collab server isn't running", async () => {
    vi.mocked(getCollabServer).mockReturnValue(null as never);
    const res = await run(BODY);
    expect(res.status).toBe(503);
  });

  it("rejects an empty label", async () => {
    const res = await run({ name: "doc:p1:body", label: "" });
    expect(res.status).toBe(400);
    expect(forceSnapshot).not.toHaveBeenCalled();
  });
});
