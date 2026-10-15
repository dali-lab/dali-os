import { describe, expect, it } from "vitest";
import { comparableUrl } from "~/components/TabWorkspace";
import { workspacePath } from "~/components/workspace-link";

describe("comparableUrl", () => {
  it("leaves a plain path alone", () => {
    expect(comparableUrl("/hiring/applications")).toBe("/hiring/applications");
  });

  it("drops the embed marker a frame's own location carries", () => {
    expect(comparableUrl("/hiring/applications?embed=1")).toBe("/hiring/applications");
    expect(comparableUrl("/drive?type=agreement&embed=1")).toBe("/drive?type=agreement");
  });

  it("gives differently encoded queries one spelling", () => {
    expect(comparableUrl("/drive?q=a%20b")).toBe(comparableUrl("/drive?q=a+b"));
  });

  it("keeps a list and one of its items apart", () => {
    expect(comparableUrl("/hiring/applications/abc?embed=1")).not.toBe(
      comparableUrl("/hiring/applications"),
    );
  });
});

describe("workspacePath", () => {
  const origin = "https://os.dali.dartmouth.edu";

  it("reduces a full url on our origin to its path, query and hash", () => {
    expect(workspacePath(`${origin}/documents/abc`, origin)).toBe("/documents/abc");
    expect(workspacePath(`${origin}/drive?type=agreement#x`, origin)).toBe("/drive?type=agreement#x");
  });

  it("leaves a path alone", () => {
    expect(workspacePath("/documents/abc?embed=1", origin)).toBe("/documents/abc?embed=1");
  });

  it("leaves another origin alone", () => {
    expect(workspacePath("https://example.com/doc", origin)).toBe("https://example.com/doc");
  });

  it("leaves something that is not a url alone", () => {
    expect(workspacePath("::not a url::", origin)).toBe("::not a url::");
  });
});
