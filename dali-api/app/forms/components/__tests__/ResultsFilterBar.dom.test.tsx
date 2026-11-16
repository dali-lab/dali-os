// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/os-chrome", () => ({
  useOsChrome: () => ({ formClass: "os-form", fieldLabel: "" }),
}));
vi.mock("~/components/ui/DateField", () => ({
  DateField: ({ ariaLabel, value, onChange }: { ariaLabel: string; value: string; onChange: (v: string) => void }) =>
    createElement("input", { "aria-label": ariaLabel, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }),
}));

import { ResultsFilterBar, responseCountText } from "~/forms/components/ResultsFilterBar";
import type { FilterableQuestion } from "~/forms/lib/answer-filters";

let container: HTMLDivElement | undefined;
let root: Root | undefined;

const QUESTIONS: FilterableQuestion[] = [
  {
    key: "role",
    label: "Role",
    number: 1,
    type: "select",
    primary: "is",
    options: [
      { value: "dev", label: "Developer" },
      { value: "des", label: "Designer" },
    ],
  },
  { key: "bio", label: "Bio", number: 2, type: "textarea", primary: "contains" },
  { key: "age", label: "Age", number: 3, type: "number", primary: "range" },
  { key: "when", label: "Start date", number: 4, type: "date", primary: "range" },
];

const Where = () => createElement("output", null, useLocation().search);
const params = () => new URLSearchParams(container!.querySelector("output")!.textContent!);
const answers = () => params().getAll("a");

async function mount(
  entry: string,
  props: { questions?: FilterableQuestion[]; slotOptions?: string[]; count?: string } = {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const router = createMemoryRouter(
    [
      {
        path: "/forms/edit/f1",
        element: createElement(
          "div",
          null,
          createElement(ResultsFilterBar, {
            questions: props.questions ?? QUESTIONS,
            slotOptions: props.slotOptions ?? [],
            count: props.count ?? "49 responses",
          }),
          createElement(Where),
        ),
      },
    ],
    { initialEntries: [entry] },
  );
  await act(async () => root!.render(createElement(RouterProvider, { router })));
}

const click = (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  return act(async () => void el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const byText = (selector: string, text: string) =>
  [...document.body.querySelectorAll<HTMLElement>(selector)].find((el) => el.textContent?.trim().includes(text));
const openMenu = () => click(container!.querySelector("button[aria-haspopup='menu']"));
const openQuestion = async (label: string) => {
  await openMenu();
  await click(byText("[role='menuitem']", label));
};
const type = (input: Element | null | undefined, value: string) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
const field = (label: string) =>
  [...container!.querySelectorAll("label")].find((l) => l.textContent?.startsWith(label))?.querySelector("input");

const BASE = "/forms/edit/f1?view=results&version=2";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.useRealTimers();
});

describe("responseCountText", () => {
  it("shows one number when nothing narrows and a ratio when something does", () => {
    expect(responseCountText(49, 49)).toBe("49 responses");
    expect(responseCountText(12, 49)).toBe("12 of 49 responses");
    expect(responseCountText(1, 1)).toBe("1 response");
  });
});

describe("ResultsFilterBar", () => {
  it("renders nothing when there is no question to filter and no slot", async () => {
    await mount(BASE, { questions: [] });
    expect(container!.querySelector("button")).toBeNull();
  });

  it("lists the filterable questions prefixed with their number, with no badge and the count line", async () => {
    await mount(BASE, { count: "49 responses" });
    expect(container!.querySelector("button[aria-haspopup='menu']")!.textContent).toBe("Filter");
    await openMenu();
    const items = [...document.querySelectorAll("[role='menuitem']")].map((i) => i.textContent);
    expect(items).toEqual(["Q1Role", "Q2Bio", "Q3Age", "Q4Start date"]);
    expect(container!.textContent).toContain("49 responses");
  });

  it("picking values writes them to the URL, drops the page, and the pill and badge follow", async () => {
    await mount(`${BASE}&page=3`);
    await openQuestion("Role");
    await click(byText("[role='option']", "Developer"));
    await click(byText("[role='option']", "Designer"));
    expect(answers()).toEqual(["role:is:dev", "role:is:des"]);
    expect(params().get("page")).toBeNull();
    expect(params().get("version")).toBe("2");
    expect(container!.querySelector("button[aria-label='Role: Developer, Designer. Edit']")).not.toBeNull();
    expect(container!.querySelector("button[aria-haspopup='menu']")!.textContent).toContain("2");
  });

  it("goes back from a question to the list", async () => {
    await mount(BASE);
    await openQuestion("Role");
    await click(byText("button", "Filters /"));
    expect(document.querySelector("[role='menu']")).not.toBeNull();
  });

  it("writes a contains filter after a pause", async () => {
    await mount(BASE);
    await openQuestion("Bio");
    await type(field("Contains"), "robot");
    expect(answers()).toEqual([]);
    await act(async () => void vi.advanceTimersByTime(400));
    expect(answers()).toEqual(["bio:has:robot"]);
    expect(container!.querySelector("button[aria-label='Bio: \"robot\". Edit']")).not.toBeNull();
  });

  it("writes a number range from Min and Max and ignores text that is not a number", async () => {
    await mount(BASE);
    await openQuestion("Age");
    await type(field("Min"), "3");
    await act(async () => void vi.advanceTimersByTime(400));
    expect(answers()).toEqual(["age:min:3"]);
    await type(field("Max"), "abc");
    await act(async () => void vi.advanceTimersByTime(400));
    expect(answers()).toEqual(["age:min:3"]);
    await type(field("Max"), "9");
    await act(async () => void vi.advanceTimersByTime(400));
    expect(answers()).toEqual(["age:min:3", "age:max:9"]);
    expect(container!.querySelector("button[aria-label='Age: 3 to 9. Edit']")).not.toBeNull();
  });

  it("writes a date range from From and To", async () => {
    await mount(BASE);
    await openQuestion("Start date");
    await type(document.querySelector("input[aria-label='From date']"), "2026-01-05");
    await type(document.querySelector("input[aria-label='To date']"), "2026-02-01");
    expect(answers()).toEqual(["when:min:2026-01-05", "when:max:2026-02-01"]);
  });

  it("answered and no answer replace the type filter, and the type filter replaces them", async () => {
    await mount(BASE + "&a=bio:has:robot");
    await openQuestion("Bio");
    await click(byText("[role='radio']", "Answered"));
    expect(answers()).toEqual(["bio:answered"]);
    await click(byText("[role='radio']", "No answer"));
    expect(answers()).toEqual(["bio:blank"]);
    expect(byText("[role='radio']", "No answer")!.getAttribute("aria-checked")).toBe("true");
    await type(field("Contains"), "ada");
    await act(async () => void vi.advanceTimersByTime(400));
    expect(answers()).toEqual(["bio:has:ada"]);
  });

  it("answered and no answer work on a choice question and clear when picked again", async () => {
    await mount(BASE + "&a=role:is:dev");
    await openQuestion("Role");
    await click(byText("[role='radio']", "Answered"));
    expect(answers()).toEqual(["role:answered"]);
    await click(byText("[role='radio']", "Answered"));
    expect(answers()).toEqual([]);
  });

  it("shows a pill per active filter and removes one from its ×", async () => {
    await mount(BASE + "&a=role:is:dev&a=bio:answered");
    expect(container!.querySelector("button[aria-label='Role: Developer. Edit']")).not.toBeNull();
    expect(container!.querySelector("button[aria-label='Bio: Answered. Edit']")).not.toBeNull();
    await click(container!.querySelector("button[aria-label='Remove Role filter']"));
    expect(answers()).toEqual(["bio:answered"]);
  });

  it("clears every answer filter and the slot with Clear all but keeps the other params", async () => {
    await mount(BASE + "&a=role:is:dev&a=bio:answered&slot=Mon&q=ada&page=2", { slotOptions: ["Mon"] });
    await click(byText("button", "Clear all"));
    expect(answers()).toEqual([]);
    expect(params().get("slot")).toBeNull();
    expect(params().get("q")).toBe("ada");
    expect(params().get("version")).toBe("2");
    expect(params().get("page")).toBeNull();
  });

  it("offers the slot as a column and writes the slot param", async () => {
    await mount(BASE + "&page=2", { questions: [], slotOptions: ["Mon 9am", "Tue 3pm"] });
    await openQuestion("Slot");
    await click(byText("[role='option']", "Tue 3pm"));
    expect(params().get("slot")).toBe("Tue 3pm");
    expect(params().get("page")).toBeNull();
    expect(container!.querySelector("button[aria-label='Slot: Tue 3pm. Edit']")).not.toBeNull();
    await click(container!.querySelector("button[aria-label='Remove Slot filter']"));
    expect(params().get("slot")).toBeNull();
  });

  it("picking a different slot replaces the first", async () => {
    await mount(BASE + "&slot=Mon%209am", { slotOptions: ["Mon 9am", "Tue 3pm"] });
    await openQuestion("Slot");
    await click(byText("[role='option']", "Tue 3pm"));
    expect(params().get("slot")).toBe("Tue 3pm");
  });
});
