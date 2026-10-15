// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { DriveUploadInput } from "../DriveUploadInput";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(onChange = vi.fn(), testId?: string) {
  const inputRef = createRef<HTMLInputElement>();
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(createElement(DriveUploadInput, { inputRef, onChange, testId }));
  });
  return { input: container.querySelector("input")!, inputRef, onChange };
}

describe("DriveUploadInput", () => {
  it("is a multiple file input so several files can be picked at once", () => {
    const { input } = mount();
    expect(input.type).toBe("file");
    expect(input.multiple).toBe(true);
  });

  it("stays out of the tab order and the accessibility tree", () => {
    const { input } = mount();
    expect(input.getAttribute("aria-hidden")).toBe("true");
    expect(input.tabIndex).toBe(-1);
  });

  it("hands its element to the ref and reports changes", () => {
    const { input, inputRef, onChange } = mount();
    expect(inputRef.current).toBe(input);
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("carries the test id it is given", () => {
    expect(mount(vi.fn(), "drive-upload-input-lab").input.getAttribute("data-testid")).toBe("drive-upload-input-lab");
  });
});
