// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { inEditable } from "../gesture";

describe("inEditable", () => {
  it("is true inside inputs, textareas, selects and contenteditable", () => {
    for (const html of ["<input>", "<textarea></textarea>", "<select></select>", "<div contenteditable='true'><span></span></div>"]) {
      const host = document.createElement("div");
      host.innerHTML = html;
      expect(inEditable(host.firstElementChild!.querySelector("span") ?? host.firstElementChild)).toBe(true);
    }
  });

  it("is false elsewhere and for null", () => {
    expect(inEditable(document.createElement("button"))).toBe(false);
    expect(inEditable(null)).toBe(false);
  });
});
