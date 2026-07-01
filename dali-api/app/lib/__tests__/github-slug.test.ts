import { describe, it, expect } from "vitest";
import { githubTeamSlug } from "~/lib/github-slug";

describe("githubTeamSlug", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(githubTeamSlug("Smart Microscope")).toBe("smart-microscope");
  });

  it("collapses runs of non-alphanumerics into a single hyphen", () => {
    expect(githubTeamSlug("DALI OS 2.0")).toBe("dali-os-2-0");
    expect(githubTeamSlug("a  &  b")).toBe("a-b");
    expect(githubTeamSlug("Hello_World!")).toBe("hello-world");
  });

  it("trims leading and trailing hyphens", () => {
    expect(githubTeamSlug("  Hello World  ")).toBe("hello-world");
    expect(githubTeamSlug("!!Edge!!")).toBe("edge");
  });

  it("returns '' when the name has no alphanumerics", () => {
    expect(githubTeamSlug("—")).toBe("");
    expect(githubTeamSlug("   ")).toBe("");
    expect(githubTeamSlug("🚀")).toBe("");
  });
});
