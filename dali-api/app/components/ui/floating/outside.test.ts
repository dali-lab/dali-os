// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { isInFloatingLayer } from "./outside";

afterEach(() => {
  document.body.innerHTML = "";
});

function layer(attrs: string) {
  document.body.innerHTML = `<div ${attrs}><button id="inner">pick</button></div>`;
  return document.getElementById("inner")!;
}

describe("isInFloatingLayer", () => {
  // Every host card that dismisses on an outside click asks this. A layer it
  // fails to recognise is a card that tears itself down the moment the user
  // reaches for its own dropdown.
  it("claims a floating-ui portal (Select / Menu / Combobox / Popover)", () => {
    expect(isInFloatingLayer(layer("data-floating-ui-portal"))).toBe(true);
  });

  it("claims a DateField / TimeField picker", () => {
    expect(isInFloatingLayer(layer("data-field-popover"))).toBe(true);
  });

  it("claims a calendar card and a dialog", () => {
    expect(isInFloatingLayer(layer("data-calendar-popover"))).toBe(true);
    expect(isInFloatingLayer(layer('role="dialog"'))).toBe(true);
  });

  it("does not claim ordinary page content", () => {
    expect(isInFloatingLayer(layer("class='week-grid'"))).toBe(false);
  });

  it("resolves a text node through its parent, and tolerates no target", () => {
    const el = layer("data-field-popover");
    el.textContent = "pick";
    expect(isInFloatingLayer(el.firstChild)).toBe(true);
    expect(isInFloatingLayer(null)).toBe(false);
  });
});
