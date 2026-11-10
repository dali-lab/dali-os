// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InstructorPicker } from "../InstructorPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const candidates = [
  { id: "u1", name: "Ada Lovelace" },
  { id: "u2", name: "Grace Hopper" },
];

function mount(initialSelectedIds: string[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(InstructorPicker, { candidates, initialSelectedIds })));
}

function posted(): string[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>("input[name='userIds']")).map((i) => i.value);
}

describe("InstructorPicker", () => {
  it("posts the current instructors as userIds", () => {
    mount(["u2"]);
    expect(posted()).toEqual(["u2"]);
  });

  it("posts nothing when there are no instructors, which clears the list", () => {
    mount([]);
    expect(posted()).toEqual([]);
  });

  it("searches even a short roster and adds the picked member", () => {
    mount([]);
    const trigger = container.querySelector<HTMLButtonElement>("button[aria-haspopup]")!;
    act(() => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(document.querySelector("input[type='search']")).not.toBeNull();
    const ada = Array.from(document.querySelectorAll<HTMLButtonElement>("button[role='option']")).find((b) =>
      b.textContent?.includes("Ada Lovelace"),
    )!;
    act(() => ada.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(posted()).toEqual(["u1"]);
  });

  it("removes an instructor from its chip", () => {
    mount(["u1", "u2"]);
    const remove = container.querySelector<HTMLButtonElement>("button[aria-label='Remove Ada Lovelace']")!;
    act(() => remove.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(posted()).toEqual(["u2"]);
  });
});
