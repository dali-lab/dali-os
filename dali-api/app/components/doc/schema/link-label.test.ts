import { describe, expect, it } from "vitest";
import { linkLabel } from "../components/editors/LinksEditor";

describe("linkLabel", () => {
  it("shows the host without www", () => {
    expect(linkLabel("https://www.example.com/a/b?c=1")).toBe("example.com");
  });
  it("accepts a bare domain", () => {
    expect(linkLabel("docs.dali.dev/guide")).toBe("docs.dali.dev");
  });
  it("keeps mailto-style schemes readable", () => {
    expect(linkLabel("mailto:hi@dali.dev")).toBe("mailto:hi@dali.dev");
  });
  it("is empty for blank input", () => {
    expect(linkLabel("   ")).toBe("");
  });
});
