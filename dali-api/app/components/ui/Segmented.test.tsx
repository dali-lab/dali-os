// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Segmented } from "./Segmented";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function mount(value: "a" | "b", onChange = vi.fn()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(Segmented<"a" | "b">, {
        value,
        onChange,
        ariaLabel: "Pick one",
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
});
