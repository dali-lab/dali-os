// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PageTitleHeader } from "~/components/doc-chrome/PageTitleHeader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

type Props = Parameters<typeof PageTitleHeader>[0];

async function mount(props: Partial<Props> = {}) {
  const all: Props = { title: "Roadmap", iconEmoji: null, canEdit: true, onRename: vi.fn(), onIconChange: vi.fn(), ...props };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(PageTitleHeader, all)));
  return all;
}

const input = () => container.querySelector<HTMLInputElement>("input[aria-label='Title']")!;
const buttons = () => [...document.body.querySelectorAll("button")];
const type = async (value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const key = (k: string) =>
  act(async () => {
    input().focus();
    input().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
const blur = () => act(async () => void input().dispatchEvent(new FocusEvent("focusout", { bubbles: true })));

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("PageTitleHeader title", () => {
  it("renames with the trimmed name on Enter", async () => {
    const props = await mount();
    await type("  Q3 roadmap  ");
    await key("Enter");
    expect(props.onRename).toHaveBeenCalledWith("Q3 roadmap");
  });

  it("renames on blur", async () => {
    const props = await mount();
    await type("Q3 roadmap");
    await blur();
    expect(props.onRename).toHaveBeenCalledWith("Q3 roadmap");
  });

  it("restores the title without saving on Escape", async () => {
    const props = await mount();
    await type("Q3 roadmap");
    await key("Escape");
    expect(props.onRename).not.toHaveBeenCalled();
    expect(input().value).toBe("Roadmap");
  });

  it("does not save a blank or unchanged name", async () => {
    const props = await mount();
    await type("   ");
    await blur();
    expect(input().value).toBe("Roadmap");
    await type("Roadmap");
    await blur();
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it("shows a plain heading for a viewer who cannot edit", async () => {
    await mount({ canEdit: false, title: "" });
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("h1")!.textContent).toBe("Untitled");
  });
});

describe("PageTitleHeader icon", () => {
  it("adds an icon from the Add icon picker", async () => {
    const props = await mount();
    await act(async () => buttons().find((b) => b.textContent === "Add icon")!.click());
    await act(async () => buttons().find((b) => b.textContent === "🚀")!.click());
    expect(props.onIconChange).toHaveBeenCalledWith("🚀");
    expect(buttons().some((b) => b.textContent === "Add icon")).toBe(false);
    expect(buttons().some((b) => b.textContent === "🚀")).toBe(true);
  });

  it("removes a set icon", async () => {
    const props = await mount({ iconEmoji: "📋" });
    await act(async () => buttons().find((b) => b.textContent === "📋")!.click());
    await act(async () => buttons().find((b) => b.textContent === "Remove")!.click());
    expect(props.onIconChange).toHaveBeenCalledWith(null);
  });

  it("shows a set icon without a picker, and no Add icon, for a viewer", async () => {
    await mount({ canEdit: false, iconEmoji: "📋" });
    expect(container.textContent).toContain("📋");
    expect(container.querySelector("button")).toBeNull();
  });
});
