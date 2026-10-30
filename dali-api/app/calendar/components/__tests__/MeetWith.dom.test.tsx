// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MeetWith } from "~/calendar/components/CalendarSidebar";
import type { GroupOption, UserOption } from "~/calendar/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onPick = vi.fn();
const onPickGroup = vi.fn();

const USERS: UserOption[] = [
  { id: "u1", firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@example.edu" },
  { id: "u2", firstName: "Grace", lastName: "Hopper", daliEmail: "grace@example.edu" },
];
const GROUPS: GroupOption[] = [
  { id: "g1", name: "26F PMs", memberIds: ["u1", "u2"], projectId: null, systemKey: null },
  { id: "g2", name: "Core", memberIds: ["u1"], projectId: null, systemKey: "core" },
];

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(MeetWith, { users: USERS, groups: GROUPS, onPick, onPickGroup }),
    ),
  );
}

const input = () => container.querySelector<HTMLInputElement>("input")!;

async function type(text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const rows = () =>
  Array.from(container.querySelectorAll("button")).map((b) => b.textContent?.trim());

beforeEach(() => {
  onPick.mockReset();
  onPickGroup.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("MeetWith", () => {
  it("shows nothing until a query is typed", async () => {
    await mount();
    expect(rows()).toEqual([]);
  });

  it("matches groups by name, custom groups included, ahead of people", async () => {
    await mount();
    await type("26f");
    expect(rows()).toEqual(["26F PMs2 members"]);
    await type("o");
    expect(rows()).toEqual(["Core1 member", "Ada Lovelace", "Grace Hopper"]);
  });

  it("picking a group reports it and clears the box", async () => {
    await mount();
    await type("26f");
    await act(async () => container.querySelector("button")!.click());
    expect(onPickGroup).toHaveBeenCalledWith("g1");
    expect(onPick).not.toHaveBeenCalled();
    expect(input().value).toBe("");
    expect(rows()).toEqual([]);
  });

  it("picking a person reports them and clears the box", async () => {
    await mount();
    await type("ada");
    await act(async () => container.querySelector("button")!.click());
    expect(onPick).toHaveBeenCalledWith("u1");
    expect(onPickGroup).not.toHaveBeenCalled();
    expect(input().value).toBe("");
  });
});
