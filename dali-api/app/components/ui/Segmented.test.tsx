// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Segmented } from "./Segmented";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function mount(value: "a" | "b", onChange = vi.fn(), fullWidth?: boolean, size?: "sm" | "md") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(Segmented<"a" | "b">, {
        value,
        onChange,
        ariaLabel: "Pick one",
        fullWidth,
        size,
        options: [
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ],
      }),
    ),
  );
  return onChange;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const radios = () => Array.from(container.querySelectorAll<HTMLButtonElement>("[role='radio']"));

describe("Segmented", () => {
  it("is a named radiogroup with one radio per option", () => {
    mount("a");
    expect(container.querySelector("[role='radiogroup']")?.getAttribute("aria-label")).toBe("Pick one");
    expect(radios().map((r) => r.textContent)).toEqual(["Alpha", "Beta"]);
  });

  it("marks only the current value as checked", () => {
    mount("b");
    expect(radios().map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  });

  it("reports the clicked option", () => {
    const onChange = mount("a");
    act(() => radios()[1]!.click());
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("does not submit a surrounding form", () => {
    mount("a");
    expect(radios().every((r) => r.type === "button")).toBe(true);
  });

  it("sizes to its content by default", () => {
    mount("a");
    expect(container.querySelector("[role='radiogroup']")!.className).toContain("inline-flex");
    expect(radios().some((r) => r.className.includes("flex-1"))).toBe(false);
  });

  it("splits the full width evenly when fullWidth is set", () => {
    mount("a", vi.fn(), true);
    const group = container.querySelector("[role='radiogroup']")!;
    expect(group.className).toContain("w-full");
    expect(group.className).not.toContain("inline-flex");
    expect(radios().every((r) => r.className.includes("flex-1"))).toBe(true);
    expect(radios().every((r) => r.className.includes("px-1.5") && r.className.includes("whitespace-nowrap"))).toBe(true);
  });

  it("uses the small size by default and a larger one for md", () => {
    mount("a");
    expect(radios()[0]!.className).toContain("text-xs");
    act(() => root.unmount());
    container.remove();
    mount("a", vi.fn(), false, "md");
    expect(radios().every((r) => r.className.includes("text-sm") && r.className.includes("py-2"))).toBe(true);
  });
});
