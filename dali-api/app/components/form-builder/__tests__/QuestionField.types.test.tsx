// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FormQuestionField } from "~/components/form-builder/QuestionField";
import type { Question } from "~/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

// Holds the answer in state like a real fill screen, and records every value.
function mount(question: Question, initial = "", disabled = false) {
  const seen: string[] = [];
  function Harness() {
    const [value, setValue] = useState(initial);
    return createElement(FormQuestionField, {
      question,
      value,
      disabled,
      onChange: (v: string) => {
        seen.push(v);
        setValue(v);
      },
    });
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness)));
  return seen;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const q = (type: Question["type"], data: Partial<Question["data"]> = {}): Question => ({
  key: "k",
  type,
  required: false,
  data: { label: "Pick", ...data },
});

const radios = () => [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
const boxes = () => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
const textInput = () => container.querySelector<HTMLInputElement>('input[type="text"]');

function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("radio question", () => {
  const radio = (extra: Partial<Question["data"]> = {}) => q("radio", { options: ["Red", "Blue"], ...extra });

  it("renders one radio per option and no Other by default", () => {
    mount(radio());
    expect(radios()).toHaveLength(2);
    expect(container.textContent).not.toContain("Other");
  });

  it("selects an option", () => {
    const seen = mount(radio());
    act(() => radios()[1].click());
    expect(seen).toEqual(["Blue"]);
    expect(radios()[1].checked).toBe(true);
  });

  it("shows the saved option as checked", () => {
    mount(radio(), "Red");
    expect(radios()[0].checked).toBe(true);
  });

  it("adds an Other radio with a write-in field that stores the typed text", () => {
    const seen = mount(radio({ allowOther: true }));
    expect(radios()).toHaveLength(3);
    expect(textInput()).toBeNull();
    act(() => radios()[2].click());
    type(textInput()!, "Green");
    expect(seen.at(-1)).toBe("Green");
    expect(radios()[2].checked).toBe(true);
  });

  it("clears a chosen option when Other is picked, and the write-in is capped at 200", () => {
    const seen = mount(radio({ allowOther: true }), "Red");
    act(() => radios()[2].click());
    expect(seen).toEqual([""]);
    expect(textInput()!.maxLength).toBe(200);
  });

  it("re-renders a saved value that isn't an option as Other with its text", () => {
    mount(radio({ allowOther: true }), "Green");
    expect(radios()[2].checked).toBe(true);
    expect(radios().slice(0, 2).every((r) => !r.checked)).toBe(true);
    expect(textInput()!.value).toBe("Green");
  });

  it("returns to a listed option from Other", () => {
    const seen = mount(radio({ allowOther: true }), "Green");
    act(() => radios()[0].click());
    expect(seen.at(-1)).toBe("Red");
    expect(textInput()).toBeNull();
  });

  it("disables every control", () => {
    mount(radio({ allowOther: true }), "Green", true);
    expect(radios().every((r) => r.disabled)).toBe(true);
    expect(textInput()!.disabled).toBe(true);
  });
});

describe("checkbox question with Other", () => {
  const box = (extra: Partial<Question["data"]> = {}) => q("checkbox", { options: ["A", "B"], ...extra });

  it("has no Other unless allowed", () => {
    mount(box());
    expect(boxes()).toHaveLength(2);
  });

  it("stores the Other text after the chosen options", () => {
    const seen = mount(box({ allowOther: true }));
    act(() => boxes()[1].click());
    act(() => boxes()[2].click());
    type(textInput()!, "Mine");
    expect(JSON.parse(seen.at(-1)!)).toEqual(["B", "Mine"]);
  });

  it("keeps the Other text when an option is toggled", () => {
    const seen = mount(box({ allowOther: true }), JSON.stringify(["Mine"]));
    act(() => boxes()[0].click());
    expect(JSON.parse(seen.at(-1)!)).toEqual(["A", "Mine"]);
  });

  it("shows a saved non-option value as Other, checked, with its text", () => {
    mount(box({ allowOther: true }), JSON.stringify(["A", "Mine"]));
    expect(boxes().map((b) => b.checked)).toEqual([true, false, true]);
    expect(textInput()!.value).toBe("Mine");
  });

  it("unchecking Other removes its text from the answer", () => {
    const seen = mount(box({ allowOther: true }), JSON.stringify(["A", "Mine"]));
    act(() => boxes()[2].click());
    expect(JSON.parse(seen.at(-1)!)).toEqual(["A"]);
    expect(textInput()).toBeNull();
  });

  it("an empty Other adds nothing to the answer", () => {
    const seen = mount(box({ allowOther: true }));
    act(() => boxes()[2].click());
    expect(seen).toEqual([]);
  });
});

describe("scale question", () => {
  const scale = (extra: Partial<Question["data"]> = {}) => q("scale", extra);
  const buttons = () => [...container.querySelectorAll<HTMLButtonElement>('button[role="radio"]')];

  it("renders five buttons from 1 to 5", () => {
    mount(scale());
    expect(buttons().map((b) => b.textContent)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("selects a value and marks it checked", () => {
    const seen = mount(scale());
    act(() => buttons()[3].click());
    expect(seen).toEqual(["4"]);
    expect(buttons().map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "true", "false"]);
  });

  it("shows a saved value as selected", () => {
    mount(scale(), "2");
    expect(buttons()[1].getAttribute("aria-checked")).toBe("true");
  });

  it("shows the end labels only when set", () => {
    mount(scale());
    expect(container.querySelector("span")).toBeNull();
    act(() => root.unmount());
    container.remove();
    mount(scale({ scaleLow: "Not at all", scaleHigh: "Very much" }));
    expect(container.textContent).toContain("Not at all");
    expect(container.textContent).toContain("Very much");
  });

  it("does nothing when disabled", () => {
    const seen = mount(scale(), "", true);
    act(() => buttons()[0].click());
    expect(seen).toEqual([]);
  });
});

describe("number and email questions", () => {
  it("number uses a decimal keypad and passes the text through", () => {
    const seen = mount(q("number"));
    expect(textInput()!.inputMode).toBe("decimal");
    type(textInput()!, "12.5");
    expect(seen).toEqual(["12.5"]);
  });

  it("email uses the email keypad", () => {
    const seen = mount(q("email"));
    expect(textInput()!.inputMode).toBe("email");
    type(textInput()!, "ada@example.edu");
    expect(seen).toEqual(["ada@example.edu"]);
  });
});

describe("date question", () => {
  it("renders the shared date picker showing the saved date", () => {
    mount(q("date"), "2026-11-02");
    expect(container.querySelector("button")).not.toBeNull();
    expect(container.textContent).toMatch(/Nov/);
  });

  it("renders a trigger without a value", () => {
    mount(q("date"));
    expect(container.querySelector("button")).not.toBeNull();
  });
});

vi.mock("~/projects/components/ProjectCoverImage", () => ({ ProjectCoverImage: () => null }));
