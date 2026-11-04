import { describe, expect, it } from "vitest";
import { canManageDocTags } from "~/components/TagPicker";

describe("canManageDocTags", () => {
  it("shows tag controls to Core on project and General documents", () => {
    expect(canManageDocTags(true, "Project")).toBe(true);
    expect(canManageDocTags(true, "Lab")).toBe(true);
  });

  it("hides them from non-Core editors", () => {
    expect(canManageDocTags(false, "Project")).toBe(false);
    expect(canManageDocTags(false, "Lab")).toBe(false);
  });

  it("hides them on documents the apply route rejects", () => {
    expect(canManageDocTags(true, "Personal")).toBe(false);
    expect(canManageDocTags(true, "Meeting")).toBe(false);
  });
});
