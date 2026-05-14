import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/s3", () => ({
  getUploadPost: vi.fn(),
  getDownloadUrl: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { getUploadPost } from "~/lib/s3";
import { _resetForTests } from "~/lib/rate-limit";
import { MAX_UPLOAD_BYTES } from "~/lib/file-validation";
import { action } from "~/routes/api.upload.presign";

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";

function makeRequest(body: unknown = { key: "foo.png", contentType: "image/png" }) {
  return new Request("http://localhost/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PRESIGNED_POST = {
  url: "https://s3.example/bucket",
  fields: {
    "Content-Type": "image/png",
    bucket: "bucket",
    key: "uploads/foo.png",
    Policy: "base64-policy",
    "X-Amz-Signature": "sig",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTests();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "user" },
  } as any);
  vi.mocked(getUploadPost).mockResolvedValue(PRESIGNED_POST as any);
});

describe("POST /api/upload/presign response shape", () => {
  it("returns url, fields, and a scoped key on success", async () => {
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      url: PRESIGNED_POST.url,
      fields: PRESIGNED_POST.fields,
      key: "uploads/foo.png",
    });
    expect(body.key.startsWith("uploads/")).toBe(true);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as any);
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(401);
    expect(getUploadPost).not.toHaveBeenCalled();
  });

  it("returns 400 when key is missing", async () => {
    const res = await action({
      request: makeRequest({ contentType: "image/png" }),
    } as any);
    expect(res.status).toBe(400);
    expect(getUploadPost).not.toHaveBeenCalled();
  });

  it("returns 400 when contentType is on the global denylist", async () => {
    const res = await action({
      request: makeRequest({ key: "foo.bin", contentType: "application/x-msdownload" }),
    } as any);
    expect(res.status).toBe(400);
    expect(getUploadPost).not.toHaveBeenCalled();
  });

  it("returns 400 when key extension is on the global denylist", async () => {
    const res = await action({
      request: makeRequest({ key: "foo.exe", contentType: "application/octet-stream" }),
    } as any);
    expect(res.status).toBe(400);
    expect(getUploadPost).not.toHaveBeenCalled();
  });

  it("denylist fires even when accept would permit it", async () => {
    const res = await action({
      request: makeRequest({
        key: "applications/q/abc-foo.exe",
        contentType: "application/octet-stream",
        accept: ".exe",
      }),
    } as any);
    expect(res.status).toBe(400);
    expect(getUploadPost).not.toHaveBeenCalled();
  });

  it("returns 400 when contentType is missing", async () => {
    const res = await action({
      request: makeRequest({ key: "foo.png" }),
    } as any);
    expect(res.status).toBe(400);
    expect(getUploadPost).not.toHaveBeenCalled();
  });

  it("accepts .f3z by extension when accept lists it", async () => {
    const res = await action({
      request: makeRequest({
        key: "applications/q/abc-design.f3z",
        contentType: "application/octet-stream",
        accept: ".f3z, .f3d",
      }),
    } as any);
    expect(res.status).toBe(200);
    expect(getUploadPost).toHaveBeenCalled();
  });

  it("accepts a PDF when accept is application/pdf", async () => {
    const res = await action({
      request: makeRequest({
        key: "applications/q/abc-resume.pdf",
        contentType: "application/pdf",
        accept: "application/pdf",
      }),
    } as any);
    expect(res.status).toBe(200);
  });

  it("accepts a PNG when accept is image/*", async () => {
    const res = await action({
      request: makeRequest({
        key: "applications/q/abc-pic.png",
        contentType: "image/png",
        accept: "image/*",
      }),
    } as any);
    expect(res.status).toBe(200);
  });

  it("rejects a PNG when accept only allows .pdf", async () => {
    const res = await action({
      request: makeRequest({
        key: "applications/q/abc-pic.png",
        contentType: "image/png",
        accept: ".pdf",
      }),
    } as any);
    expect(res.status).toBe(400);
    expect(getUploadPost).not.toHaveBeenCalled();
  });

  it("falls through when no accept is provided, blocking only denylisted types", async () => {
    const res = await action({
      request: makeRequest({
        key: "applications/q/abc-data.f3d",
        contentType: "application/zip",
      }),
    } as any);
    expect(res.status).toBe(200);
  });

  it("returns 400 when accept is not a string", async () => {
    const res = await action({
      request: makeRequest({
        key: "foo.png",
        contentType: "image/png",
        accept: 123,
      }),
    } as any);
    expect(res.status).toBe(400);
    expect(getUploadPost).not.toHaveBeenCalled();
  });

  it("returns 413 when contentLength exceeds the cap", async () => {
    const res = await action({
      request: makeRequest({
        key: "foo.png",
        contentType: "image/png",
        contentLength: MAX_UPLOAD_BYTES + 1,
      }),
    } as any);
    expect(res.status).toBe(413);
    expect(getUploadPost).not.toHaveBeenCalled();
  });

  it("returns 400 when contentLength is malformed", async () => {
    const res = await action({
      request: makeRequest({
        key: "foo.png",
        contentType: "image/png",
        contentLength: "huge",
      }),
    } as any);
    expect(res.status).toBe(400);
    expect(getUploadPost).not.toHaveBeenCalled();
  });
});

describe("POST /api/upload/presign rate limiting", () => {
  it("allows requests under the limit", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await action({ request: makeRequest() } as any);
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 with Retry-After once the limit is exceeded", async () => {
    for (let i = 0; i < 20; i++) {
      await action({ request: makeRequest() } as any);
    }
    const res = await action({ request: makeRequest() } as any);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("scopes the rate limit per user", async () => {
    for (let i = 0; i < 20; i++) {
      await action({ request: makeRequest() } as any);
    }
    // First user is now rate-limited.
    const limited = await action({ request: makeRequest() } as any);
    expect(limited.status).toBe(429);

    // A different user should still be allowed through.
    vi.mocked(requireAuth).mockResolvedValueOnce({
      ok: true,
      user: { sub: OTHER_USER_ID, email: "o@x.com", type: "user" },
    } as any);
    const ok = await action({ request: makeRequest() } as any);
    expect(ok.status).toBe(200);
  });

  it("returns 401 without consuming rate-limit budget when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as any);
    for (let i = 0; i < 25; i++) {
      const res = await action({ request: makeRequest() } as any);
      expect(res.status).toBe(401);
    }
  });
});
