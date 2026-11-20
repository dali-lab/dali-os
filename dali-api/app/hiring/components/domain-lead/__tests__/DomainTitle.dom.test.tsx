// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoutesStub, useLocation } from "react-router";
import { renderDom, click } from "~/test-utils/render";
import { DomainTitle, type DomainOption } from "../DomainTitle";

const DOMAINS: DomainOption[] = [
  { id: "d1", name: "Design" },
  { id: "d2", name: "Engineering" },
  { id: "d3", name: "Product" },
];

function Search() {
  return <output>{useLocation().search}</output>;
}

async function mount(domains: DomainOption[], currentId: string, url = "/") {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <>
          <DomainTitle domains={domains} currentId={currentId} />
          <Search />
        </>
      ),
    },
  ]);
  const view = renderDom(<Stub initialEntries={[url]} />);
  await act(async () => {});
  return view.container;
}

describe("DomainTitle", () => {
  it("shows a lead of one domain its name as the heading, with no picker", async () => {
    const container = await mount([DOMAINS[0]], "d1");
    expect(container.querySelector("h1")!.textContent).toBe("Design");
    expect(container.querySelector("button")).toBeNull();
  });

  it("makes the heading a domain picker for a lead of several, showing the open domain", async () => {
    const container = await mount(DOMAINS, "d2");
    const trigger = container.querySelector<HTMLButtonElement>('h1 button[aria-label="Domain"]')!;
    expect(trigger.textContent).toBe("Engineering");
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });

  it("lists every domain, however many there are", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, name: `Domain ${i}` }));
    const container = await mount(many, "d0");
    click(container.querySelector('button[aria-label="Domain"]')!);
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(12);
  });

  it("switches domain in the URL and drops the cycle, keeping other params", async () => {
    const container = await mount(DOMAINS, "d1", "/?domain=d1&cycle=c9&q=ada");
    click(container.querySelector('button[aria-label="Domain"]')!);
    const product = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("Product"))!;
    click(product);
    await act(async () => {});
    const params = new URLSearchParams(container.querySelector("output")!.textContent!);
    expect(params.get("domain")).toBe("d3");
    expect(params.has("cycle")).toBe(false);
    expect(params.get("q")).toBe("ada");
  });
});
