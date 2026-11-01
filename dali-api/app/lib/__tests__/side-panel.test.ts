import { describe, expect, it } from "vitest";
import {
  formatSidePanel,
  parseSidePanel,
  resolvePanelLoad,
  sidePanelForUrl,
  sidePanelHref,
  visibleSidePanel,
  withSidePanel,
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

describe("withSidePanel", () => {
  const panel = { type: "doc", id: "abc" } as const;

  it("names the panel, keeping the rest of the url", () => {
    expect(withSidePanel("/projects/1?tab=drive#top", panel)).toBe("/projects/1?tab=drive&side=doc%3Aabc#top");
  });

  it("leaves the url alone with no panel, or one it already names", () => {
    expect(withSidePanel("/projects/1", null)).toBe("/projects/1");
    expect(withSidePanel("/projects/1?side=doc:other", panel)).toBe("/projects/1?side=doc:other");
  });
});

describe("visibleSidePanel", () => {
  const page = (over = {}) => ({ pathname: "/projects/1", search: "", ...over });

  it("shows the panel the url names over the kept one", () => {
    expect(visibleSidePanel(page({ search: "?side=doc:url" }), "doc:kept")?.id).toBe("url");
  });

  it("carries the kept panel to a url that doesn't name one", () => {
    expect(visibleSidePanel(page(), "doc:kept")?.id).toBe("kept");
  });

  it("shows nothing with neither", () => {
    expect(visibleSidePanel(page(), null)).toBeNull();
  });

  it("drops the kept panel on a move to another tab", () => {
    expect(visibleSidePanel(page({ state: { tabSwitch: true } }), "doc:kept")).toBeNull();
  });

  it("keeps it when stepping back inside the same tab", () => {
    expect(visibleSidePanel(page({ state: { tabSwitch: true, keepPanel: true } }), "doc:kept")?.id).toBe("kept");
  });

  it("still shows the panel a tab's own url names after a tab move", () => {
    expect(visibleSidePanel(page({ search: "?side=doc:tab", state: { tabSwitch: true } }), "doc:kept")?.id).toBe("tab");
  });

  it("hides the panel when the page itself is that document", () => {
    expect(visibleSidePanel(page({ pathname: "/documents/kept" }), "doc:kept")).toBeNull();
    expect(visibleSidePanel(page({ pathname: "/documents/abc", search: "?side=doc:abc" }), null)).toBeNull();
  });
});
