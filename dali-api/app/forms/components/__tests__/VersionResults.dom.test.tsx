// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/ui/floating", () => ({
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
    responses: [response(1), response(2)],
    ...over,
  }) as never;

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
        element: createElement("div", null, createElement(VersionResults, { formId: "f1", versionNumber: 2, results: data as never }), createElement(Where)),
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
    expect(container.textContent).toContain("Tue 3pm");
    expect(container.textContent).not.toContain("most recent");
  });

  it("says how many match when a search narrows the list", async () => {
    await mount("/forms/edit/f1?view=results&version=2&q=ada", results({ matchCount: 3, hasNext: false }));
    expect(container.textContent).toContain("120 responses · 3 match");
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

  it("keeps the CSV export pointed at the whole version", async () => {
    await mount("/forms/edit/f1?view=results&version=2&q=ada", results());
    const csv = container.querySelector<HTMLAnchorElement>('a[aria-label="Export CSV"]')!;
    expect(csv.getAttribute("href")).toBe("/forms/responses/f1/export.csv?version=2");
  });
});
