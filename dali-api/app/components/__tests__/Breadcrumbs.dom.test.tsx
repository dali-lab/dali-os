// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { Breadcrumbs } from "~/components/Breadcrumbs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(path: string, handle: Record<string, unknown>, data: unknown = { ok: true }) {
  const Stub = createRoutesStub([
    { path, handle, loader: () => data, Component: () => createElement(Breadcrumbs) },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: [path] }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const crumbs = () =>
  Array.from(container.querySelectorAll("nav[aria-label='Breadcrumb'] a, nav[aria-label='Breadcrumb'] span.font-medium")).map(
    (el) => [el.textContent, el.getAttribute("href")],
  );

describe("Breadcrumbs with hideBreadcrumbs", () => {
  it("shows nothing from the path", async () => {
    await mount("/documents/abc", { hideBreadcrumbs: true });
    expect(container.querySelector("nav")).toBeNull();
  });

  it("still shows a trail the route builds from its own data", async () => {
    await mount("/documents/abc", {
      hideBreadcrumbs: true,
      breadcrumbTrail: (d: { title: string }) => [
        { label: "Projects", to: "/drive?scope=projects" },
        { label: "Weekly sync", to: "/documents/nb1" },
        { label: d.title },
      ],
    }, { title: "Oct 14, 2026" });
    expect(crumbs()).toEqual([
      ["Projects", "/drive?scope=projects"],
      ["Weekly sync", "/documents/nb1"],
      ["Oct 14, 2026", null],
    ]);
  });

  it("stays hidden when the route's trail comes back empty", async () => {
    await mount("/documents/abc", { hideBreadcrumbs: true, breadcrumbTrail: () => null });
    expect(container.querySelector("nav")).toBeNull();
  });
});
