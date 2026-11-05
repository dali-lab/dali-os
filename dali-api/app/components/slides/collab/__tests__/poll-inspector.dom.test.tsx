// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RenderElement } from "~/components/slides/deck/snapshot";

const flags = vi.hoisted(() => ({ live: true }));
vi.mock("~/components/FeatureFlags", () => ({ useFeatureFlag: (key: string) => (key === "slides-live" ? flags.live : false) }));

import { PollSection } from "../ContentInspector";
import { InsertMenu } from "../InsertMenu";
import { thumbnailActions } from "../actions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  flags.live = true;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const render = (node: React.ReactElement) => act(() => root.render(node));
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
const byLabel = (label: string) => container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
const setValue = (input: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const commit = (input: HTMLInputElement, value: string) => {
  setValue(input, value);
  act(() => void input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
};

const element = (poll: unknown) => ({ id: "poll1", kind: "poll", slot: null, z: 1, blocks: [], src: null, alt: null, textStyle: null, poll }) as unknown as RenderElement;
const POLL = { question: "Ship it?", options: ["Yes", "No"] };

describe("poll inspector", () => {
  it("edits the question", () => {
    const onChange = vi.fn();
    render(createElement(PollSection, { element: element(POLL), editable: true, onChange }));
    commit(byLabel("Poll question"), "Ready?");
    expect(onChange).toHaveBeenCalledWith({ ...POLL, question: "Ready?" });
  });

  it("edits an option and ignores an emptied one", () => {
    const onChange = vi.fn();
    render(createElement(PollSection, { element: element(POLL), editable: true, onChange }));
    commit(byLabel("Option 2"), "Not yet");
    expect(onChange).toHaveBeenCalledWith({ ...POLL, options: ["Yes", "Not yet"] });
    onChange.mockClear();
    commit(byLabel("Option 1"), "  ");
    expect(onChange).not.toHaveBeenCalled();
    expect(byLabel("Option 1").value).toBe("Yes");
  });

  it("adds options up to six and removes down to two", () => {
    const onChange = vi.fn();
    render(createElement(PollSection, { element: element(POLL), editable: true, onChange }));
    expect(container.querySelector("[aria-label='Remove option 1']")).toBeNull();
    click([...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Option")));
    expect(onChange).toHaveBeenCalledWith({ ...POLL, options: ["Yes", "No", "Option 3"] });
    const six = { question: "q", options: ["a", "b", "c", "d", "e", "f"] };
    render(createElement(PollSection, { element: element(six), editable: true, onChange }));
    expect([...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Option"))!.hasAttribute("disabled")).toBe(true);
    click(container.querySelector("[aria-label='Remove option 3']"));
    expect(onChange).toHaveBeenLastCalledWith({ question: "q", options: ["a", "b", "d", "e", "f"] });
  });

  it("allows several answers through the switch, and drops the flag when off", () => {
    const onChange = vi.fn();
    render(createElement(PollSection, { element: element(POLL), editable: true, onChange }));
    click(container.querySelector("input[role=switch]"));
    expect(onChange).toHaveBeenCalledWith({ ...POLL, multi: true });
    render(createElement(PollSection, { element: element({ ...POLL, multi: true }), editable: true, onChange }));
    click(container.querySelector("input[role=switch]"));
    expect(onChange).toHaveBeenLastCalledWith(POLL);
  });

  it("is read-only for someone who cannot edit", () => {
    render(createElement(PollSection, { element: element(POLL), editable: false, onChange: vi.fn() }));
    expect(byLabel("Poll question").disabled).toBe(true);
    expect(container.querySelector("[aria-label='Remove option 1']")).toBeNull();
    expect([...container.querySelectorAll("button")]).toHaveLength(0);
  });
});

describe("Insert menu", () => {
  const open = () => {
    render(createElement(InsertMenu, { armed: false, onInsert: vi.fn() }));
    click(container.querySelector("button"));
    return [...document.querySelectorAll("[role=menuitem]")].map((i) => i.textContent);
  };

  it("offers Poll when slides-live is on", () => {
    expect(open()).toContain("Poll");
  });

  it("leaves Poll out when slides-live is off", () => {
    flags.live = false;
    expect(open()).not.toContain("Poll");
  });
});

describe("thumbnail menu", () => {
  const ctx = (saveToLibrary?: () => void) => ({
    targets: [{ id: "a", pos: 1, layoutId: "content", elements: [] }, { id: "b", pos: 2, layoutId: "content", elements: [] }] as never,
    index: 0,
    count: 2,
    canPaste: false,
    canComment: false,
    handlers: { newAfter: vi.fn(), duplicate: vi.fn(), remove: vi.fn(), skip: vi.fn(), changeLayout: vi.fn(), copy: vi.fn(), paste: vi.fn(), moveTo: vi.fn(), comment: vi.fn(), saveToLibrary } as never,
  });

  it("offers Save slides to library for the acting slides when the editor can", () => {
    const save = vi.fn();
    const item = thumbnailActions(ctx(save)).find((a) => a.id === "save-library")!;
    expect(item.label).toBe("Save slides to library");
    item.run!();
    expect(save).toHaveBeenCalled();
  });

  it("leaves it out otherwise", () => {
    expect(thumbnailActions(ctx()).some((a) => a.id === "save-library")).toBe(false);
  });
});
