// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useBackspaceNavigationGuard } from "../useBackspaceNavigationGuard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Guard() {
  useBackspaceNavigationGuard();
  return null;
}

let container: HTMLDivElement;
let root: Root;

function press(target: Element, init: KeyboardEventInit = { key: "Backspace" }): boolean {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function element(html: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host.firstElementChild!;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(Guard)));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("useBackspaceNavigationGuard", () => {
  it("cancels Backspace with focus on the page", () => {
    expect(press(document.body)).toBe(true);
  });

  it.each([
    ["button", "<button>Save</button>"],
    ["div", "<div>Text</div>"],
    ["non-editable contenteditable", '<div contenteditable="false">Text</div>'],
  ])("cancels Backspace on a %s", (_label, html) => {
    expect(press(element(html))).toBe(true);
  });

  it("cancels Shift+Backspace, the forward variant", () => {
    expect(press(document.body, { key: "Backspace", shiftKey: true })).toBe(true);
  });

  it.each([
    ["input", "<input />"],
    ["textarea", "<textarea></textarea>"],
    ["select", "<select></select>"],
    ["contenteditable", '<div contenteditable="true">Text</div>'],
    ["doc title", '<h1 contenteditable>Title</h1>'],
    ["editor block", '<div class="bn-editor"><p>Text</p></div>'],
  ])("leaves Backspace alone in a %s", (_label, html) => {
    expect(press(element(html))).toBe(false);
  });

  it("leaves Backspace alone inside an editor", () => {
    const editor = element('<div class="ProseMirror" contenteditable="true"><p>Text</p></div>');

    expect(press(editor.querySelector("p")!)).toBe(false);
  });

  it("leaves other keys alone", () => {
    expect(press(document.body, { key: "Delete" })).toBe(false);
    expect(press(document.body, { key: "a" })).toBe(false);
  });

  it("stops cancelling after unmount", () => {
    act(() => root.unmount());
    root = createRoot(container);

    expect(press(document.body)).toBe(false);
  });
});
