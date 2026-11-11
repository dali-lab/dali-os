// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/ui/floating", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  Select: () => null,
  Popover: ({ trigger, children }: { trigger: React.ReactElement; children: React.ReactNode }) =>
    createElement("div", null, trigger, children),
}));
vi.mock("~/components/os-chrome", () => ({
  useOsChrome: () => ({ formClass: "os-form", fieldLabel: "" }),
}));
vi.mock("~/components/ui/DateField", () => ({
  DateField: ({ ariaLabel, value, onChange }: { ariaLabel: string; value: string; onChange: (v: string) => void }) =>
    createElement("input", { "aria-label": ariaLabel, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }),
}));
vi.mock("~/forms/components/FormTracker", () => ({ FormTracker: () => null }));

import { AnswerFilterButton, AnswerFilterChips } from "~/forms/components/AnswerFilters";
import { VersionSummary } from "~/forms/components/VersionSummary";
import type { FilterableQuestion } from "~/forms/lib/answer-filters";

let container: HTMLDivElement;
let root: Root;

const QUESTIONS: FilterableQuestion[] = [
  {
    key: "role",
    label: "Role",
    type: "select",
    primary: "is",
    options: [
      { value: "dev", label: "Developer" },
      { value: "des", label: "Designer" },
    ],
  },
  { key: "bio", label: "Bio", type: "textarea", primary: "contains" },
  { key: "age", label: "Age", type: "number", primary: "range" },
  { key: "when", label: "Start date", type: "date", primary: "range" },
];

const Where = () => createElement("output", null, useLocation().search);
const where = () => new URLSearchParams(container.querySelector("output")!.textContent!);

async function mount(entry: string, node: React.ReactElement = createElement("div", null, createElement(AnswerFilterButton, { questions: QUESTIONS }), createElement(AnswerFilterChips, { questions: QUESTIONS }))) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const router = createMemoryRouter(
    [{ path: "/forms/edit/f1", element: createElement("div", null, node, createElement(Where)) }],
    { initialEntries: [entry] },
  );
  await act(async () => root.render(createElement(RouterProvider, { router })));
}

const click = (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  return act(async () => void el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const type = (input: Element, value: string) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("AnswerFilterButton", () => {
  it("lists the filterable questions and shows no badge with nothing on", async () => {
    await mount("/forms/edit/f1?view=results&version=2");
    expect(["Role", "Bio", "Age", "Start date"].every((l) => button(l))).toBe(true);
    expect(button("Filter")).toBeTruthy();
  });

  it("picking an option writes it to the URL and goes back to page one", async () => {
    await mount("/forms/edit/f1?view=results&version=2&page=3");
    await click(button("Role"));
    await click(button("Developer"));
    expect(where().getAll("a")).toEqual(["role:is:dev"]);
    expect(where().get("page")).toBeNull();
    expect(where().get("view")).toBe("results");
    await click(button("Designer"));
    expect(where().getAll("a")).toEqual(["role:is:dev", "role:is:des"]);
    await click(button("Developer"));
    expect(where().getAll("a")).toEqual(["role:is:des"]);
    await click(button("Designer"));
    expect(where().has("a")).toBe(false);
  });

  it("shows how many questions are filtered in the badge", async () => {
    await mount("/forms/edit/f1?a=role:is:dev&a=bio:has:rust");
    expect(button("Filter2")).toBeTruthy();
  });

  it("answered and no answer replace the filter on that question", async () => {
    await mount("/forms/edit/f1?a=role:is:dev");
    await click(button("Role"));
    await click(button("No answer"));
    expect(where().getAll("a")).toEqual(["role:blank"]);
    await click(button("Answered"));
    expect(where().getAll("a")).toEqual(["role:answered"]);
  });

  it("applies a text filter after a pause and removes it when emptied", async () => {
    await mount("/forms/edit/f1?view=results");
    await click(button("Bio"));
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Contains text"]')!;
    await type(input, "rust");
    expect(where().has("a")).toBe(false);
    await act(async () => void vi.advanceTimersByTime(400));
    expect(where().getAll("a")).toEqual(["bio:has:rust"]);
    await type(container.querySelector('input[aria-label="Contains text"]')!, "");
    await act(async () => void vi.advanceTimersByTime(400));
    expect(where().has("a")).toBe(false);
  });

  it("writes number bounds and date bounds, ignoring a non-number", async () => {
    await mount("/forms/edit/f1?view=results");
    await click(button("Age"));
    const [min, max] = [...container.querySelectorAll<HTMLInputElement>("input[type=text]")];
    await type(min, "3");
    await type(max, "abc");
    await act(async () => void vi.advanceTimersByTime(400));
    expect(where().getAll("a")).toEqual(["age:min:3"]);
    await type(container.querySelectorAll<HTMLInputElement>("input[type=text]")[1], "9.5");
    await act(async () => void vi.advanceTimersByTime(400));
    expect(where().getAll("a")).toEqual(["age:min:3", "age:max:9.5"]);

    await click(button("All questions"));
    await click(button("Start date"));
    await type(container.querySelector('input[aria-label="From date"]')!, "2026-01-02");
    expect(where().getAll("a")).toContain("when:min:2026-01-02");
  });

  it("Reset clears every answer filter but keeps the rest of the URL", async () => {
    await mount("/forms/edit/f1?view=results&version=2&q=ada&a=role:is:dev&a=bio:has:x");
    await click(button("Reset"));
    expect(where().has("a")).toBe(false);
    expect(where().get("q")).toBe("ada");
  });
});

describe("AnswerFilterChips", () => {
  it("renders nothing without filters", async () => {
    await mount("/forms/edit/f1");
    expect(container.querySelector("ul[aria-label='Active answer filters']")).toBeNull();
  });

  it("describes each filter in words and ignores stale ones", async () => {
    await mount("/forms/edit/f1?a=role:is:dev&a=age:min:3&a=gone:blank&a=bio:has:rust");
    const chips = [...container.querySelectorAll("ul[aria-label='Active answer filters'] li")].map((li) => li.textContent);
    expect(chips).toEqual([
      "Remove filter: Role: Developer",
      "Remove filter: Age: 3 or more",
      'Remove filter: Bio contains "rust"',
    ]);
  });

  it("removing a chip drops only that filter and resets the page", async () => {
    await mount("/forms/edit/f1?page=2&a=role:is:dev&a=age:min:3");
    await click(container.querySelector("ul[aria-label='Active answer filters'] li button"));
    expect(where().getAll("a")).toEqual(["age:min:3"]);
    expect(where().get("page")).toBeNull();
  });
});

describe("VersionSummary with answer filters", () => {
  const data = (total: number) =>
    ({
      versionId: "v1",
      slotOptions: [],
      filterQuestions: QUESTIONS,
      summary: { total, questions: [] },
    }) as never;
  const summary = (total: number) =>
    createElement(VersionSummary, { formId: "f1", versionNumber: 2, data: data(total), tracker: null });

  it("exports the matching count with the filters", async () => {
    await mount("/forms/edit/f1?view=results&version=2&q=ada&a=role:is:dev", summary(5));
    const link = container.querySelector<HTMLAnchorElement>('a[aria-label="Export 5 matching"]')!;
    const href = new URL(link.getAttribute("href")!, "http://os.test");
    expect(href.searchParams.getAll("a")).toEqual(["role:is:dev"]);
    expect(href.searchParams.has("q")).toBe(false);
  });

  it("offers Clear filters when the filters match nothing", async () => {
    await mount("/forms/edit/f1?view=results&version=2&a=role:is:dev&slot=x", summary(0));
    expect(container.textContent).toContain("No responses match the current filters.");
    await click(button("Clear filters"));
    expect(where().has("a")).toBe(false);
    expect(where().has("slot")).toBe(false);
    expect(where().get("version")).toBe("2");
  });

  it("keeps the filters when switching between Summary and Responses", async () => {
    await mount("/forms/edit/f1?view=results&version=2&a=role:is:dev", summary(5));
    await click(button("Responses"));
    expect(where().get("show")).toBe("responses");
    expect(where().getAll("a")).toEqual(["role:is:dev"]);
  });
});
