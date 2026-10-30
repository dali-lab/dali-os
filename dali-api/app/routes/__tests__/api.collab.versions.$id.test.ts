import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { collabDocumentVersion: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => Response.json({ error: "Forbidden" }, { status: 403 })),
}));
vi.mock("~/lib/collabAuth", () => ({ authorizeCollabDoc: vi.fn(), hydrateAuthors: vi.fn() }));
vi.mock("~/collab/server", () => ({ getCollabServer: vi.fn() }));
vi.mock("~/collab/persistence", () => ({ restoreVersion: vi.fn() }));
vi.mock("~/collab/read", () => ({ stateToBlocks: vi.fn() }));
vi.mock("~/collab/blocknote-server", () => ({ blocksToHtml: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { authorizeCollabDoc } from "~/lib/collabAuth";
import { getCollabServer } from "~/collab/server";
import { restoreVersion } from "~/collab/persistence";
import { logAuditEvent } from "~/lib/audit";
import { action } from "~/routes/api.collab.versions.$id";

const findVersion = vi.mocked(prisma.collabDocumentVersion.findUnique);

const run = (body: unknown) =>
  action({
    request: new Request("http://localhost/api/collab/versions/v1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: "v1" },
    context: {},
  } as never) as Promise<Response>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: false });
  vi.mocked(getCollabServer).mockReturnValue({} as never);
  findVersion.mockResolvedValue({ id: "v1", name: "doc:p1:body" } as never);
});

describe("POST /api/collab/versions/:id restore", () => {
  it("logs the restore against the version id with the document name", async () => {
    const res = await run({ intent: "restore" });

    expect(res.status).toBe(200);
    expect(restoreVersion).toHaveBeenCalledWith({}, "doc:p1:body", "v1");
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "collab.version.restore",
        userId: "u1",
        targetId: "v1",
        metadata: { documentName: "doc:p1:body" },
      }),
    );
  });

  it("logs nothing when the collab server is down", async () => {
    vi.mocked(getCollabServer).mockReturnValue(null as never);
    expect((await run({ intent: "restore" })).status).toBe(503);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("logs nothing when the caller cannot access the document", async () => {
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: false, readOnly: false });
    expect((await run({ intent: "restore" })).status).toBe(403);
    expect(restoreVersion).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("does not log a rename", async () => {
    findVersion.mockResolvedValue({ id: "v1", name: "doc:p1:body" } as never);
    expect((await run({ intent: "name", label: "Final" })).status).toBe(200);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
