import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { requireShowcaseSecret, isPublicApiConfigured } from "~/public-api/lib/public-auth.server";
import { isServableMediaKey, publicMediaUrl } from "~/public-api/lib/public-media";

const ORIGINAL = process.env.SHOWCASE_API_SECRET;

function req(secret?: string) {
  return new Request("https://dali-os.test/api/public/projects", {
    headers: secret ? { "x-showcase-secret": secret } : {},
  });
}

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SHOWCASE_API_SECRET;
  else process.env.SHOWCASE_API_SECRET = ORIGINAL;
});

describe("requireShowcaseSecret", () => {
  beforeEach(() => {
    process.env.SHOWCASE_API_SECRET = "correct-horse-battery-staple";
  });

  it("allows a request carrying the exact secret", () => {
    expect(requireShowcaseSecret(req("correct-horse-battery-staple"))).toBeNull();
  });

  it("rejects a missing header", async () => {
    const res = requireShowcaseSecret(req());
    expect(res?.status).toBe(401);
  });

  it("rejects a wrong secret of the same length", () => {
    expect(requireShowcaseSecret(req("correct-horse-battery-stapleX"))?.status).toBe(401);
    expect(requireShowcaseSecret(req("wrong-horse-battery-staple!!"))?.status).toBe(401);
  });

  it("rejects a prefix of the secret without throwing on the length mismatch", () => {
    expect(requireShowcaseSecret(req("correct"))?.status).toBe(401);
  });

  it("fails closed when the secret is unset, rather than serving openly", () => {
    delete process.env.SHOWCASE_API_SECRET;
    expect(isPublicApiConfigured()).toBe(false);
    // 503, not 200: a deploy that forgot the secret must not silently expose
    // the showcase to anyone who omits the header.
    expect(requireShowcaseSecret(req())?.status).toBe(503);
    expect(requireShowcaseSecret(req("anything"))?.status).toBe(503);
  });
});

describe("isServableMediaKey", () => {
  it("allows keys the app itself uploaded", () => {
    expect(isServableMediaKey("uploads/project-images/abc/1.webp")).toBe(true);
  });

  it("refuses keys outside uploads/, so the secret is not a bucket-wide read key", () => {
    expect(isServableMediaKey("exports/payroll.csv")).toBe(false);
    expect(isServableMediaKey("/uploads/x.png")).toBe(false);
    expect(isServableMediaKey("uploads/../exports/payroll.csv")).toBe(false);
  });
});

describe("publicMediaUrl", () => {
  it("routes stored S3 keys through the website's media proxy", () => {
    expect(publicMediaUrl("uploads/a b.png")).toBe("/api/media?key=uploads%2Fa%20b.png");
  });

  it("passes absolute URLs through untouched", () => {
    expect(publicMediaUrl("https://example.com/x.png")).toBe("https://example.com/x.png");
  });

  it("maps absent images to null", () => {
    expect(publicMediaUrl(null)).toBeNull();
    expect(publicMediaUrl("")).toBeNull();
  });
});
