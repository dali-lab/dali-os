// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("~/components/os-chrome", () => ({ useOsChrome: () => ({ formTrigger: "" }) }));

import { PrefillPicker } from "~/components/form-builder/PrefillPicker";
import type { FillerKind } from "~/forms/lib/prefill-fields";
import type { Question } from "~/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onChange = vi.fn();
const text = () => document.body.textContent ?? "";
const options = () => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? "");

function render(question: Pick<Question, "type" | "data">, fillers: FillerKind[]) {
  act(() => {
    root.render(createElement(PrefillPicker, { question, fillers, onChange }));
  });
}
async function open() {
  await act(async () => {
    container.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
const text_ = (prefill?: string): Pick<Question, "type" | "data"> => ({ type: "text", data: { label: "Org", prefill } });

beforeEach(() => {
  onChange.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PrefillPicker", () => {
  it("renders nothing for a question no field fits", () => {
    render({ type: "radio", data: { label: "Pick" } }, ["member"]);
    expect(container.innerHTML).toBe("");
  });

  it("hides partner fields on a form only lab members fill", async () => {
    render(text_(), ["member"]);
    await open();
    const listed = options();
    expect(listed.some((o) => o.startsWith("Their name"))).toBe(true);
    expect(listed.some((o) => o.includes("organization"))).toBe(false);
  });

  it("notes who gets a blank on a form several kinds of people fill", async () => {
    render(text_(), ["member", "partner"]);
    await open();
    const org = options().find((o) => o.startsWith("Their organization's name"));
    expect(org).toContain("Blank for lab members.");
  });

  it("picks a field and clears back to blank", async () => {
    render(text_(), ["partner"]);
    await open();
    await act(async () => {
      [...document.querySelectorAll('[role="option"]')]
        .find((o) => o.textContent?.startsWith("Their organization's name"))!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith("partnerOrg.name");

    render(text_("partnerOrg.name"), ["partner"]);
    await open();
    await act(async () => {
      [...document.querySelectorAll('[role="option"]')]
        .find((o) => o.textContent?.startsWith("Nothing"))!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("warns when a field already set can never fill with the current sharing", () => {
    render(text_("partnerOrg.name"), ["member"]);
    expect(text()).toContain("This never fills in: the form is shared with lab members only.");
  });

  it("says who gets a blank for the field that's set", () => {
    render(text_("partnerOrg.name"), ["member", "partner"]);
    expect(text()).toContain("Blank for lab members.");
  });
});
