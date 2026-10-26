// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { Rail, type RailProps } from "~/components/shell/Rail";
import { ToastProvider } from "~/components/ui/toast";
import { Settings } from "lucide-react";
import { homeNavItem, pinnedNavItems } from "~/lib/nav-areas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const base: RailProps = {
  userName: "Ada Lovelace",
  initials: "AL",
  photoUrl: null,
  path: "/",
  navFlags: {},
  isAlumni: false,
  home: homeNavItem({ isAlumni: false }),
  pinned: pinnedNavItems(),
  tabClickProps: () => ({ onClick: vi.fn() }),
  emailUnread: 0,
  taskCount: 0,
  bellOpen: false,
  onToggleBell: vi.fn(),
  onOpenSearch: vi.fn(),
  onHideRail: vi.fn(),
  favorites: [],
  onFavoritesChange: vi.fn(),
  favoritesActiveHref: null,
  areas: [],
  activeArea: undefined,
  activeSubtabs: [],
  activeHref: undefined,
  onSelectArea: vi.fn(),
  userMenuItems: [{ url: "/settings", label: "Settings", icon: Settings }],
  showWhatsNewDot: false,
};

async function mount(over: Partial<RailProps> = {}) {
  const props = { ...base, ...over };
  const Stub = createRoutesStub([
    { path: "*", Component: () => createElement(ToastProvider, null, createElement(Rail, props)) },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;

describe("Rail", () => {
  it("puts the wordmark, bell and sidebar toggle in the top row, above search", async () => {
    const tabClickProps = vi.fn(() => ({ onClick: vi.fn() }));
    await mount({ tabClickProps });
    const wordmark = q("button[aria-label='DALI OS home']")!;
    expect(wordmark.textContent).toBe("dali.os");
    const topRow = wordmark.parentElement!;
    expect(topRow.querySelector("button[aria-label^='Notifications']")).not.toBeNull();
    expect(topRow.querySelector("button[aria-label='Hide sidebar']")).not.toBeNull();
    expect(topRow.querySelector("button[aria-label='Search']")).toBeNull();
    expect(tabClickProps).toHaveBeenCalledWith({ url: "/", label: "Home" });
  });

  it("labels the search box Search with the shortcut", async () => {
    await mount();
    const search = q("button[aria-label='Search']")!;
    expect(search.textContent).toContain("Search");
    expect(search.textContent).not.toContain("ask");
    expect(search.textContent).toContain("⌘K");
  });

  it("only shows a label on the active quick item", async () => {
    await mount({ path: "/calendar" });
    expect(q("button[aria-label='Calendar']")!.textContent).toBe("Calendar");
    expect(q("button[aria-label='Calendar']")!.getAttribute("aria-current")).toBe("page");
    expect(q("button[aria-label='Home']")!.textContent).toBe("");
    expect(q("button[aria-label='Home']")!.getAttribute("aria-current")).toBeNull();
  });

  it("hides Email and Drive for alumni and sends Home to Connect", async () => {
    const tabClickProps = vi.fn(() => ({ onClick: vi.fn() }));
    await mount({
      isAlumni: true,
      home: homeNavItem({ isAlumni: true }),
      pinned: pinnedNavItems({ isAlumni: true }),
      path: "/connect",
      tabClickProps,
    });
    expect(q("button[aria-label='Email']")).toBeNull();
    expect(q("button[aria-label='Drive']")).toBeNull();
    expect(q("button[aria-label='Home']")!.getAttribute("aria-current")).toBe("page");
    expect(tabClickProps).toHaveBeenCalledWith({ url: "/connect", label: "Home" });
  });

  it("shows the pinned items it is given", async () => {
    await mount({ pinned: [...pinnedNavItems(), { label: "Journeys", href: "/journeys", icon: Settings }] });
    expect(q("button[aria-label='Drive']")).not.toBeNull();
    expect(q("button[aria-label='Journeys']")).not.toBeNull();
  });

  const area = (key: string) => ({ key, label: key.toUpperCase(), icon: Settings, hubPath: `/${key}`, subtabs: [] });

  it("names a lone area without offering a switch", async () => {
    const only = area("connect");
    await mount({ areas: [only], activeArea: only });
    expect(container.textContent).toContain("CONNECT");
    expect(q("button[aria-haspopup='listbox']")).toBeNull();
  });

  it("offers the area switch when there is more than one area", async () => {
    const lab = area("lab");
    await mount({ areas: [lab, area("core")], activeArea: lab });
    expect(q("button[aria-haspopup='listbox']")!.getAttribute("aria-label")).toBe("Section: LAB. Switch section");
  });

  it("shows the active area tile and label on the switcher row", async () => {
    const core = { ...area("core"), label: "Core" };
    await mount({ areas: [area("projects"), core], activeArea: core });
    const trigger = q("button[aria-haspopup='listbox']")!;
    expect(trigger.textContent).toContain("Core");
    expect(trigger.querySelector("[data-area-tile='core']")).not.toBeNull();
  });

  it("shows the tile on a lone area too", async () => {
    const only = area("core");
    await mount({ areas: [only], activeArea: only });
    expect(q("[data-area-tile='core']")).not.toBeNull();
  });

  it("lists areas in rail order with descriptions", async () => {
    const keys = ["admin", "core", "hiring", "education", "community", "projects"];
    const list = keys.map((k) => ({ ...area(k), label: k, description: `About ${k}` }));
    await mount({ areas: list, activeArea: list[0] });
    await act(async () => {
      q("button[aria-haspopup='listbox']")!.click();
    });
    const options = Array.from(container.querySelectorAll("[role='option']"));
    expect(options.map((o) => o.querySelector("[data-area-tile]")!.getAttribute("data-area-tile"))).toEqual([
      "projects",
      "community",
      "education",
      "hiring",
      "core",
      "admin",
    ]);
    expect(options[0].textContent).toContain("About projects");
    expect(options.filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("closes the area menu on Escape", async () => {
    const list = [area("projects"), area("core")];
    await mount({ areas: list, activeArea: list[0] });
    await act(async () => {
      q("button[aria-haspopup='listbox']")!.click();
    });
    expect(q("[role='listbox']")).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(q("[role='listbox']")).toBeNull();
  });

  it("dots Email when there is unread mail", async () => {
    await mount({ emailUnread: 3 });
    expect(q("button[aria-label='Email'] span.rounded-full")).not.toBeNull();
  });

  it("hides the bell badge at zero and caps it at 99+", async () => {
    await mount({ taskCount: 0 });
    expect(q("button[aria-haspopup='dialog']")!.textContent).toBe("");
    act(() => root.unmount());
    container.remove();
    await mount({ taskCount: 120 });
    expect(q("button[aria-haspopup='dialog']")!.textContent).toBe("99+");
  });

  it("omits the hide control when the rail is not hideable", async () => {
    await mount({ onHideRail: undefined });
    expect(q("button[aria-label='Hide sidebar']")).toBeNull();
  });

  it("hides the rail from its toggle", async () => {
    const onHideRail = vi.fn();
    await mount({ onHideRail });
    await act(async () => {
      q("button[aria-label='Hide sidebar']")!.click();
    });
    expect(onHideRail).toHaveBeenCalledOnce();
  });

  it("shows no Favorites section without favorites", async () => {
    await mount();
    expect(container.textContent).not.toContain("Favorites");
  });

  it("opens the account menu with the full name on the button", async () => {
    await mount();
    expect(container.textContent).toContain("Ada Lovelace");
    await act(async () => {
      q("button[aria-haspopup='menu']")!.click();
    });
    expect(q("[role='menu']")?.textContent).toContain("Settings");
    expect(q("[role='menu']")?.textContent).toContain("Log out");
  });
});
