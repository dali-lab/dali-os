import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/s3.server", () => ({ getDownloadUrl: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { getDownloadUrl } from "~/lib/s3.server";
import { loader } from "~/routes/api.upload.raw";

function call(key: string) {
  return loader({ request: new Request(`http://localhost/api/upload/raw?key=${encodeURIComponent(key)}`) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as any);
  vi.mocked(getDownloadUrl).mockResolvedValue("https://signed.example/x");
});

describe("GET /api/upload/raw", () => {
  it("redirects an ordinary key to a signed URL", async () => {
    const res = await call("uploads/doc-images/a.png");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://signed.example/x");
  });

  it("rejects keys outside uploads/ with 400", async () => {
    expect((await call("secrets/a.png")).status).toBe(400);
  });

  it.each([
    "uploads/resumes/u2/a.pdf",
    "uploads/payroll-imports/x.csv",
    "uploads/drive-downloads/x.zip",
    "uploads/../uploads/resumes/u2/a.pdf",
    "uploads//resumes/u2/a.pdf",
  ])("returns 404 for the reserved key %s without signing", async (key) => {
    const res = await call(key);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as any);
    expect((await call("uploads/doc-images/a.png")).status).toBe(401);
  });
});
