// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { Rail, type RailProps } from "~/components/shell/Rail";
import { ToastProvider } from "~/components/ui/toast";
import { Settings } from "lucide-react";

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

  it("hides Email for alumni", async () => {
    await mount({ isAlumni: true });
    expect(q("button[aria-label='Email']")).toBeNull();
    expect(q("button[aria-label='Drive']")).not.toBeNull();
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
