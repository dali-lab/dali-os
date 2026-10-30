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
import { Mail } from "lucide-react";
import { DEFAULT_AREA_TINT } from "~/lib/nav-areas";
import { adoptDesktopSession, resetLiveSession } from "~/components/meeting-recorder/live-session";

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
  tile = {},
  flags = {},
}: {
  page?: ReactNode;
  tabs?: boolean;
  onCopyLink?: () => void;
  tile?: { areaKey?: string; icon?: typeof Mail };
  flags?: Record<string, boolean>;
} = {}) {
  const Stub = createRoutesStub([
    {
      path: "*",
      Component: () =>
        createElement(
          ToastProvider,
          null,
          createElement(FeatureFlagsProvider, {
            flags,
            children: createElement(PageBarSlotProvider, {
              children: createElement("div", null, page, createElement(PageBar, { tabs, star, onCopyLink, ...tile })),
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
  it("shows no section tile on a page with no area and no glyph", async () => {
    await mount();
    expect(container.querySelector("[data-area-tile]")).toBeNull();
  });

  it("shows the area's tile with the area's glyph", async () => {
    await mount({ tile: { areaKey: "core" } });
    const tile = container.querySelector<HTMLElement>("[data-area-tile='core']")!;
    expect(tile.querySelector("svg")).not.toBeNull();
  });

  it("draws a page's own glyph in the selected area's tone", async () => {
    await mount({ tile: { areaKey: "education", icon: Mail } });
    const tile = container.querySelector<HTMLElement>("[data-area-tile='education']")!;
    expect(tile.querySelector("svg.lucide-mail")).not.toBeNull();
  });

  it("draws a page's own glyph in the default tone when no area is selected", async () => {
    await mount({ tile: { icon: Mail } });
    const tile = container.querySelector<HTMLElement>("[data-area-tile]")!;
    expect(tile.querySelector("svg.lucide-mail")).not.toBeNull();
    expect(tile.style.getPropertyValue("--tile-tint")).toBe(DEFAULT_AREA_TINT);
  });

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
          {
            slot: "actions",
            children: [
              createElement("button", { key: "record", type: "button" }, "Record"),
              createElement("button", { key: "share", type: "button" }, "Share"),
            ],
          },
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
    await act(async () => (item as HTMLElement).click());
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
  it("grows taller, with centered content, when the tab strip is hidden", async () => {
    await mount({ tabs: false });
    expect(bar().className).toContain("h-[54px]");
    expect(bar().className).not.toContain("pt-2.5");
  });

  it("stays compact when the tab strip shows", async () => {
    await mount({ tabs: true });
    expect(bar().className).toContain("h-11");
    expect(bar().className).not.toContain("pt-2.5");
  });
});

describe("PageBar recording pill", () => {
  afterEach(() => resetLiveSession());

  async function recording() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          recording: { id: "r1", documentName: "doc:z:body", status: "Recording", title: "Weekly sync", href: "/documents/z", sessionSeconds: 5 },
        }),
      ),
    );
    await act(async () => {
      adoptDesktopSession({ recordingId: "r1", documentName: "doc:z:body", status: "recording", startedAt: Date.now() });
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("leads the right-hand cluster, ahead of the page's own actions", async () => {
    await recording();
    await mount({ flags: { "ai-meeting-notes": true }, page: createElement(PageBarPortal, { slot: "actions", children: createElement("button", { "aria-label": "Page action" }) }) });
    const right = bar().lastElementChild!;
    expect(right.firstElementChild?.textContent).toContain("Weekly sync");
    expect(barButtons().indexOf("Stop recording")).toBeLessThan(barButtons().indexOf("Page action"));
  });

  it("is absent without the flag", async () => {
    await recording();
    await mount();
    expect(bar().textContent).not.toContain("Weekly sync");
  });
});
