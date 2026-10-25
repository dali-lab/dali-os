import { describe, expect, it } from "vitest";
import { applyEditorKey, type TextEdit } from "../code-keys";

/** Builds state from text where "|" marks the caret or "[" "]" the selection. */
function at(text: string): TextEdit {
  const i = text.indexOf("|");
  if (i >= 0) {
    return { value: text.slice(0, i) + text.slice(i + 1), selectionStart: i, selectionEnd: i };
  }
  const s = text.indexOf("[");
  const e = text.indexOf("]");
  return {
    value: text.slice(0, s) + text.slice(s + 1, e) + text.slice(e + 1),
    selectionStart: s,
    selectionEnd: e - 1,
  };
}
const show = (t: TextEdit | null) =>
  t && t.selectionStart === t.selectionEnd
    ? t.value.slice(0, t.selectionStart) + "|" + t.value.slice(t.selectionStart)
    : t && t.value.slice(0, t.selectionStart) + "[" + t.value.slice(t.selectionStart, t.selectionEnd) + "]" + t.value.slice(t.selectionEnd);

const tab = { key: "Tab", shiftKey: false };
const shiftTab = { key: "Tab", shiftKey: true };
const enter = { key: "Enter", shiftKey: false };

describe("applyEditorKey", () => {
  it("leaves other keys to the textarea", () => {
    expect(applyEditorKey(at("a|b"), { key: "a", shiftKey: false })).toBeNull();
    expect(applyEditorKey(at("a|b"), { key: "Enter", shiftKey: true })).toBeNull();
  });

  it("inserts two spaces on Tab, replacing a single-line selection", () => {
    expect(show(applyEditorKey(at("ab|c"), tab))).toBe("ab  |c");
    expect(show(applyEditorKey(at("a[bc]d"), tab))).toBe("a  |d");
  });

  it("indents every line of a multi-line selection", () => {
    expect(show(applyEditorKey(at("x\na[b\nc]d\ny"), tab))).toBe("x\n  a[b\n  c]d\ny");
  });

  it("doesn't indent the line after a selection that ends at a newline", () => {
    expect(show(applyEditorKey(at("[a\n]b"), tab))).toBe("  [a\n]b");
  });

  it("outdents the current line on Shift+Tab, by up to two spaces or one tab", () => {
    expect(show(applyEditorKey(at("    ab|c"), shiftTab))).toBe("  ab|c");
    expect(show(applyEditorKey(at(" ab|c"), shiftTab))).toBe("ab|c");
    expect(show(applyEditorKey(at("\tab|c"), shiftTab))).toBe("ab|c");
    expect(show(applyEditorKey(at("ab|c"), shiftTab))).toBe("ab|c");
  });

  it("keeps the caret on its line when outdenting from inside the indent", () => {
    expect(show(applyEditorKey(at(" |  a"), shiftTab))).toBe("| a");
  });

  it("outdents every selected line", () => {
    expect(show(applyEditorKey(at("  [a\n    b]"), shiftTab))).toBe("[a\n  b]");
  });

  it("carries the current line's indentation onto a new line", () => {
    expect(show(applyEditorKey(at("  if (x) {|"), enter))).toBe("  if (x) {\n  |");
    expect(show(applyEditorKey(at("a\n\t  b|c"), enter))).toBe("a\n\t  b\n\t  |c");
    expect(show(applyEditorKey(at("  a[bc]d"), enter))).toBe("  a\n  |d");
    expect(show(applyEditorKey(at("|x"), enter))).toBe("\n|x");
  });
});
