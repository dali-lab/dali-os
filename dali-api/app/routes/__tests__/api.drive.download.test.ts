import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireMemberSession: vi.fn() }));
vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/fileAccess.server", () => ({ filterViewableFiles: vi.fn() }));
vi.mock("~/lib/s3.server", () => ({ isS3Configured: vi.fn() }));
vi.mock("~/drive/lib/drive-download.server", () => ({
  MAX_ZIP_FILES: 100,
  MAX_ZIP_BYTES: 500 * 1024 * 1024,
  buildDriveZip: vi.fn(),
}));

import { requireMemberSession } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { prisma } from "~/lib/db.server";
import { filterViewableFiles } from "~/lib/fileAccess.server";
import { buildDriveZip } from "~/drive/lib/drive-download.server";
import { _resetForTests } from "~/lib/rate-limit";
import { isS3Configured } from "~/lib/s3.server";
import { action } from "~/routes/api.drive.download";

const findMany = (prisma as unknown as { projectFile: { findMany: ReturnType<typeof vi.fn> } }).projectFile.findMany;

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `File ${id}`,
  projectId: null,
  workspaceType: "Lab",
  workspaceId: null,
  folderPageId: null,
  currentVersion: { id: `v-${id}`, fileName: `${id}.pdf`, s3Key: `uploads/${id}`, sizeBytes: 10, createdAt: new Date() },
  ...extra,
});

function post(fileIds: unknown, method = "POST") {
  return action({
    request: new Request("http://localhost/api/drive/download", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileIds }),
    }),
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTests();
  vi.mocked(requireMemberSession).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as never);
  vi.mocked(isS3Configured).mockReturnValue(true);
  vi.mocked(filterViewableFiles).mockImplementation(async (_u, files) => files);
  vi.mocked(buildDriveZip).mockImplementation(async (sources) => ({
    url: "https://signed.example/zip",
    included: sources.length,
  }));
  findMany.mockResolvedValue([row("a"), row("b")]);
});

describe("POST /api/drive/download", () => {
  it("rejects other methods", async () => {
    expect((await post(["a"], "PUT")).status).toBe(405);
  });

  it("passes through the member gate's refusal without reading files", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Not a DALI member" }, { status: 403 }),
    });
    expect((await post(["a"])).status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("rejects an empty list", async () => {
    expect((await post([])).status).toBe(400);
  });

  it("refuses more than the file cap before reading any files", async () => {
    const res = await post(Array.from({ length: 101 }, (_, i) => `f${i}`));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toContain("100");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("counts a repeated id once toward the cap", async () => {
    const res = await post(Array.from({ length: 150 }, () => "a"));
    expect(res.status).toBe(200);
  });

  it("503s when storage isn't configured", async () => {
    vi.mocked(isS3Configured).mockReturnValue(false);
    expect((await post(["a"])).status).toBe(503);
  });

  it("only asks for live files", async () => {
    await post(["a", "b"]);
    expect(findMany.mock.calls[0][0].where).toEqual({ id: { in: ["a", "b"] }, archivedAt: null });
  });

  it("zips the files by their download names and returns the link", async () => {
    const res = await post(["a", "b"]);
    expect(await res.json()).toEqual({ url: "https://signed.example/zip", included: 2, skipped: 0 });
    expect(vi.mocked(buildDriveZip).mock.calls[0][0].map((s) => [s.name, "s3Key" in s && s.s3Key])).toEqual([
      ["File a.pdf", "uploads/a"],
      ["File b.pdf", "uploads/b"],
    ]);
  });

  it("never includes a file the viewer can't see, and counts it as skipped", async () => {
    findMany.mockResolvedValue([row("a"), row("secret", { workspaceType: "Member", workspaceId: "other" })]);
    vi.mocked(filterViewableFiles).mockImplementation(async (_u, files) =>
      files.filter((f) => f.workspaceType !== "Member"),
    );

    const res = await post(["a", "secret"]);

    expect(await res.json()).toMatchObject({ included: 1, skipped: 1 });
    expect(vi.mocked(buildDriveZip).mock.calls[0][0].map((s) => "s3Key" in s && s.s3Key)).toEqual(["uploads/a"]);
  });

  it("counts archived and unknown ids as skipped", async () => {
    findMany.mockResolvedValue([row("a")]);
    expect(await (await post(["a", "archived", "unknown"])).json()).toMatchObject({ skipped: 2 });
  });

  it("skips a file with no current version", async () => {
    findMany.mockResolvedValue([row("a"), row("b", { currentVersion: null })]);
    expect(await (await post(["a", "b"])).json()).toMatchObject({ included: 1, skipped: 1 });
  });

  it("404s when none of the files can be viewed", async () => {
    vi.mocked(filterViewableFiles).mockResolvedValue([]);
    expect((await post(["a"])).status).toBe(404);
    expect(buildDriveZip).not.toHaveBeenCalled();
  });

  it("selects the link fields the access check needs", async () => {
    await post(["a"]);
    expect(findMany.mock.calls[0][0].select).toMatchObject({ linkAccess: true, linkPermission: true });
  });

  it("refuses a selection over the size cap before building anything", async () => {
    const huge = row("a");
    huge.currentVersion.sizeBytes = 500 * 1024 * 1024 + 1;
    findMany.mockResolvedValue([huge]);
    expect((await post(["a"])).status).toBe(413);
    expect(buildDriveZip).not.toHaveBeenCalled();
  });

  it("404s when every stored object is gone", async () => {
    vi.mocked(buildDriveZip).mockResolvedValue(null);
    expect((await post(["a"])).status).toBe(404);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("reports objects missing from storage as skipped", async () => {
    vi.mocked(buildDriveZip).mockResolvedValue({ url: "u", included: 1 });
    expect(await (await post(["a", "b"])).json()).toMatchObject({ included: 1, skipped: 1 });
  });

  it("audits who took which files", async () => {
    await post(["a", "b"]);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "projectFile.bulk-download",
        userId: "u1",
        metadata: { fileIds: ["a", "b"], bytes: 20 },
      }),
    );
  });

  it("rate limits per person", async () => {
    for (let i = 0; i < 10; i++) expect((await post(["a"])).status).toBe(200);
    expect((await post(["a"])).status).toBe(429);
  });
});
