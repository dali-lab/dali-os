// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { Download } from "lucide-react";
import { DriveBrowser, type DriveBrowserProps } from "~/components/drive/DriveBrowser";
import { PageRowControlsScope, PageTabRow } from "~/components/os-page";
import { DialogProvider } from "~/components/ui/dialog";
import { ToastProvider } from "~/components/ui/toast";
import type { DriveTreeScope } from "~/drive/lib/drive-scopes.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scope: DriveTreeScope = {
  id: "lab",
  label: "Lab-wide",
  iconEmoji: null,
  items: [
    { type: "doc", id: "d1", title: "Doc d1", parentFolderId: null, iconEmoji: null, updatedAt: new Date(0), href: "/documents/d1" },
  ],
};

let container: HTMLDivElement;
let root: Root;
const onSearchChange = vi.fn();
const onUpload = vi.fn();

async function mount(opts: { inRow: boolean; search?: string }) {
  const rowControls: DriveBrowserProps["rowControls"] = ({ search, view }) => [
    search,
    ...(view ? [view] : []),
    { key: "upload", label: "Upload", icon: Download, primary: true, onClick: onUpload },
  ];
  function Harness() {
    const [loc] = useState<string | null>("lab");
    const browser = createElement(DriveBrowser, {
      scopes: [scope],
      currentScopeId: loc,
      currentFolderId: null,
      typeFilter: "all",
      search: opts.search ?? "",
      onSearchChange,
      onNavigate: vi.fn(),
      onOpenItem: vi.fn(),
      onMove: vi.fn(),
      getScopeActions: () => ({ onRename: vi.fn(), onRequestMove: vi.fn(), onDelete: vi.fn() }),
      embeddedScopeId: "lab",
      rowControls,
      newMenu: opts.inRow ? undefined : createElement("button", { type: "button", "data-testid": "standalone-new" }, "New"),
    });
    const wrap = (children: ReactNode) =>
      opts.inRow
        ? createElement(PageRowControlsScope, null, createElement(PageTabRow, { label: "Sections", tabs: [{ label: "Drive", icon: Download, active: true, onClick: () => {} }] }), children)
        : children;
    return createElement(ToastProvider, null, createElement(DialogProvider, null, wrap(browser)));
  }
  const Stub = createRoutesStub([{ path: "/", Component: Harness }]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const rowEl = () => container.querySelector('[data-density]')!;
const listing = () => container.querySelector('[data-testid="drive-browser"]')!;

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  window.localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("DriveBrowser controls", () => {
  it("hands search, the view toggle and the primary to the page row, and drops them from the listing header", async () => {
    await mount({ inRow: true });
    expect(rowEl().querySelector('[data-testid="drive-search"]')).not.toBeNull();
    expect(rowEl().querySelector('[data-testid="drive-view-list"]')).not.toBeNull();
    expect([...rowEl().querySelectorAll("button")].some((b) => b.textContent === "Upload")).toBe(true);
    expect(listing().querySelector('[data-testid="drive-search"]')).toBeNull();
    expect(listing().querySelector('[data-testid="drive-view-list"]')).toBeNull();
    expect(listing().querySelector('[data-testid="standalone-new"]')).toBeNull();
  });

  it("changes the view and the search from the row", async () => {
    await mount({ inRow: true });
    await act(async () => {
      rowEl().querySelector<HTMLElement>('[data-testid="drive-view-list"]')!.click();
    });
    expect(rowEl().querySelector('[data-testid="drive-view-list"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-testid="drive-columns"]')).toBeNull();
    const input = rowEl().querySelector<HTMLInputElement>('[data-testid="drive-search"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, "plan");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSearchChange).toHaveBeenCalledWith("plan");
    await act(async () => {
      rowEl().querySelector<HTMLElement>('button[aria-label="Upload"], button')!;
      [...rowEl().querySelectorAll("button")].find((b) => b.textContent === "Upload")!.click();
    });
    expect(onUpload).toHaveBeenCalledOnce();
  });

  it("leaves the view toggle out of the row while a search is showing results", async () => {
    await mount({ inRow: true, search: "plan" });
    expect(rowEl().querySelector('[data-testid="drive-view-list"]')).toBeNull();
    expect(rowEl().querySelector('[data-testid="drive-search"]')).not.toBeNull();
  });

  it("keeps the standalone toolbar when there is no page row", async () => {
    await mount({ inRow: false });
    expect(listing().querySelector('[data-testid="drive-search"]')).not.toBeNull();
    expect(listing().querySelector('[data-testid="drive-view-list"]')).not.toBeNull();
    expect(listing().querySelector('[data-testid="standalone-new"]')).not.toBeNull();
  });
});
