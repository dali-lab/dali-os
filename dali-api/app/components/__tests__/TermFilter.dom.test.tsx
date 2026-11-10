// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { TermFilter } from "../TermFilter";
import type { TermOption } from "~/lib/terms.shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TERMS: TermOption[] = [
  { id: "t-27w", code: "27W" },
  { id: "t-26f", code: "26F", isCurrent: true },
  { id: "t-26x", code: "26X" },
];

let container: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;

async function mount(props: Partial<Parameters<typeof TermFilter>[0]> = {}, entry = "/list?q=ada") {
  router = createMemoryRouter(
    [
      {
        path: "/list",
        Component: () => createElement(TermFilter, { terms: TERMS, selected: "t-26f", ...props }),
      },
    ],
    { initialEntries: ["/start", entry] },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(RouterProvider, { router })));
}

const trigger = () => document.querySelector<HTMLButtonElement>("button[aria-label='Filter by term']")!;

async function open() {
  await act(async () => {
    trigger().click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return Array.from(document.querySelectorAll<HTMLElement>("[role='option']"));
}

async function pick(label: string) {
  const option = (await open()).find((o) => o.textContent === label)!;
  await act(async () => option.click());
}

const params = () => new URLSearchParams(router.state.location.search);

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("TermFilter", () => {
  it("lists All terms, then the current term, then the rest newest first", async () => {
    await mount();
    expect((await open()).map((o) => o.textContent)).toEqual(["All terms", "26F (current)", "27W", "26X"]);
  });

  it("shows the selected term on the trigger", async () => {
    await mount({ selected: "t-26x" });
    expect(trigger().textContent).toContain("26X");
  });

  it("leaves out All terms for a single-term switcher", async () => {
    await mount({ includeAll: false });
    expect((await open()).map((o) => o.textContent)).toEqual(["26F (current)", "27W", "26X"]);
  });

  it("offers Current & upcoming when asked", async () => {
    await mount({ includeUpcoming: true });
    expect((await open())[0].textContent).toBe("Current & upcoming");
  });

  it("writes ?term=<id> and keeps the other params", async () => {
    await mount();
    await pick("27W");
    expect(params().get("term")).toBe("t-27w");
    expect(params().get("q")).toBe("ada");
  });

  it("writes the all sentinel for All terms", async () => {
    await mount();
    await pick("All terms");
    expect(params().get("term")).toBe("all");
  });

  it("adds a history entry by default", async () => {
    await mount();
    await pick("27W");
    expect(router.state.historyAction).toBe("PUSH");
  });

  it("replaces the history entry when asked", async () => {
    await mount({ replace: true });
    await pick("27W");
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("wraps option labels with formatLabel", async () => {
    await mount({ includeAll: false, formatLabel: (label) => `Active in ${label}` });
    expect((await open()).map((o) => o.textContent)).toEqual([
      "Active in 26F (current)",
      "Active in 27W",
      "Active in 26X",
    ]);
    expect(trigger().textContent).toContain("Active in 26F (current)");
  });

  it("drops the clearOnChange params on a switch", async () => {
    await mount({ clearOnChange: ["domain", "termId"] }, "/list?q=ada&domain=d1&termId=t-old");
    await pick("27W");
    expect(params().get("term")).toBe("t-27w");
    expect(params().has("domain")).toBe(false);
    expect(params().has("termId")).toBe(false);
    expect(params().get("q")).toBe("ada");
  });
});
