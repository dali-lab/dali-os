// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPageLink,
  cleanTabUrl,
  isCopyPageLinkShortcut,
  stripHash,
  writePageLink,
} from "~/lib/page-link";

const origin = "https://os.dali.dartmouth.edu";

describe("buildPageLink", () => {
  it("prefixes the origin to a plain path", () => {
    expect(buildPageLink("/projects", origin)).toBe(`${origin}/projects`);
  });

  it("strips embed and keeps other params", () => {
    expect(buildPageLink("/drive?type=agreement&embed=1", origin)).toBe(`${origin}/drive?type=agreement`);
  });

  it("leaves no stray question mark when embed was the only param", () => {
    expect(buildPageLink("/docs/abc?embed=1", origin)).toBe(`${origin}/docs/abc`);
  });

  it("keeps the hash", () => {
    expect(buildPageLink("/docs/abc?embed=1#heading-2", origin)).toBe(`${origin}/docs/abc#heading-2`);
  });

  it("accepts a location-like object", () => {
    expect(
      buildPageLink({ pathname: "/docs/abc", search: "?a=1&embed=1", hash: "#x" }, origin),
    ).toBe(`${origin}/docs/abc?a=1#x`);
    expect(buildPageLink({ pathname: "/", search: "", hash: "" }, origin)).toBe(`${origin}/`);
  });
});

describe("cleanTabUrl and stripHash", () => {
  it("keeps the hash in the stored tab url", () => {
    expect(cleanTabUrl({ pathname: "/docs/a", search: "?embed=1", hash: "#h" })).toBe("/docs/a#h");
  });

  it("stripHash drops only the fragment", () => {
    expect(stripHash("/docs/a?x=1#h")).toBe("/docs/a?x=1");
    expect(stripHash("/docs/a")).toBe("/docs/a");
  });
});

describe("writePageLink", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes to the clipboard and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await writePageLink("https://x/y")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://x/y");
  });

  it("reports failure when the clipboard rejects", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) } });
    expect(await writePageLink("https://x/y")).toBe(false);
  });

  it("reports failure when there is no clipboard", async () => {
    vi.stubGlobal("navigator", {});
    expect(await writePageLink("https://x/y")).toBe(false);
  });

  it("hands the url to the desktop shell instead of the clipboard when native", async () => {
    const assign = vi.fn();
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("location", { assign });
    expect(await writePageLink("https://x/y?a=1#h", { native: true })).toBe(true);
    expect(assign).toHaveBeenCalledWith(`dalios://copy?url=${encodeURIComponent("https://x/y?a=1#h")}`);
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("isCopyPageLinkShortcut", () => {
  const base = { metaKey: false, ctrlKey: false, shiftKey: true, altKey: false, key: "c" };

  it("matches meta+shift+c in either case", () => {
    expect(isCopyPageLinkShortcut({ ...base, metaKey: true })).toBe(true);
    expect(isCopyPageLinkShortcut({ ...base, metaKey: true, key: "C" })).toBe(true);
  });

  it("matches ctrl+shift+c", () => {
    expect(isCopyPageLinkShortcut({ ...base, ctrlKey: true })).toBe(true);
  });

  it("needs a modifier", () => {
    expect(isCopyPageLinkShortcut(base)).toBe(false);
  });

  it("needs shift", () => {
    expect(isCopyPageLinkShortcut({ ...base, metaKey: true, shiftKey: false })).toBe(false);
  });

  it("ignores alt", () => {
    expect(isCopyPageLinkShortcut({ ...base, metaKey: true, altKey: true })).toBe(false);
  });

  it("ignores other keys", () => {
    expect(isCopyPageLinkShortcut({ ...base, metaKey: true, key: "k" })).toBe(false);
  });
});
