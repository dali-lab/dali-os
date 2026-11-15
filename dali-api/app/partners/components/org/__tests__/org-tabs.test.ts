import { describe, expect, it } from "vitest";
import { ORG_TAB_LABELS, ORG_TAB_VALUES, isOrgTab, memberName } from "../org-tabs";

describe("isOrgTab", () => {
  it("accepts every tab and rejects anything else", () => {
    for (const t of ORG_TAB_VALUES) expect(isOrgTab(t)).toBe(true);
    expect(isOrgTab(null)).toBe(false);
    expect(isOrgTab("")).toBe(false);
    expect(isOrgTab("bogus")).toBe(false);
    expect(isOrgTab("toString")).toBe(false);
  });

  it("labels every tab", () => {
    expect(Object.keys(ORG_TAB_LABELS).sort()).toEqual([...ORG_TAB_VALUES].sort());
  });
});

describe("memberName", () => {
  it("falls back from name to email to a placeholder", () => {
    expect(memberName({ name: "Ada", email: "ada@example.edu" })).toBe("Ada");
    expect(memberName({ name: "", email: "ada@example.edu" })).toBe("ada@example.edu");
    expect(memberName({ name: "", email: null })).toBe("Unnamed");
  });
});
