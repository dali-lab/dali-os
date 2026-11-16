import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: { signingDocument: { create: vi.fn(), findUnique: vi.fn() } },
  requireAuth: vi.fn(),
  isCore: vi.fn(),
  editableFolderInRoot: vi.fn(),
  resolveFilingFolder: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({ prisma: h.prisma }));
vi.mock("~/lib/auth", () => ({ requireAuth: h.requireAuth }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: () => new Response(null, { status: 302 }) }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn(), isCore: h.isCore }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/core/coreNav", () => ({ coreHandle: () => ({}) }));
vi.mock("~/drive/lib/drive-receivers.server", () => ({
  resolveFilingFolder: h.resolveFilingFolder,
  singletonSlot: (processType: string, folderType: string) => ({ processType, folderType }),
}));
vi.mock("~/drive/lib/drive-roots.server", () => ({ editableFolderInRoot: h.editableFolderInRoot }));
vi.mock("~/signing/lib/console.server", () => ({ getAgreementsOverview: vi.fn() }));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn() }));
vi.mock("~/signing/lib/activate.server", () => ({ activateVersion: vi.fn() }));
vi.mock("~/signing/lib/notify.server", () => ({ notifySignRequest: vi.fn() }));
vi.mock("~/signing/components/SigningDocumentsPage", () => ({ SigningDocumentsPage: () => null }));
vi.mock("~/signing/components/AgreementsConsole", () => ({ AgreementsConsole: () => null }));

import { action } from "~/signing/routes/core.agreements";

async function create(fields: Record<string, string> = {}) {
  const body = new URLSearchParams({ intent: "create", name: "NDA", ...fields });
  const request = new Request("http://x/core/agreements", { method: "POST", body });
  try {
    return await action({ request, params: {} } as never);
  } catch (thrown) {
    return thrown;
  }
}

const createdFolder = () => h.prisma.signingDocument.create.mock.calls[0][0].data.folderPageId;

beforeEach(() => {
  vi.clearAllMocks();
  h.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
  h.isCore.mockResolvedValue(true);
  h.prisma.signingDocument.findUnique.mockResolvedValue(null);
  h.prisma.signingDocument.create.mockResolvedValue({ id: "a1" });
  h.editableFolderInRoot.mockResolvedValue(null);
  h.resolveFilingFolder.mockResolvedValue({ folderId: "agreements-folder", viaReceiver: true });
});

describe("core.agreements create", () => {
  it("files into the requested Core folder when it's usable", async () => {
    h.editableFolderInRoot.mockResolvedValue("legal");
    const res = (await create({ folderPageId: "legal" })) as Response;
    expect(h.editableFolderInRoot).toHaveBeenCalledWith("u1", "legal", "core", expect.any(Request));
    expect(createdFolder()).toBe("legal");
    expect(h.resolveFilingFolder).not.toHaveBeenCalled();
    expect(res.headers.get("Location")).toBe("/documents/agreement/a1");
  });

  it("falls back to the Core Agreements folder without a usable folder", async () => {
    await create({ folderPageId: "elsewhere" });
    expect(h.resolveFilingFolder).toHaveBeenCalledWith({ processType: "Core", folderType: "Agreements" }, "u1");
    expect(createdFolder()).toBe("agreements-folder");
  });

  it("still creates the agreement when filing fails", async () => {
    h.resolveFilingFolder.mockRejectedValue(new Error("no root"));
    await create();
    expect(h.editableFolderInRoot).toHaveBeenCalledWith("u1", null, "core", expect.any(Request));
    expect(createdFolder()).toBeNull();
  });
});
