// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DropZone } from "../DropZone";
import { ReadingCard } from "../ExpensesPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("~/components/Modal", () => ({ Modal: () => null }));

let container: HTMLDivElement;
let root: Root;
const mount = (node: React.ReactNode) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(node));
};
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const drop = (files: File[]) => {
  const zone = container.querySelector('[data-testid="receipt-dropzone"]')!;
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files } });
  act(() => void zone.dispatchEvent(event));
};

describe("DropZone", () => {
  it("states what it takes", () => {
    mount(createElement(DropZone, { onFiles: vi.fn(), onNoReceipt: vi.fn() }));
    expect(container.textContent).toContain("Drop receipts here");
    expect(container.textContent).toContain("Several at once become one expense.");
  });

  it("hands every dropped file over together", () => {
    const onFiles = vi.fn();
    mount(createElement(DropZone, { onFiles, onNoReceipt: vi.fn() }));
    const files = [new File(["a"], "a.jpg"), new File(["b"], "b.pdf")];
    drop(files);
    expect(onFiles).toHaveBeenCalledWith(files);
  });

  it("ignores a drop while busy", () => {
    const onFiles = vi.fn();
    mount(createElement(DropZone, { onFiles, onNoReceipt: vi.fn(), disabled: true }));
    drop([new File(["a"], "a.jpg")]);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("opens the no-receipt flow", () => {
    const onNoReceipt = vi.fn();
    mount(createElement(DropZone, { onFiles: vi.fn(), onNoReceipt }));
    const link = [...container.querySelectorAll("button")].find((b) => b.textContent === "No receipt?")!;
    act(() => link.click());
    expect(onNoReceipt).toHaveBeenCalled();
  });

  it("shows an upload error", () => {
    mount(createElement(DropZone, { onFiles: vi.fn(), onNoReceipt: vi.fn(), error: "Save it as a JPEG." }));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Save it as a JPEG.");
  });
});

describe("ReadingCard", () => {
  it("counts the receipts being read", () => {
    mount(createElement(ReadingCard, { count: 3 }));
    expect(container.textContent).toContain("Reading 3 receipts");
  });
  it("uses the singular for one", () => {
    mount(createElement(ReadingCard, { count: 1 }));
    expect(container.textContent).toContain("Reading 1 receipt");
  });
});
