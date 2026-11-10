// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { PageBarTrail } from "~/components/Breadcrumbs";
import { PageBarSlotProvider, PageBarTitle, PageBarVisibility } from "~/components/shell/page-bar-slot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const crumbs = [
  { label: "Drive", to: "/drive" },
  { label: "My form", icon: createElement("span", { "data-testid": "glyph" }, "G") },
];

async function mount(page: ReturnType<typeof createElement> | null, hidden = false) {
  const Stub = createRoutesStub([
    {
      path: "*",
      Component: () =>
        createElement(PageBarSlotProvider, {
          children: createElement(
            "div",
            null,
            createElement(PageBarTrail, { crumbs }),
            createElement(PageBarVisibility, { hidden, children: page }),
          ),
        }),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/x"] }));
  });
}

const input = () => container.querySelector<HTMLInputElement>("input[aria-label='Page name']");
const crumbButton = () => container.querySelector<HTMLElement>("button[aria-label='Rename']");
const type = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const key = (el: HTMLElement, k: string) => act(async () => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("page bar title crumb", () => {
  it("is static without a registered rename handler", async () => {
    await mount(createElement(PageBarTitle, { title: "My form" }));
    expect(crumbButton()).toBeNull();
    expect(container.textContent).toContain("My form");
  });

  it("is static when no page registers a title", async () => {
    await mount(null);
    expect(crumbButton()).toBeNull();
  });

  it("is static for a hidden, kept-alive page", async () => {
    await mount(createElement(PageBarTitle, { title: "My form", onRename: () => {} }), true);
    expect(crumbButton()).toBeNull();
  });

  it("turns into an input on click and saves with Enter through the page's handler", async () => {
    const onRename = vi.fn();
    await mount(createElement(PageBarTitle, { title: "My form", onRename }));
    await act(async () => crumbButton()!.click());
    expect(input()!.value).toBe("My form");
    await type(input()!, "Renamed");
    await key(input()!, "Enter");
    expect(onRename).toHaveBeenCalledWith("Renamed");
    expect(input()).toBeNull();
  });

  it("cancels with Escape", async () => {
    const onRename = vi.fn();
    await mount(createElement(PageBarTitle, { title: "My form", onRename }));
    await act(async () => crumbButton()!.click());
    await type(input()!, "Nope");
    await key(input()!, "Escape");
    expect(onRename).not.toHaveBeenCalled();
    expect(container.textContent).toContain("My form");
  });

  it("reverts an empty name without saving", async () => {
    const onRename = vi.fn();
    await mount(createElement(PageBarTitle, { title: "My form", onRename }));
    await act(async () => crumbButton()!.click());
    await type(input()!, "   ");
    await key(input()!, "Enter");
    expect(onRename).not.toHaveBeenCalled();
    expect(crumbButton()!.textContent).toBe("My form");
  });

  it("saves on blur", async () => {
    const onRename = vi.fn();
    await mount(createElement(PageBarTitle, { title: "My form", onRename }));
    await act(async () => crumbButton()!.click());
    await type(input()!, "Blurred");
    await act(async () => input()!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(onRename).toHaveBeenCalledWith("Blurred");
  });

  it("falls back to the route crumb label for an untitled page", async () => {
    await mount(createElement(PageBarTitle, { title: "", onRename: () => {} }));
    expect(crumbButton()!.textContent).toBe("My form");
  });
});

describe("page bar icon", () => {
  it("shows the emoji as plain text even when the page can be renamed", async () => {
    await mount(createElement(PageBarTitle, { title: "My form", onRename: () => {}, emoji: "📋" }));
    expect(container.textContent).toContain("📋");
    expect(container.querySelector("[data-testid=glyph]")).toBeNull();
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "📋")).toBe(false);
  });

  it("keeps the type glyph as plain text when no emoji is set", async () => {
    await mount(createElement(PageBarTitle, { title: "My form", onRename: () => {}, emoji: null }));
    const glyph = container.querySelector("[data-testid=glyph]")!;
    expect(glyph.closest("button")).toBeNull();
  });
});
