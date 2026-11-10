import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { page: { findUnique: vi.fn() } } }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  isPartnerAccount: vi.fn(),
  isNonMember: vi.fn(),
}));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/lib/drive-download.server", () => ({ MAX_ZIP_BYTES: 50, MAX_ZIP_FILES: 100 }));
vi.mock("~/lib/markdown-import.server", async () => {
  class ImportError extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  }
  return { ImportError, importMarkdownFile: vi.fn(), importLimitFor: (name: string) => (name.endsWith(".zip") ? 50 : 10) };
});

import { prisma } from "~/lib/db.server";
import { isNonMember, isPartnerAccount, requireAuth } from "~/lib/auth";
import { getPageAccess } from "~/lib/pageAccess.server";
import { logAuditEvent } from "~/lib/audit";
import { ImportError, importMarkdownFile } from "~/lib/markdown-import.server";
import { action } from "~/routes/documents.$pageId.import";

function post(file: File | null = new File(["# Hi"], "a.md"), headers: Record<string, string> = {}, method = "POST") {
  const body = new FormData();
  if (file) body.set("file", file);
  return action({
    request: new Request("https://dali.example/documents/p1/import", { method, body: method === "GET" ? undefined : body, headers }),
    params: { pageId: "p1" },
    context: {},
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(isPartnerAccount).mockResolvedValue(false as never);
  vi.mocked(prisma.page.findUnique).mockResolvedValue({ id: "p1" } as never);
  vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: true } as never);
  vi.mocked(importMarkdownFile).mockResolvedValue({ blocks: [{ type: "paragraph" }], skipped: 2 } as never);
});

describe("document import access", () => {
  it("answers 401 when logged out", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    expect((await post()).status).toBe(401);
    expect(importMarkdownFile).not.toHaveBeenCalled();
  });

  it("answers 403 for a non-member and for a partner", async () => {
    vi.mocked(isNonMember).mockResolvedValue(true);
    expect((await post()).status).toBe(403);
    vi.mocked(isNonMember).mockResolvedValue(false);
    vi.mocked(isPartnerAccount).mockResolvedValue(true as never);
    expect((await post()).status).toBe(403);
    expect(importMarkdownFile).not.toHaveBeenCalled();
  });

  it("answers 404 for a viewer who cannot edit and for a missing page", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: false } as never);
    expect((await post()).status).toBe(404);
    vi.mocked(prisma.page.findUnique).mockResolvedValue(null);
    expect((await post()).status).toBe(404);
    expect(importMarkdownFile).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("only accepts POST", async () => {
    expect((await post(null, {}, "GET")).status).toBe(405);
  });
});

describe("document import", () => {
  it("returns the blocks and how many images were skipped, and logs the import", async () => {
    const res = await post(new File(["# Hi"], "a.md"));
    expect(await res.json()).toEqual({ blocks: [{ type: "paragraph" }], skipped: 2 });
    expect(importMarkdownFile).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "a.md", pageId: "p1", ownOrigin: "https://dali.example" }),
    );
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "document.import", userId: "u1", targetId: "p1", metadata: { skipped: 2 } }),
    );
  });

  it("answers 400 when no file is sent", async () => {
    expect((await post(null)).status).toBe(400);
  });

  it("answers 413 for a markdown file over its limit and lets a zip use the larger one", async () => {
    const big = "x".repeat(20);
    expect((await post(new File([big], "a.md"))).status).toBe(413);
    expect((await post(new File([big], "a.zip"))).status).toBe(200);
    expect(importMarkdownFile).toHaveBeenCalledTimes(1);
  });

  it("answers 413 from the declared body size before reading it", async () => {
    const res = await post(new File(["x"], "a.md"), { "content-length": String(50 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(importMarkdownFile).not.toHaveBeenCalled();
  });

  it("passes on a rejected upload's status and message", async () => {
    vi.mocked(importMarkdownFile).mockRejectedValue(new ImportError("This .zip has no Markdown file.", 400));
    const res = await post(new File(["x"], "a.zip"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This .zip has no Markdown file." });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
