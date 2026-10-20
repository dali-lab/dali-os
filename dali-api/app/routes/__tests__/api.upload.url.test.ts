import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/s3", () => ({ getDownloadUrl: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { getDownloadUrl } from "~/lib/s3";
import { loader } from "~/routes/api.upload.url";

function call(key: string) {
  return loader({ request: new Request(`http://localhost/api/upload/url?key=${encodeURIComponent(key)}`) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as any);
  vi.mocked(getDownloadUrl).mockResolvedValue("https://signed.example/x");
});

describe("GET /api/upload/url", () => {
  it("signs an ordinary key", async () => {
    const res = await call("uploads/avatars/me.png");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://signed.example/x" });
  });

  it.each(["uploads/resumes/u2/a.pdf", "resumes/u2/a.pdf", "/uploads/payroll-imports/x.csv"])(
    "returns 404 for the reserved key %s without signing",
    async (key) => {
      const res = await call(key);
      expect(res.status).toBe(404);
      expect(getDownloadUrl).not.toHaveBeenCalled();
    },
  );
});
