// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/ui/floating", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));

import { FileViewer, type ViewerFile } from "./FileViewer";

let container: HTMLDivElement;
let root: Root;

const files: ViewerFile[] = [
  { id: "a", title: "Card slip", kind: "image", src: "https://s3.example/a", href: "/files/a" },
  { id: "b", title: "Invoice", kind: "pdf", src: "/files/b", href: "/files/b" },
];

function mount(props: Partial<Parameters<typeof FileViewer>[0]> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const all = { files, index: 0, onIndexChange: vi.fn(), open: true, onClose: vi.fn(), ...props };
  act(() => root.render(createElement(FileViewer, all)));
  return all;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const button = (label: string) => document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const img = () => document.body.querySelector<HTMLImageElement>("img")!;
const stage = () => document.body.querySelector<HTMLDivElement>('[data-testid="file-viewer-stage"]')!;
const percent = () => document.body.querySelector('[aria-live="polite"]')!.textContent;
const key = (k: string, over: KeyboardEventInit = {}) => act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: k, ...over })));

describe("FileViewer", () => {
  it("renders nothing while closed", () => {
    mount({ open: false });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens an image at fit with a link to the original", () => {
    mount();
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Card slip");
    expect(img().getAttribute("src")).toBe("https://s3.example/a");
    expect(img().style.transform).toBe("translate(0px, 0px) scale(1)");
    expect(percent()).toBe("100%");
    expect(document.body.querySelector('a[aria-label="Open in a new tab"]')?.getAttribute("href")).toBe("/files/a");
    expect(button("Zoom out")?.disabled).toBe(true);
    expect(button("Fit")?.disabled).toBe(true);
  });

  it("zooms with the buttons and returns to fit", () => {
    mount();
    act(() => button("Zoom in")!.click());
    expect(percent()).toBe("150%");
    expect(img().style.transform).toContain("scale(1.5)");
    act(() => button("Zoom in")!.click());
    act(() => button("Zoom out")!.click());
    expect(percent()).toBe("150%");
    act(() => button("Fit")!.click());
    expect(percent()).toBe("100%");
  });

  it("stops zooming in at the maximum", () => {
    mount();
    for (let i = 0; i < 10; i++) act(() => button("Zoom in")!.click());
    expect(percent()).toBe("800%");
    expect(button("Zoom in")?.disabled).toBe(true);
  });

  it("zooms with the keyboard", () => {
    mount();
    key("+");
    expect(percent()).toBe("150%");
    key("=");
    expect(percent()).toBe("225%");
    key("-");
    expect(percent()).toBe("150%");
    key("0");
    expect(percent()).toBe("100%");
  });

  it("leaves browser shortcuts alone", () => {
    mount();
    key("+", { metaKey: true });
    expect(percent()).toBe("100%");
  });

  it("zooms on a pinch and pans on scroll once zoomed", () => {
    mount();
    act(() => void stage().dispatchEvent(new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, cancelable: true })));
    expect(Number(percent()!.replace("%", ""))).toBeGreaterThan(100);
    const before = img().style.transform;
    act(() => void stage().dispatchEvent(new WheelEvent("wheel", { deltaX: 0, deltaY: 30, cancelable: true })));
    expect(img().style.transform).not.toBe(before);
    expect(img().style.transform).toContain("-30px");
  });

  it("blocks the page from scrolling or zooming under the viewer", () => {
    mount();
    const e = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, cancelable: true });
    act(() => void stage().dispatchEvent(e));
    expect(e.defaultPrevented).toBe(true);
  });

  it("toggles 2x on double-click", () => {
    mount();
    act(() => void stage().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(percent()).toBe("200%");
    act(() => void stage().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(percent()).toBe("100%");
  });

  it("moves between files with buttons and arrow keys", () => {
    const props = mount();
    expect(document.body.textContent).toContain("1 of 2");
    expect(button("Previous")?.disabled).toBe(true);
    act(() => button("Next")!.click());
    expect(props.onIndexChange).toHaveBeenCalledWith(1);
    key("ArrowRight");
    expect(props.onIndexChange).toHaveBeenCalledTimes(2);
    key("ArrowLeft");
    expect(props.onIndexChange).toHaveBeenCalledTimes(2);
  });

  it("starts the next file at fit", () => {
    const props = mount();
    act(() => button("Zoom in")!.click());
    act(() => root.render(createElement(FileViewer, { ...props, files: [files[0], { ...files[0], id: "c" }], index: 1 })));
    expect(percent()).toBe("100%");
  });

  it("shows a PDF in a frame without zoom controls", () => {
    mount({ index: 1 });
    expect(document.body.querySelector("iframe")?.getAttribute("src")).toBe("/files/b");
    expect(button("Zoom in")).toBeNull();
    key("+");
    expect(document.body.querySelector('[aria-live="polite"]')).toBeNull();
  });

  it("says so when there is no preview", () => {
    mount({ files: [{ id: "x", title: "Card slip", kind: "image", src: null }] });
    expect(document.body.textContent).toContain("Preview isn't available right now.");
    expect(button("Zoom in")).toBeNull();
  });

  it("closes from the header", () => {
    const props = mount();
    act(() => button("Close")!.click());
    expect(props.onClose).toHaveBeenCalled();
  });
});
