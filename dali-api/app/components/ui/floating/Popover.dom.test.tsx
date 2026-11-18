// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import { click, renderDom } from "~/test-utils/render";
import { Popover } from "./Popover";

function pointerdown(target: Element) {
  act(() => {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
}

function openPopover() {
  const elsewhere = document.createElement("div");
  elsewhere.id = "elsewhere";
  document.body.appendChild(elsewhere);
  const { container } = renderDom(
    <Popover ariaLabel="Panel" trigger={<button type="button">Open</button>}>
      <span>Body</span>
    </Popover>,
  );
  click(container.querySelector("button")!);
  return () => document.querySelector("[aria-label='Panel']");
}

describe("Popover", () => {
  it("closes on a press outside", async () => {
    const panel = openPopover();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(panel()).not.toBeNull();
    pointerdown(document.getElementById("elsewhere")!);
    expect(panel()).toBeNull();
  });

  it("stays open for a press inside a date picker opened from it", async () => {
    const panel = openPopover();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const picker = document.createElement("div");
    picker.setAttribute("data-field-popover", "");
    const day = document.createElement("button");
    picker.appendChild(day);
    document.body.appendChild(picker);
    pointerdown(day);
    expect(panel()).not.toBeNull();
  });
});
