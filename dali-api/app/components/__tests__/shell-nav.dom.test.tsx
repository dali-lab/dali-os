// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { useShellNav } from "~/components/shell-nav";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const open = vi.fn();
vi.mock("~/lib/desktop-tabs-store", () => ({
  tabActions: { open: (...args: unknown[]) => open(...args) },
}));

let container: HTMLDivElement;
let root: Root;
let nav: ReturnType<typeof useShellNav>;
let windowOpen: ReturnType<typeof vi.spyOn>;

function Probe(props: { tabs?: boolean; sidePanel?: boolean }) {
  nav = useShellNav(props);
  const { pathname, search } = useLocation();
  return createElement(
    "div",
    null,
    createElement("output", { "data-testid": "where" }, pathname + search),
    createElement("output", { "data-testid": "palette" }, String(nav.paletteOpen)),
    createElement("button", { id: "row", ...nav.tabClickProps({ url: "/projects", label: "Projects" }) }),
  );
}

async function mount(props: { tabs?: boolean; sidePanel?: boolean } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: ["/home"] }, createElement(Probe, props)));
  });
}

const where = () => container.querySelector("[data-testid=where]")!.textContent;
const palette = () => container.querySelector("[data-testid=palette]")!.textContent;
const row = () => container.querySelector<HTMLButtonElement>("#row")!;

beforeEach(() => {
  open.mockClear();
  windowOpen = vi.spyOn(window, "open").mockReturnValue(null);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("useShellNav row clicks", () => {
  it("navigates this window on a plain click", async () => {
    await mount();
    await act(async () => row().click());
    expect(where()).toBe("/projects");
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it.each([{ metaKey: true }, { ctrlKey: true }])("opens a browser tab on a modified click %j", async (mods) => {
    await mount();
    await act(async () => {
      row().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...mods }));
    });
    expect(windowOpen).toHaveBeenCalledWith("/projects", "_blank", "noopener");
    expect(where()).toBe("/home");
  });

  it("opens a browser tab on a middle click and ignores other aux buttons", async () => {
    await mount();
    await act(async () => {
      row().dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 }));
    });
    expect(windowOpen).not.toHaveBeenCalled();
    await act(async () => {
      row().dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    });
    expect(windowOpen).toHaveBeenCalledWith("/projects", "_blank", "noopener");
  });

  it("previews in the reusable desktop tab on a plain click while tabs are showing", async () => {
    await mount({ tabs: true });
    await act(async () => row().click());
    expect(open).toHaveBeenCalledWith({ url: "/projects", label: "Projects" }, { ephemeral: true });
    expect(where()).toBe("/home");
  });

  it("opens a background desktop tab on a modified or middle click while tabs are showing", async () => {
    await mount({ tabs: true });
    await act(async () => {
      row().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
      row().dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    });
    expect(open).toHaveBeenNthCalledWith(1, { url: "/projects", label: "Projects" }, { background: true });
    expect(open).toHaveBeenNthCalledWith(2, { url: "/projects", label: "Projects" }, { background: true });
  });
});

describe("useShellNav palette", () => {
  it("toggles on mod+K", async () => {
    await mount();
    expect(palette()).toBe("false");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true, bubbles: true }));
    });
    expect(palette()).toBe("true");
  });

  it("navigates for a result, and opens a browser tab for a side open", async () => {
    await mount();
    await act(async () => nav.openFromPalette("/calendar", "Calendar", false));
    expect(where()).toBe("/calendar");
    await act(async () => nav.openFromPalette("/email", "Email", true));
    expect(windowOpen).toHaveBeenCalledWith("/email", "_blank", "noopener");
    expect(where()).toBe("/calendar");
  });

  it("opens a document beside the page on a side open when the side panel is on", async () => {
    window.history.replaceState(null, "", "/home");
    await mount({ sidePanel: true });
    await act(async () => nav.openFromPalette("/documents/abc", "Doc", true));
    expect(where()).toBe("/home?side=doc%3Aabc");
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("opens a background desktop tab for a side open while tabs are showing", async () => {
    await mount({ tabs: true });
    await act(async () => nav.openFromPalette("/email", "Email", true));
    expect(open).toHaveBeenCalledWith({ url: "/email", label: "Email" }, { background: true });
  });
});
