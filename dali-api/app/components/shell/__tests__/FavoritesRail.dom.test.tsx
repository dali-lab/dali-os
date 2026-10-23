// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { FavoritesBar } from "~/components/FavoritesBar";
import { ToastProvider } from "~/components/ui/toast";
import type { FavoritePage } from "~/lib/user-pages.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const page = (n: number): FavoritePage =>
  ({ id: `p${n}`, title: `Page ${n}`, href: `/documents/p${n}`, iconKind: "page", isRoute: false }) as unknown as FavoritePage;

async function mount(count: number, activeHref?: string, orientation: "vertical" | "horizontal" = "vertical") {
  const favorites = Array.from({ length: count }, (_, i) => page(i + 1));
  const Stub = createRoutesStub([
    {
      path: "*",
      Component: () =>
        createElement(
          ToastProvider,
          null,
          createElement(FavoritesBar, {
            favorites,
            onChange: vi.fn(),
            tabClickProps: () => ({ onClick: vi.fn() }),
            orientation,
            activeHref,
          }),
        ),
    },
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

const rows = () =>
  Array.from(container.querySelectorAll("button")).filter((b) => b.textContent?.startsWith("Page"));
const toggle = () =>
  Array.from(container.querySelectorAll("button")).find((b) => /View all|Show less/.test(b.textContent ?? ""));

describe("FavoritesBar vertical", () => {
  it("shows a Favorites header and the first three rows", async () => {
    await mount(5);
    expect(container.textContent).toContain("Favorites");
    expect(rows().map((r) => r.textContent)).toEqual(["Page 1", "Page 2", "Page 3"]);
    expect(toggle()?.textContent).toBe("View all");
  });

  it("expands inline and collapses again", async () => {
    await mount(5);
    await act(async () => {
      toggle()!.click();
    });
    expect(rows()).toHaveLength(5);
    expect(toggle()?.textContent).toBe("Show less");
    await act(async () => {
      toggle()!.click();
    });
    expect(rows()).toHaveLength(3);
  });

  it("has no View all row at or under three favorites", async () => {
    await mount(3);
    expect(rows()).toHaveLength(3);
    expect(toggle()).toBeUndefined();
  });

  it("marks the current page's row", async () => {
    await mount(2, "/documents/p2");
    const [first, second] = rows();
    expect(first!.getAttribute("aria-current")).toBeNull();
    expect(second!.getAttribute("aria-current")).toBe("page");
    expect(second!.className).toContain("font-semibold");
    expect(second!.className).toContain("bg-os-hover-strong");
  });
});

describe("FavoritesBar horizontal", () => {
  it("keeps the pill row with no header or overflow control", async () => {
    await mount(5, undefined, "horizontal");
    expect(container.textContent).not.toContain("Favorites");
    expect(rows()).toHaveLength(5);
    expect(rows()[0]!.className).toContain("rounded-full");
    expect(toggle()).toBeUndefined();
  });
});
