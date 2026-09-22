// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { installDesktopLinkHandling } from "~/lib/desktop-links";

// The shim reads the shell's injected global off window.top and posts tab
// requests to window.parent, so both stand in for "we are a workspace tab
// inside the desktop shell".
function pretendDesktopTab() {
  const postMessage = vi.fn();
  Object.defineProperty(window, "top", {
    configurable: true,
    value: { __DALI_DESKTOP: { version: "0.1.6" }, location: { href: "" } },
  });
  Object.defineProperty(window, "parent", { configurable: true, value: { postMessage } });
  return postMessage;
}

function clickLink(attrs: Record<string, string>, text = "a link") {
  const a = document.createElement("a");
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  a.textContent = text;
  document.body.appendChild(a);
  a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  return a;
}

describe("installDesktopLinkHandling", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete (window as Window & { __daliDesktopLinks?: boolean }).__daliDesktopLinks;
  });

  it("does nothing in a browser — real tabs already work there", () => {
    Object.defineProperty(window, "top", { configurable: true, value: window });
    const before = window.open;
    installDesktopLinkHandling();
    expect(window.open).toBe(before);
    expect((window as Window & { __daliDesktopLinks?: boolean }).__daliDesktopLinks).toBeUndefined();
  });

  it("turns a target=_blank in-app link into a workspace tab", () => {
    const postMessage = pretendDesktopTab();
    installDesktopLinkHandling();
    clickLink({ href: "/projects/deserto", target: "_blank" }, "Deserto");
    expect(postMessage).toHaveBeenCalledWith(
      { type: "dali:openTab", url: `${window.location.origin}/projects/deserto`, label: "Deserto" },
      window.location.origin,
    );
  });

  it("routes window.open the same way — the doc editor's link toolbar uses it", () => {
    const postMessage = pretendDesktopTab();
    installDesktopLinkHandling();
    expect(window.open("/documents/abc", "_blank")).toBeNull();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "dali:openTab", url: `${window.location.origin}/documents/abc` }),
      window.location.origin,
    );
  });

  it("hands an off-site link to the shell by navigating the top frame", () => {
    pretendDesktopTab();
    installDesktopLinkHandling();
    clickLink({ href: "https://example.com/doc", target: "_blank" });
    // The shell cancels this navigation and opens the URL in the OS browser,
    // so the top frame never actually moves.
    expect((window.top as unknown as { location: { href: string } }).location.href).toBe(
      "https://example.com/doc",
    );
  });

  it("leaves an ordinary in-app click to the router", () => {
    const postMessage = pretendDesktopTab();
    installDesktopLinkHandling();
    // Swallow the default in the bubble phase (the shim's own listener is on
    // capture, so it has already had its look) — otherwise jsdom warns about
    // the real navigation it can't perform.
    document.addEventListener("click", (e) => e.preventDefault());
    const a = clickLink({ href: "/home" });
    expect(postMessage).not.toHaveBeenCalled();
    expect((window.top as unknown as { location: { href: string } }).location.href).toBe("");
    expect(a.isConnected).toBe(true);
  });
});
