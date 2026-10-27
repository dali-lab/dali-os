// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { DomainNav } from "./DomainNav";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DOMAINS = [
  { slug: "fullstack", name: "Full-stack" },
  { slug: "design", name: "Design" },
  { slug: "ios", name: "iOS" },
];

let container: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;
function mount(active: string) {
  router = createMemoryRouter(
    [{ path: "*", element: createElement(DomainNav, { domains: DOMAINS, active }) }],
    { initialEntries: [`/journeys/${active}`] },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(RouterProvider, { router })));
}
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const trigger = () => container.querySelector<HTMLElement>('[aria-label="Domain"]')!;

describe("DomainNav", () => {
  it("renders a domain dropdown, not a sidebar", () => {
    mount("fullstack");
    expect(container.querySelector("nav")).toBeNull();
    expect(trigger()).not.toBeNull();
  });

  it("shows the active domain on the trigger", () => {
    mount("design");
    expect(trigger().textContent).toContain("Design");
  });

  it("lists every domain in the given order when opened", () => {
    mount("fullstack");
    act(() => trigger().click());
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.map((o) => o.textContent)).toEqual(["Full-stack", "Design", "iOS"]);
  });

  it("navigates to the picked domain's journeys page", () => {
    mount("fullstack");
    act(() => trigger().click());
    const ios = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === "iOS",
    )!;
    act(() => ios.click());
    expect(router.state.location.pathname).toBe("/journeys/ios");
  });
});
