// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { PageBar } from "~/components/shell/PageBar";
import { PageBarMenuItems, PageBarPortal, PageBarSlotProvider } from "~/components/shell/page-bar-slot";
import { FeatureFlagsProvider } from "~/components/FeatureFlags";
import { ToastProvider } from "~/components/ui/toast";
import { Menu } from "~/components/ui/floating";
import { ProjectViewSwitch } from "~/projects/components/ProjectViewSwitch";

vi.mock("~/components/page-docs/PageDocButton", () => ({
  PageDocButton: () => createElement("button", { type: "button", "aria-label": "Open this page's guide" }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const star = { favorited: false, inSidebar: false, canToggle: true, toggle: async () => {} };

async function mount({
  page,
  tabs = true,
  onCopyLink = () => {},
}: { page?: ReactNode; tabs?: boolean; onCopyLink?: () => void } = {}) {
  const Stub = createRoutesStub([
    {
      path: "*",
      Component: () =>
        createElement(
          ToastProvider,
          null,
          createElement(FeatureFlagsProvider, {
            flags: {},
            children: createElement(PageBarSlotProvider, {
              children: createElement("div", null, page, createElement(PageBar, { tabs, star, onCopyLink })),
            }),
          }),
        ),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/documents/a"] }));
  });
}

const bar = () => container.firstElementChild!.querySelector<HTMLElement>(".h-11, .h-\\[54px\\]")!;
const barButtons = () =>
  [...bar().lastElementChild!.querySelectorAll<HTMLElement>("button, a")].map((el) => el.getAttribute("aria-label") ?? el.textContent);
const openMenu = () =>
  act(async () => {
    container.querySelector<HTMLElement>('button[aria-label="More actions"]')!.click();
  });
const menuItems = () => [...document.body.querySelectorAll('[role="menuitem"]')];

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("PageBar overflow", () => {
  it("shows the guide, favorite and one more-actions button, and nothing else by default", async () => {
    await mount();
    expect(barButtons()).toEqual([
      "Open this page's guide",
      "Add this page to favorites",
      "More actions",
    ]);
  });

  it("keeps a page's primary action, Share and presence as buttons and moves the rest into the menu", async () => {
    await mount({
      page: createElement(
        "div",
        null,
        createElement(
          PageBarPortal,
          { slot: "actions" },
          createElement("button", { type: "button" }, "Record"),
          createElement("button", { type: "button" }, "Share"),
        ),
        createElement(
          PageBarMenuItems,
          null,
          createElement(Menu.Item, null, "Download PDF"),
          createElement(Menu.Item, null, "Duplicate"),
        ),
      ),
    });
    expect(barButtons()).toEqual([
      "Record",
      "Share",
      "Open this page's guide",
      "Add this page to favorites",
      "More actions",
    ]);
    await openMenu();
    expect(menuItems().map((el) => el.textContent)).toEqual(["Download PDF", "Duplicate", "Copy link⌘⇧C"]);
  });

  it("never renders two more buttons when a page contributes entries", async () => {
    await mount({ page: createElement(PageBarMenuItems, null, createElement(Menu.Item, null, "Duplicate")) });
    expect(container.querySelectorAll('button[aria-label="More actions"]')).toHaveLength(1);
    expect(container.querySelectorAll("[aria-haspopup='menu']")).toHaveLength(1);
  });

  it("separates the page's entries from the shell's", async () => {
    await mount({ page: createElement(PageBarMenuItems, null, createElement(Menu.Item, null, "Duplicate")) });
    await openMenu();
    expect(document.body.querySelectorAll("hr")).toHaveLength(1);
  });

  it("shows the copy link shortcut and copies when chosen", async () => {
    const onCopyLink = vi.fn();
    await mount({ onCopyLink });
    await openMenu();
    const item = menuItems().find((el) => el.textContent?.includes("Copy link"))!;
    expect(item.textContent).toContain("⌘⇧C");
    await act(async () => item.click());
    expect(onCopyLink).toHaveBeenCalledTimes(1);
  });

  it("moves project view switches into the menu", async () => {
    await mount({ page: createElement(ProjectViewSwitch, { projectId: "p1", current: "internal" }) });
    expect(barButtons()).not.toContain("Partner view");
    await openMenu();
    const links = menuItems().map((el) => [el.textContent, el.getAttribute("href")]);
    expect(links).toContainEqual(["Partner view", "/projects/p1/partner-view"]);
    expect(links).toContainEqual(["Public view", "/projects/p1/public-view"]);
  });

  it("hints the favorite shortcut in its tooltip", async () => {
    await mount();
    const starButton = container.querySelector<HTMLElement>("[aria-label='Add this page to favorites']")!;
    await act(async () => {
      starButton.dispatchEvent(new FocusEvent("focus"));
      starButton.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(document.body.querySelector("[role='tooltip']")?.textContent).toContain("⌘D");
  });
});

describe("PageBar top spacing", () => {
  it("adds 10px of top padding when the tab strip is hidden", async () => {
    await mount({ tabs: false });
    expect(bar().className).toContain("pt-2.5");
  });

  it("adds none when the tab strip shows", async () => {
    await mount({ tabs: true });
    expect(bar().className).not.toContain("pt-2.5");
  });
});
