// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub, useParams } from "react-router";
import { OfferingCatalog, type CatalogOffering } from "./OfferingCatalog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function offering(
  id: string,
  title: string,
  type: CatalogOffering["type"],
): CatalogOffering {
  const soon = new Date(Date.now() + 7 * 86_400_000);
  return {
    id,
    type,
    title,
    iconEmoji: null,
    status: "Published",
    capacity: 20,
    approvedCount: 0,
    requiresReview: type === "Miniseries",
    registrationOpensAt: new Date(Date.now() - 86_400_000),
    registrationClosesAt: soon,
    startsAt: soon,
    endsAt: new Date(Date.now() + 30 * 86_400_000),
    closedOutAt: null,
    sessionCount: 2,
    instructorNames: [],
    instructors: [],
    myStatus: null,
  };
}

const OFFERINGS = [
  offering("m1", "Intro to React", "Miniseries"),
  offering("w1", "Figma Crash Course", "Workshop"),
];

function DetailStub() {
  const { offeringId } = useParams();
  return createElement("h1", { "data-testid": "detail" }, offeringId);
}

function mountCatalog() {
  const Stub = createRoutesStub([
    {
      path: "/portal/education",
      Component: () =>
        createElement(OfferingCatalog, {
          offerings: OFFERINGS,
          to: (id: string) => `/portal/education/${id}`,
        }),
    },
    // Clicking a card navigates here. The stub only has to prove which
    // offering was opened, so it renders the id and nothing else.
    {
      path: "/portal/education/:offeringId",
      Component: DetailStub,
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(Stub, { initialEntries: ["/portal/education"] })));
}

function click(el: Element | null | undefined, what: string) {
  if (!el) throw new Error(`no ${what}`);
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// A card is the whole tile, so match it by its href rather than its text — the
// tile also contains the type badge and the meta rows.
function clickCard(id: string) {
  click(
    container.querySelector(`a[href="/portal/education/${id}"]`),
    `card ${id}`,
  );
}

function clickFilter(label: string) {
  const group = container.querySelector('[aria-label="Filter by type"]');
  const btn = [...(group?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent?.trim() === label,
  );
  click(btn, `filter "${label}"`);
}

function openedOfferingId(): string | null {
  return (
    container.querySelector('[data-testid="detail"]')?.textContent?.trim() ?? null
  );
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("OfferingCatalog selection", () => {
  // Clicking a card used to open a side pane beside the grid. It now leaves the
  // catalog for the offering's own student detail route.
  it("navigates to the clicked offering's detail page", () => {
    mountCatalog();
    expect(openedOfferingId()).toBeNull();
    clickCard("w1");
    expect(openedOfferingId()).toBe("w1");
  });

  it("renders no detail pane beside the grid", () => {
    mountCatalog();
    clickFilter("Workshops");
    expect(container.querySelector("aside")).toBeNull();
  });
});
