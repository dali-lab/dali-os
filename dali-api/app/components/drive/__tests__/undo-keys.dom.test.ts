// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { undoKeyIntent } from "~/components/drive/undo-keys";

type Mods = Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>;

function key(k: string, mods: Mods = {}, target: EventTarget | null = document.body, extra: object = {}) {
  return { key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target, ...mods, ...extra };
}

function el(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild as HTMLElement;
}

describe("undoKeyIntent", () => {
  it("undoes on Cmd+Z and Ctrl+Z", () => {
    expect(undoKeyIntent(key("z", { metaKey: true }))).toBe("undo");
    expect(undoKeyIntent(key("z", { ctrlKey: true }))).toBe("undo");
    expect(undoKeyIntent(key("Z", { metaKey: true }))).toBe("undo");
  });

  it("redoes on Cmd+Shift+Z, Ctrl+Shift+Z and Ctrl+Y", () => {
    expect(undoKeyIntent(key("Z", { metaKey: true, shiftKey: true }))).toBe("redo");
    expect(undoKeyIntent(key("Z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(undoKeyIntent(key("y", { ctrlKey: true }))).toBe("redo");
  });

  it("ignores a bare Z, a bare Y, and other modified keys", () => {
    expect(undoKeyIntent(key("z"))).toBeNull();
    expect(undoKeyIntent(key("y"))).toBeNull();
    expect(undoKeyIntent(key("y", { metaKey: true }))).toBeNull();
    expect(undoKeyIntent(key("y", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(undoKeyIntent(key("a", { metaKey: true }))).toBeNull();
    expect(undoKeyIntent(key("z", { shiftKey: true }))).toBeNull();
  });

  it("ignores the chord with Alt held", () => {
    expect(undoKeyIntent(key("z", { metaKey: true, altKey: true }))).toBeNull();
  });

  it("ignores events another handler already took, and IME composition", () => {
    expect(undoKeyIntent(key("z", { metaKey: true }, document.body, { defaultPrevented: true }))).toBeNull();
    expect(undoKeyIntent(key("z", { metaKey: true }, document.body, { isComposing: true }))).toBeNull();
  });

  it("ignores a dialog being open", () => {
    expect(undoKeyIntent(key("z", { metaKey: true }), { dialogOpen: true })).toBeNull();
    expect(undoKeyIntent(key("z", { metaKey: true }), { dialogOpen: false })).toBe("undo");
  });

  it.each([
    ["an input", '<input type="text" />'],
    ["a textarea", "<textarea></textarea>"],
    ["a select", "<select><option>a</option></select>"],
    ["a contenteditable element", '<div contenteditable="true"></div>'],
    ["a bare contenteditable attribute", "<div contenteditable></div>"],
    ["a BlockNote editor", '<div class="bn-editor"></div>'],
    ["a ProseMirror editor", '<div class="ProseMirror"></div>'],
  ])("ignores %s", (_name, html) => {
    const target = el(html);
    expect(undoKeyIntent(key("z", { metaKey: true }, target))).toBeNull();
    expect(undoKeyIntent(key("z", { metaKey: true, shiftKey: true }, target))).toBeNull();
    expect(undoKeyIntent(key("y", { ctrlKey: true }, target))).toBeNull();
  });

  it("ignores a target nested inside an editor", () => {
    const outer = el('<div class="bn-editor"><p><span id="inner">text</span></p></div>');
    const inner = outer.querySelector("#inner")!;
    expect(undoKeyIntent(key("z", { metaKey: true }, inner))).toBeNull();
  });

  it("handles an element that opted out of contenteditable", () => {
    const target = el('<div contenteditable="false"></div>');
    expect(undoKeyIntent(key("z", { metaKey: true }, target))).toBe("undo");
  });

  it("acts when focus is on a button, a row or the body", () => {
    expect(undoKeyIntent(key("z", { metaKey: true }, el("<button>Row</button>")))).toBe("undo");
    expect(undoKeyIntent(key("z", { metaKey: true }, el('<div role="row" tabindex="0"></div>')))).toBe("undo");
    expect(undoKeyIntent(key("z", { metaKey: true }, null))).toBe("undo");
  });
});
