import { describe, it, expect } from "vitest";
import { imagePreviewSrc } from "../ReferenceModal";

describe("imagePreviewSrc", () => {
  it("keeps web and object URLs", () => {
    expect(imagePreviewSrc("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(imagePreviewSrc("http://example.com/a.png")).toBe("http://example.com/a.png");
    expect(imagePreviewSrc("blob:https://os.dali.dartmouth.edu/1234")).toBe("blob:https://os.dali.dartmouth.edu/1234");
  });

  it("drops script, data and malformed URLs", () => {
    expect(imagePreviewSrc("javascript:alert(1)")).toBeNull();
    expect(imagePreviewSrc("data:image/svg+xml,<svg onload=alert(1)>")).toBeNull();
    expect(imagePreviewSrc("not a url")).toBeNull();
    expect(imagePreviewSrc(null)).toBeNull();
  });
});
