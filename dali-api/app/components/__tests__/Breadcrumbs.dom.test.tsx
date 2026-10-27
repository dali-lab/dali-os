// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { Breadcrumbs, PageBarTrail } from "~/components/Breadcrumbs";

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

const longTrail = (d: { title: string }) => [
  { label: "Drive", to: "/drive" },
  { label: "Lab", to: "/drive?scope=lab" },
  { label: "Projects", to: "/drive?scope=lab&folder=f1" },
  { label: "Fall", to: "/drive?scope=lab&folder=f2" },
  { label: "Notes", to: "/drive?scope=lab&folder=f3" },
  { label: d.title },
];

async function openOverflow() {
  const button = container.querySelector<HTMLButtonElement>("button[aria-label='Show hidden path segments']")!;
  await act(async () => {
    button.click();
  });
  return Array.from(document.querySelectorAll("[role='menuitem']")).map((el) => [el.textContent, el.getAttribute("href")]);
}

describe("Breadcrumbs overflow", () => {
  it("keeps the first and last two crumbs and folds the rest behind a menu", async () => {
    await mount("/documents/abc", { breadcrumbTrail: longTrail }, { title: "Kickoff" });
    expect(crumbs()).toEqual([
      ["Drive", "/drive"],
      ["Notes", "/drive?scope=lab&folder=f3"],
      ["Kickoff", null],
    ]);
    expect(await openOverflow()).toEqual([
      ["Lab", "/drive?scope=lab"],
      ["Projects", "/drive?scope=lab&folder=f1"],
      ["Fall", "/drive?scope=lab&folder=f2"],
    ]);
  });

  it("shows a four-crumb trail whole", async () => {
    await mount("/documents/abc", {
      breadcrumbTrail: () => [
        { label: "Drive", to: "/drive" },
        { label: "Lab", to: "/drive?scope=lab" },
        { label: "Notes", to: "/drive?scope=lab&folder=f3" },
        { label: "Kickoff" },
      ],
    });
    expect(crumbs().map(([label]) => label)).toEqual(["Drive", "Lab", "Notes", "Kickoff"]);
    expect(container.querySelector("button[aria-label='Show hidden path segments']")).toBeNull();
  });

  it("lists a hidden crumb with no page as a disabled entry", async () => {
    await mount("/documents/abc", {
      breadcrumbTrail: () => [
        { label: "Education", to: "/education" },
        { label: "Course" },
        { label: "Assignments" },
        { label: "Week 1", to: "/education/x" },
        { label: "Essay" },
      ],
    });
    await openOverflow();
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>("button[role='menuitem']"));
    expect(items.map((el) => [el.textContent, el.disabled])).toEqual([
      ["Course", true],
      ["Assignments", true],
    ]);
  });
});

describe("PageBarTrail overflow", () => {
  async function mountBar(trail: { label: string; to?: string }[]) {
    const Stub = createRoutesStub([
      { path: "/", Component: () => createElement(PageBarTrail, { crumbs: trail }) },
    ]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(Stub, { initialEntries: ["/"] }));
    });
  }
  const barCrumbs = () =>
    Array.from(container.querySelectorAll("nav a, nav span.font-semibold")).map((el) => el.textContent);

  it("folds the middle of a long trail", async () => {
    await mountBar(longTrail({ title: "Kickoff" }));
    expect(barCrumbs()).toEqual(["Drive", "Notes", "Kickoff"]);
    expect((await openOverflow()).map(([label]) => label)).toEqual(["Lab", "Projects", "Fall"]);
  });

  it("shows a short trail whole", async () => {
    await mountBar([{ label: "Notebook", to: "/n" }, { label: "Tab" }]);
    expect(barCrumbs()).toEqual(["Notebook", "Tab"]);
  });
});
