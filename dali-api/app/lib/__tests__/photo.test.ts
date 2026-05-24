import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/s3", () => ({
  getDownloadUrl: vi.fn(),
}));

import { getDownloadUrl } from "~/lib/s3";
import { resolvePhotoUrl } from "~/lib/photo";

describe("resolvePhotoUrl", () => {
  beforeEach(() => {
    vi.mocked(getDownloadUrl).mockReset();
    vi.mocked(getDownloadUrl).mockResolvedValue("https://s3.example/signed");
  });

  it("returns null for null/undefined/empty", async () => {
    expect(await resolvePhotoUrl(null)).toBeNull();
    expect(await resolvePhotoUrl(undefined)).toBeNull();
    expect(await resolvePhotoUrl("")).toBeNull();
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it("passes legacy full URLs through unchanged", async () => {
    const url = "https://example.com/me.jpg";
    expect(await resolvePhotoUrl(url)).toBe(url);
    expect(await resolvePhotoUrl("http://example.com/me.jpg")).toBe(
      "http://example.com/me.jpg",
    );
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it("presigns S3 keys under uploads/", async () => {
    const key = "uploads/avatars/user-1/abc.webp";
    expect(await resolvePhotoUrl(key)).toBe("https://s3.example/signed");
    expect(getDownloadUrl).toHaveBeenCalledWith(key);
  });
});
