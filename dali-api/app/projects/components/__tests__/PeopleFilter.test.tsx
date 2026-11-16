// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PeopleFilter } from "../PeopleFilter";
import { SEARCH_THRESHOLD } from "~/components/ui/floating/search";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
function mount(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(ui));
}
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `u${i}`, name: `Ada ${i}` }));
const trigger = () => container.querySelector<HTMLElement>("[aria-haspopup='listbox']")!;

describe("PeopleFilter", () => {
  it.each([
    ["a short list, where the trigger is a combobox", 3],
    ["a searchable list", SEARCH_THRESHOLD + 1],
  ])("names its trigger for %s", (_label, count) => {
    mount(createElement(PeopleFilter, { options: people(count), selected: [], onChange: () => {}, ariaLabel: "Assignees" }));
    expect(trigger().getAttribute("aria-label")).toBe("Assignees");
    expect(trigger().textContent).toContain("All people");
  });

  it("falls back to a generic name", () => {
    mount(createElement(PeopleFilter, { options: people(3), selected: [], onChange: () => {} }));
    expect(trigger().getAttribute("aria-label")).toBe("People");
  });
});
