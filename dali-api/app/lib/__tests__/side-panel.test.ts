import { describe, expect, it } from "vitest";
import {
  formatSidePanel,
  panelLocation,
  parseSidePanel,
  resolvePanelLoad,
  sidePanelForUrl,
  sidePanelHref,
} from "~/lib/side-panel";

describe("side panel param", () => {
  it("round-trips a document panel", () => {
    const panel = parseSidePanel("doc:abc_123-x");
    expect(panel).toEqual({ type: "doc", id: "abc_123-x" });
    expect(formatSidePanel(panel!)).toBe("doc:abc_123-x");
    expect(sidePanelHref(panel!)).toBe("/documents/abc_123-x");
  });

  it.each([null, undefined, "", "doc", ":abc", "doc:", "task:abc", "doc:a/b", "doc:a?b"])(
    "rejects %p",
    (value) => {
      expect(parseSidePanel(value)).toBeNull();
    },
  );

  it("names the panel for a document url", () => {
    expect(sidePanelForUrl("/documents/abc")).toEqual({ type: "doc", id: "abc" });
    expect(sidePanelForUrl("/documents/abc?comment=1")).toEqual({ type: "doc", id: "abc" });
    expect(sidePanelForUrl("/documents/abc/export")).toBeNull();
    expect(sidePanelForUrl("/projects/abc")).toBeNull();
  });
});

describe("resolvePanelLoad", () => {
  const redirect = (to: string, status = 302) =>
    new Response(null, { status, headers: { Location: to } });

  it("follows a redirect to another document", () => {
    expect(resolvePanelLoad(redirect("/documents/tab2?x=1"), "nb")).toEqual({
      kind: "follow",
      pageId: "tab2",
    });
  });

  it("links out for a redirect anywhere else", () => {
    expect(resolvePanelLoad(redirect("/whiteboard/w1"), "w1")).toEqual({
      kind: "elsewhere",
      href: "/whiteboard/w1",
    });
    expect(resolvePanelLoad(redirect("/documents/d1/public"), "d1")).toEqual({
      kind: "elsewhere",
      href: "/documents/d1/public",
    });
  });

  it("treats an error response as missing", () => {
    expect(resolvePanelLoad(new Response("Not found", { status: 404 }), "x")).toEqual({ kind: "missing" });
  });

  it("links out for an empty notebook", () => {
    expect(resolvePanelLoad({ title: "N", emptyNotebook: {} }, "nb")).toEqual({
      kind: "elsewhere",
      href: "/documents/nb",
    });
  });

  it("passes document data through", () => {
    const data = { pageId: "d1", title: "Spec" };
    expect(resolvePanelLoad(data, "d1")).toEqual({ kind: "doc", data });
  });

  it("treats anything else as missing", () => {
    expect(resolvePanelLoad(null, "x")).toEqual({ kind: "missing" });
    expect(resolvePanelLoad({ title: "?" }, "x")).toEqual({ kind: "missing" });
  });
});

describe("panelLocation", () => {
  it("names a member's own space and omits anything it cannot name", () => {
    expect(panelLocation("Member")).toBe("My Drive");
    expect(panelLocation("Lab")).toBeNull();
    expect(panelLocation(undefined)).toBeNull();
  });
});
