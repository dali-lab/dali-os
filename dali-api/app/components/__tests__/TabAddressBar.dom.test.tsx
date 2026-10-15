// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/ui/floating", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));

const { TabAddressBar } = await import("~/components/TabAddressBar");

let container: HTMLDivElement;
let root: Root;

function mount(path: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(TabAddressBar, { path })));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("TabAddressBar", () => {
  it("shows the tab's full url", () => {
    mount("/documents/abc?tab=notes");
    const input = container.querySelector("input")!;
    expect(input.value).toBe(`${window.location.origin}/documents/abc?tab=notes`);
    expect(input.readOnly).toBe(true);
  });

  it("copies the url and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    mount("/hiring");
    await act(async () => {
      container.querySelector("button")!.click();
    });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/hiring`);
    expect(container.querySelector("button")!.getAttribute("aria-label")).toBe("Copied");
  });
});
