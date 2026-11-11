// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/ui/floating", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/components/ui/floating")>()),
  Popover: ({ trigger, children }: { trigger: React.ReactElement | ((open: boolean) => React.ReactElement); children: React.ReactNode | ((close: () => void) => React.ReactNode) }) =>
    createElement("div", null, typeof trigger === "function" ? trigger(false) : trigger, typeof children === "function" ? children(() => {}) : children),
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  Select: ({ options }: { options: { value: string; label: string }[] }) =>
    createElement("ul", { "aria-label": "slots" }, options.map((o) => createElement("li", { key: o.value }, o.label))),
}));
vi.mock("~/components/os-chrome", () => ({ useOsChrome: () => ({ iconBtn: "" }), modalCardClass: () => "" }));
vi.mock("~/components/Modal", () => ({ Modal: () => null, ModalHeader: () => null }));

import { VersionResults } from "~/forms/components/VersionResults";

let container: HTMLDivElement;
let root: Root;

const response = (i: number) => ({
  id: `s${i}`,
  createdAt: "2026-05-20T10:00:00.000Z",
  name: `Person ${i}`,
  email: null,
  slot: null,
  submitterIp: null,
  partnerApplication: null,
  rows: [],
});

const results = (over: Record<string, unknown> = {}) =>
  ({
    versionId: "v1",
    isPartnerApplicationForm: false,
    totalCount: 120,
    matchCount: 120,
    page: 1,
    hasNext: true,
    columns: [],
    slotOptions: ["Mon 9am", "Tue 3pm"],
    filterQuestions: [],
    responses: [response(1), response(2)],
    ...over,
  }) as never;

const FILTER_QUESTIONS = [
  { key: "k", label: "Role", type: "select", primary: "is", options: [{ value: "A", label: "Alpha" }] },
  { key: "n", label: "Age", type: "number", primary: "range" },
];

function Where() {
  const loc = useLocation();
  return createElement("output", null, loc.search);
}

async function mount(entry: string, data: unknown) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const router = createMemoryRouter(
    [
      {
        path: "/forms/edit/f1",
        element: createElement("div", null, createElement(VersionResults, { formId: "f1", versionNumber: 2, results: data as never, lead: null }), createElement(Where)),
      },
    ],
    { initialEntries: [entry] },
  );
  await act(async () => {
    root.render(createElement(RouterProvider, { router }));
  });
  return router;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("VersionResults", () => {
  it("states the true total and offers every slot from the whole version", async () => {
    await mount("/forms/edit/f1?view=results&version=2", results());
    expect(container.textContent).toContain("120 responses");
    expect(container.textContent).not.toContain("most recent");
  });

  it("says how many match when a search narrows the list", async () => {
    await mount("/forms/edit/f1?view=results&version=2&q=ada", results({ matchCount: 3, hasNext: false }));
    expect(container.textContent).toContain("3 of 120 responses");
    expect(container.textContent).toContain("Respondent (3)");
  });

  it("puts the search in the URL after a pause and returns to page one", async () => {
    await mount("/forms/edit/f1?view=results&version=2&page=3", results({ page: 3 }));
    const input = container.querySelector("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "ada");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector("output")!.textContent).toContain("page=3");
    await act(async () => void vi.advanceTimersByTime(400));
    const search = new URLSearchParams(container.querySelector("output")!.textContent!);
    expect(search.get("q")).toBe("ada");
    expect(search.get("page")).toBeNull();
    expect(search.get("view")).toBe("results");
    expect(search.get("version")).toBe("2");
  });

  it("links to the next and previous pages, keeping the filters", async () => {
    await mount("/forms/edit/f1?view=results&version=2&q=ada&page=2", results({ page: 2, hasNext: true }));
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/forms/edit/f1?view=results&version=2&q=ada");
    expect(hrefs).toContain("/forms/edit/f1?view=results&version=2&q=ada&page=3");
  });

  it("shows no pager when everything fits on one page", async () => {
    await mount("/forms/edit/f1?view=results&version=2", results({ hasNext: false, totalCount: 2, matchCount: 2 }));
    expect(container.querySelector('nav[aria-label="Responses pagination"]')).toBeNull();
  });

  it("keeps the CSV export pointed at the whole version when nothing narrows it", async () => {
    await mount("/forms/edit/f1?view=results&version=2", results());
    const csv = [...container.querySelectorAll<HTMLAnchorElement>("a")].find((a) => a.textContent === "Export")!;
    expect(csv.getAttribute("href")).toBe("/forms/responses/f1/export.csv?version=2");
  });

  it("exports the matching responses, carrying the search, slot and answer filters", async () => {
    await mount(
      "/forms/edit/f1?view=results&version=2&q=ada&slot=Tue%203pm&a=k:is:A&a=n:min:3",
      results({ matchCount: 7, filterQuestions: FILTER_QUESTIONS }),
    );
    const csv = [...container.querySelectorAll<HTMLAnchorElement>("a")].find((a) => a.textContent === "Export 7")!;
    expect(csv).toBeTruthy();
    const href = new URL(csv.getAttribute("href")!, "http://os.test");
    expect(href.searchParams.get("version")).toBe("2");
    expect(href.searchParams.get("q")).toBe("ada");
    expect(href.searchParams.get("slot")).toBe("Tue 3pm");
    expect(href.searchParams.getAll("a")).toEqual(["k:is:A", "n:min:3"]);
  });

  it("says the search covers answers", async () => {
    await mount("/forms/edit/f1?view=results&version=2", results());
    expect(container.querySelector("input")!.getAttribute("placeholder")).toBe("Search by name, email or answer");
  });

  it("clears the search, slot and answer filters from the empty state and goes back to page one", async () => {
    await mount(
      "/forms/edit/f1?view=results&version=2&q=zzz&slot=Mon%209am&a=k:is:A&page=2",
      results({ matchCount: 0, responses: [], filterQuestions: FILTER_QUESTIONS, page: 2 }),
    );
    expect(container.textContent).toContain("No responses match the current filters.");
    const clear = [...container.querySelectorAll("button")].find((b) => b.textContent === "Clear filters")!;
    await act(async () => void clear.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelector("output")!.textContent).toBe("?view=results&version=2");
    expect(container.querySelector("input")!.value).toBe("");
  });

  it("offers no Clear filters when nothing is narrowing the list", async () => {
    await mount("/forms/edit/f1?view=results&version=2", results({ matchCount: 0, responses: [] }));
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Clear filters")).toBe(false);
  });
});
