import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async (v: string | null) => (v ? `signed:${v}` : null)) }));

import { externalImageUrl, resolveProjectCover } from "../project-cover.server";

describe("project cover helpers", () => {
  it("hides pattern covers from external clients and keeps the field shape", () => {
    expect(externalImageUrl("pattern:poster?c=plum")).toBeNull();
    expect(externalImageUrl("uploads/a.webp")).toBe("uploads/a.webp");
    expect(externalImageUrl("https://x.example/a.png")).toBe("https://x.example/a.png");
    expect(externalImageUrl(null)).toBeNull();
    expect(externalImageUrl(undefined)).toBeNull();
  });

  it("passes a pattern through for in-app cards and signs everything else", async () => {
    expect(await resolveProjectCover("pattern:poster")).toBe("pattern:poster");
    expect(await resolveProjectCover("uploads/a.webp")).toBe("signed:uploads/a.webp");
    expect(await resolveProjectCover(null)).toBeNull();
  });
});
