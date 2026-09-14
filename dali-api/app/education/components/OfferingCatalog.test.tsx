// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
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
    // The pane loads the offering's detail route; an empty payload is enough
    // here, since these cases are about which offering the pane is showing.
    {
      path: "/portal/education/:offeringId",
      Component: () => null,
      loader: () => ({
        descriptionHtml: "",
        canApply: false,
        myStatus: null,
        offering: { sessions: [] },
      }),
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

function paneTitle(): string | null {
  const pane = container.querySelector("aside");
  return pane?.querySelector("h2")?.textContent?.trim() ?? null;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("OfferingCatalog selection", () => {
  it("opens the detail pane for the clicked offering", () => {
    mountCatalog();
    expect(paneTitle()).toBeNull();
    clickCard("w1");
    expect(paneTitle()).toBe("Figma Crash Course");
  });

  // Regression: the selection used to be resolved against the *filtered* list,
  // so switching the type filter hid the pane and switching back resurrected
  // it. Changing what the grid shows must not disturb what the pane shows.
  it("keeps the pane open when a filter hides the selected card", () => {
    mountCatalog();
    clickCard("w1");
    expect(paneTitle()).toBe("Figma Crash Course");

    clickFilter("Miniseries");
    expect(paneTitle()).toBe("Figma Crash Course");

    clickFilter("All");
    expect(paneTitle()).toBe("Figma Crash Course");
  });

  it("closes only when the pane is closed", () => {
    mountCatalog();
    clickCard("m1");
    expect(paneTitle()).toBe("Intro to React");

    click(
      container.querySelector('button[aria-label="Close details"]'),
      "close button",
    );
    expect(paneTitle()).toBeNull();
  });
});
