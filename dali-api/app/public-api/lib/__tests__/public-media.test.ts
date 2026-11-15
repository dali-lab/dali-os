import { describe, it, expect } from "vitest";
import { publicMediaUrl } from "../public-media";

describe("publicMediaUrl", () => {
  it("returns null for a pattern cover", () => {
    expect(publicMediaUrl("pattern:poster")).toBeNull();
  });

  it("keeps full URLs and routes keys through the media path", () => {
    expect(publicMediaUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(publicMediaUrl("uploads/a.webp")).toContain("uploads%2Fa.webp");
    expect(publicMediaUrl(null)).toBeNull();
  });
});
