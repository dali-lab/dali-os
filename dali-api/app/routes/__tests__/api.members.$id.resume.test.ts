import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn().mockResolvedValue({}), isAdmin: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/s3", () => ({
  isS3Configured: vi.fn(),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  getDownloadUrl: vi.fn(),
}));
vi.mock("~/lib/ai-usage.server", () => ({ recordTokenUsage: vi.fn() }));
vi.mock("~/lib/ai.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/ai.server")>()),
  isAiEnabled: vi.fn(),
  resolveAiProvider: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { isAdmin } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { deleteObject, getDownloadUrl, isS3Configured, putObject } from "~/lib/s3";
import { recordTokenUsage } from "~/lib/ai-usage.server";
import { isAiEnabled, resolveAiProvider } from "~/lib/ai.server";
import { _resetForTests as resetRateLimits } from "~/lib/rate-limit";
import { AI_DAILY_MAX } from "~/routes/api.ai.meeting-notes";
import { action, loader } from "~/routes/api.members.$id.resume";

const ME = "u-me";
const OTHER = "u-other";
const SIGNED = "https://signed.example/resume.pdf";
const create = vi.fn();

const pdf = (extra = "") => new File([`%PDF-1.7 ${extra}`], "resume.pdf", { type: "application/pdf" });

function post(id: string, file: File | null, fields: Record<string, string> = {}, headers: HeadersInit = {}) {
  const body = new FormData();
  if (file) body.set("file", file);
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({
    request: new Request(`http://localhost/api/members/${id}/resume`, { method: "POST", body, headers }),
    params: { id },
    context: {},
  } as never) as Promise<Response>;
}

const del = (id: string) =>
  action({
    request: new Request(`http://localhost/api/members/${id}/resume`, { method: "DELETE" }),
    params: { id },
    context: {},
  } as never) as Promise<Response>;

const get = (id: string) =>
  loader({
    request: new Request(`http://localhost/api/members/${id}/resume`),
    params: { id },
    context: {},
  } as never) as Promise<Response>;

function signInAs(sub: string, admin = false) {
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub } } as never);
  vi.mocked(isAdmin).mockResolvedValue(admin);
}

const MODEL_JSON = JSON.stringify({
  jobs: [{ company: "Acme", position: "Engineer", start: { year: 2020, month: 4 }, end: null, current: true }],
});

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  signInAs(ME);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(isS3Configured).mockReturnValue(true);
  vi.mocked(getDownloadUrl).mockResolvedValue(SIGNED);
  vi.mocked(putObject).mockResolvedValue(undefined as never);
  vi.mocked(deleteObject).mockResolvedValue(undefined);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ resumeKey: null, resumeFileName: null } as never);
  vi.mocked(prisma.user.update).mockResolvedValue({} as never);
  vi.mocked(isAiEnabled).mockReturnValue(true);
  vi.mocked(resolveAiProvider).mockReturnValue({
    client: { messages: { create } },
    sonnetModel: "sonnet-test",
  } as never);
  create.mockResolvedValue({
    content: [{ type: "text", text: MODEL_JSON }],
    usage: { input_tokens: 10, output_tokens: 5 },
  });
  vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({ count: 1 } as never);
});

describe("GET /api/members/:id/resume", () => {
  beforeEach(() => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      resumeKey: `uploads/resumes/${ME}/a.pdf`,
      resumeFileName: "cv.pdf",
    } as never);
  });

  it("redirects the owner to a short-lived inline signed URL", async () => {
    const res = await get(ME);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(SIGNED);
    expect(getDownloadUrl).toHaveBeenCalledWith(`uploads/resumes/${ME}/a.pdf`, {
      inline: true,
      contentType: "application/pdf",
      fileName: "cv.pdf",
      expiresIn: 300,
    });
  });

  it("lets an admin view another member's resume", async () => {
    signInAs("admin-1", true);
    expect((await get(ME)).status).toBe(302);
  });

  it("returns 404 to another member", async () => {
    signInAs(OTHER);
    expect((await get(ME)).status).toBe(404);
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it("returns 404 when there is no resume", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ resumeKey: null, resumeFileName: null } as never);
    expect((await get(ME)).status).toBe(404);
  });

  it("returns 404 with the flag off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    expect((await get(ME)).status).toBe(404);
  });
});

describe("POST validation", () => {
  it("returns 503 when storage is not configured", async () => {
    vi.mocked(isS3Configured).mockReturnValue(false);
    expect((await post(ME, pdf())).status).toBe(503);
    expect(putObject).not.toHaveBeenCalled();
  });

  it("returns 413 from the content-length precheck", async () => {
    const res = await post(ME, pdf(), {}, { "content-length": String(6 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(putObject).not.toHaveBeenCalled();
  });

  it("returns 413 when the file itself is over 5 MB", async () => {
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.pdf");
    expect((await post(ME, big)).status).toBe(413);
    expect(putObject).not.toHaveBeenCalled();
  });

  it("returns 400 when there is no file or an empty one", async () => {
    expect((await post(ME, null)).status).toBe(400);
    expect((await post(ME, new File([], "empty.pdf"))).status).toBe(400);
    expect(putObject).not.toHaveBeenCalled();
  });

  it("returns 400 for a file without the PDF magic bytes", async () => {
    const res = await post(ME, new File(["PK\u0003\u0004 not a pdf"], "resume.pdf", { type: "application/pdf" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Upload a PDF." });
    expect(putObject).not.toHaveBeenCalled();
  });
});

describe("POST storage", () => {
  it("stores under the member's prefix, updates the fields and deletes the old object", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ resumeKey: `uploads/resumes/${ME}/old.pdf` } as never);
    const res = await post(ME, pdf());
    expect(res.status).toBe(200);

    const [key, bytes, contentType] = vi.mocked(putObject).mock.calls[0];
    expect(key).toMatch(new RegExp(`^uploads/resumes/${ME}/[0-9a-f-]{36}\\.pdf$`));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(contentType).toBe("application/pdf");

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: ME },
      data: expect.objectContaining({ resumeKey: key, resumeFileName: "resume.pdf", resumeSizeBytes: bytes.byteLength }),
    });
    expect(deleteObject).toHaveBeenCalledWith(`uploads/resumes/${ME}/old.pdf`);

    const body = await res.json();
    expect(body.resume.fileName).toBe("resume.pdf");
    expect(JSON.stringify(body)).not.toContain("uploads/resumes");
  });

  it("deletes nothing when there was no previous resume", async () => {
    await post(ME, pdf());
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("keeps the new resume when deleting the old object fails", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ resumeKey: "uploads/resumes/x/old.pdf" } as never);
    vi.mocked(deleteObject).mockRejectedValue(new Error("s3 down"));
    expect((await post(ME, pdf())).status).toBe(200);
  });
});

describe("POST with extract=1", () => {
  it("returns jobs and records token usage", async () => {
    const res = await post(ME, pdf(), { extract: "1" });
    const body = await res.json();
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]).toMatchObject({ company: "Acme", position: "Engineer", startMonth: "2020-04" });
    expect(body.extractError).toBeUndefined();
    expect(recordTokenUsage).toHaveBeenCalledWith(ME, expect.any(String), 10, 5);
  });

  it("still stores the resume and reports quota when the daily limit is spent", async () => {
    vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({ count: AI_DAILY_MAX + 1 } as never);
    const res = await post(ME, pdf(), { extract: "1" });
    const body = await res.json();
    expect(body.extractError).toBe("quota");
    expect(body.jobs).toBeUndefined();
    expect(putObject).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("reports rate once the burst limit is spent", async () => {
    for (let i = 0; i < 5; i++) await post(ME, pdf(), { extract: "1" });
    const body = await (await post(ME, pdf(), { extract: "1" })).json();
    expect(body.extractError).toBe("rate");
  });

  it("reports ai_unavailable without a provider", async () => {
    vi.mocked(isAiEnabled).mockReturnValue(false);
    const body = await (await post(ME, pdf(), { extract: "1" })).json();
    expect(body.extractError).toBe("ai_unavailable");
    expect(prisma.aiUsage.upsert).not.toHaveBeenCalled();
    expect(putObject).toHaveBeenCalled();
  });

  it("reports failed when the model throws", async () => {
    create.mockRejectedValue(new Error("boom"));
    const body = await (await post(ME, pdf(), { extract: "1" })).json();
    expect(body.extractError).toBe("failed");
    expect(body.resume.fileName).toBe("resume.pdf");
  });

  it("reports failed when the model returns unparseable text", async () => {
    create.mockResolvedValue({ content: [{ type: "text", text: "nope" }], usage: {} });
    expect((await (await post(ME, pdf(), { extract: "1" })).json()).extractError).toBe("failed");
  });

  it("never calls the model without extract", async () => {
    const body = await (await post(ME, pdf())).json();
    expect(create).not.toHaveBeenCalled();
    expect(prisma.aiUsage.upsert).not.toHaveBeenCalled();
    expect(body.jobs).toBeUndefined();
  });
});

describe("DELETE", () => {
  it("clears the fields and deletes the object", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ resumeKey: `uploads/resumes/${ME}/a.pdf` } as never);
    const res = await del(ME);
    expect(await res.json()).toEqual({ ok: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: ME },
      data: { resumeKey: null, resumeFileName: null, resumeSizeBytes: null, resumeUploadedAt: null },
    });
    expect(deleteObject).toHaveBeenCalledWith(`uploads/resumes/${ME}/a.pdf`);
  });

  it("returns 404 to another member and touches nothing", async () => {
    signInAs(OTHER);
    expect((await del(ME)).status).toBe(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });
});

describe("access rules", () => {
  beforeEach(() => signInAs("admin-1", true));

  it("gives an admin 404 on POST for another member's resume", async () => {
    expect((await post(ME, pdf())).status).toBe(404);
    expect(putObject).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("gives an admin 404 on DELETE for another member's resume", async () => {
    expect((await del(ME)).status).toBe(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("returns 404 on POST and DELETE with the flag off", async () => {
    signInAs(ME);
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    expect((await post(ME, pdf())).status).toBe(404);
    expect((await del(ME)).status).toBe(404);
    expect(putObject).not.toHaveBeenCalled();
  });

  it("rejects other methods", async () => {
    signInAs(ME);
    const res = (await action({
      request: new Request("http://localhost/x", { method: "PUT" }),
      params: { id: ME },
      context: {},
    } as never)) as Response;
    expect(res.status).toBe(405);
  });
});

describe("resume audit trail", () => {
  const logged = () => vi.mocked(logAuditEvent).mock.calls.map(([e]) => [e.action, e.userId, e.targetId, e.metadata]);

  beforeEach(() => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      resumeKey: `uploads/resumes/${ME}/a.pdf`,
      resumeFileName: "cv.pdf",
    } as never);
  });

  it("logs an admin viewing someone else's resume, against the owner", async () => {
    signInAs("admin-1", true);
    await get(ME);
    expect(logged()).toEqual([["member.resume.view", "admin-1", ME, { fileName: "cv.pdf" }]]);
  });

  it("does not log a member opening their own resume", async () => {
    await get(ME);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("logs nothing when the viewer is refused or there is no resume", async () => {
    signInAs(OTHER);
    await get(ME);
    signInAs("admin-1", true);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ resumeKey: null, resumeFileName: null } as never);
    await get(ME);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("logs an upload with the file name and size, flagging a replacement", async () => {
    const file = pdf();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ resumeKey: null } as never);
    await post(ME, file);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ resumeKey: "old.pdf" } as never);
    await post(ME, file);

    expect(logged()).toEqual([
      ["member.resume.upload", ME, ME, { fileName: "resume.pdf", sizeBytes: file.size, replaced: false }],
      ["member.resume.upload", ME, ME, { fileName: "resume.pdf", sizeBytes: file.size, replaced: true }],
    ]);
  });

  it("logs a delete, and nothing for a rejected upload", async () => {
    await post(ME, new File(["not a pdf"], "x.pdf"));
    await del(ME);
    expect(logged()).toEqual([["member.resume.delete", ME, ME, undefined]]);
  });
});
