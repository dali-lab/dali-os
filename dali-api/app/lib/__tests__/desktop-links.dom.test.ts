// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { installDesktopLinkHandling } from "~/lib/desktop-links";

const open = vi.fn();
let tabsOn = true;
vi.mock("~/lib/desktop-tabs-store", () => ({
  tabActions: { open: (...args: unknown[]) => open(...args) },
  tabsActive: () => tabsOn,
}));

// The shim reads the shell's injected global off window.top, so it stands in
// for "we are inside the desktop shell".
function pretendDesktop() {
  Object.defineProperty(window, "top", {
    configurable: true,
    value: { __DALI_DESKTOP: { version: "0.1.6" }, location: { href: "" } },
  });
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
    open.mockClear();
    tabsOn = true;
    delete (window as Window & { __daliDesktopLinks?: boolean }).__daliDesktopLinks;
  });

  it("does nothing in a browser — real tabs already work there", () => {
    Object.defineProperty(window, "top", { configurable: true, value: window });
    const before = window.open;
    installDesktopLinkHandling();
    expect(window.open).toBe(before);
    expect((window as Window & { __daliDesktopLinks?: boolean }).__daliDesktopLinks).toBeUndefined();
  });

  it("turns a target=_blank in-app link into a desktop tab", () => {
    pretendDesktop();
    installDesktopLinkHandling();
    clickLink({ href: "/projects/deserto", target: "_blank" }, "Deserto");
    expect(open).toHaveBeenCalledWith({ url: "/projects/deserto", label: "Deserto" });
  });

  it("routes window.open the same way — the doc editor's link toolbar uses it", () => {
    pretendDesktop();
    installDesktopLinkHandling();
    expect(window.open("/documents/abc", "_blank")).toBeNull();
    expect(open).toHaveBeenCalledWith({ url: "/documents/abc", label: "/documents/abc" });
  });

  it("hands an off-site link to the shell by navigating the top frame", () => {
    pretendDesktop();
    installDesktopLinkHandling();
    clickLink({ href: "https://example.com/doc", target: "_blank" });
    // The shell cancels this navigation and opens the URL in the OS browser,
    // so the top frame never actually moves.
    expect((window.top as unknown as { location: { href: string } }).location.href).toBe(
      "https://example.com/doc",
    );
  });

  it("leaves an ordinary in-app click to the router", () => {
    pretendDesktop();
    installDesktopLinkHandling();
    // Swallow the default in the bubble phase (the shim's own listener is on
    // capture, so it has already had its look) — otherwise jsdom warns about
    // the real navigation it can't perform.
    document.addEventListener("click", (e) => e.preventDefault());
    const a = clickLink({ href: "/home" });
    expect(open).not.toHaveBeenCalled();
    expect((window.top as unknown as { location: { href: string } }).location.href).toBe("");
    expect(a.isConnected).toBe(true);
  });
});
