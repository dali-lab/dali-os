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

const sidebar = () => container.querySelector('nav[aria-label="Domains"]')!;
const links = () => [...sidebar().querySelectorAll("a")];

describe("DomainNav", () => {
  it("lists every domain vertically in the given order", () => {
    mount("fullstack");
    expect(sidebar().querySelector("ul")!.className).toContain("flex-col");
    expect(links().map((a) => a.textContent)).toEqual(["Full-stack", "Design", "iOS"]);
  });

  it("links each domain to its journeys page", () => {
    mount("fullstack");
    expect(links().map((a) => a.getAttribute("href"))).toEqual([
      "/journeys/fullstack",
      "/journeys/design",
      "/journeys/ios",
    ]);
  });

  it("marks only the active domain as the current page", () => {
    mount("design");
    expect(links().map((a) => a.getAttribute("aria-current"))).toEqual([null, "page", null]);
  });

  it("navigates when another domain is clicked", () => {
    mount("fullstack");
    act(() => links()[2].click());
    expect(router.state.location.pathname).toBe("/journeys/ios");
  });

  it("hides the sidebar below lg and shows a domain select there instead", () => {
    mount("design");
    expect(sidebar().className.split(" ")).toEqual(expect.arrayContaining(["hidden", "lg:block"]));
    const narrow = container.querySelector(".lg\\:hidden")!;
    expect(narrow.querySelector('[aria-label="Domain"]')).not.toBeNull();
    expect(narrow.textContent).toContain("Design");
  });
});
