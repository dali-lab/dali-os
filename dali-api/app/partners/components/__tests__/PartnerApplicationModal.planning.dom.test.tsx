// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { DialogProvider } from "~/components/ui/dialog";

vi.mock("../application/PropertyRail", () => ({ PropertyRail: () => null }));
vi.mock("../application/StageActions", () => ({ StageActions: () => null }));
vi.mock("../application/ActivityTab", () => ({ ActivityTab: () => createElement("p", null, "Activity feed") }));
vi.mock("../application/DetailsTab", () => ({ DetailsTab: () => createElement("p", null, "Details body") }));

import { PartnerApplicationModal } from "../PartnerApplicationModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const detail = {
  application: {
    id: "a1",
    title: "Immersive Admissions Tour",
    iconEmoji: null,
    stage: "Deciding",
    resultingProjectId: null,
    applicant: { id: "c1", name: "Kathryn Bezella" },
    partner: null,
    domains: [],
  },
  activities: [],
  actorNames: {},
  emailThreads: [],
};

let container: HTMLDivElement;
let root: Root;

async function mount(props: { planningTab?: React.ReactNode; projectId?: string | null }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(
          DialogProvider,
          null,
          createElement(PartnerApplicationModal, {
            card: { id: "a1" },
            canEdit: true,
            domainOptions: [],
            termOptions: [],
            onClose: () => {},
            onChanged: () => {},
            ...props,
          }),
        ),
      ),
    ),
  );
  await act(async () => {});
}

const tabLabels = () =>
  Array.from(document.body.querySelectorAll("[aria-label='Application sections'] button")).map((b) => b.textContent?.trim());

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(detail), { headers: { "content-type": "application/json" } })),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("PartnerApplicationModal opened from Planning", () => {
  it("leads with a Planning tab showing the planning content, ahead of the application's own tabs", async () => {
    await mount({ planningTab: createElement("p", null, "Planning body") });
    expect(tabLabels()[0]).toBe("Planning");
    expect(tabLabels()).toContain("Details");
    expect(document.body.textContent).toContain("Planning body");
    expect(document.body.textContent).not.toContain("Activity feed");
  });

  it("switches from the Planning tab to the application's details", async () => {
    await mount({ planningTab: createElement("p", null, "Planning body") });
    await act(async () =>
      Array.from(document.body.querySelectorAll<HTMLButtonElement>("[aria-label='Application sections'] button"))
        .find((b) => b.textContent?.trim() === "Details")!
        .click(),
    );
    expect(document.body.textContent).toContain("Details body");
    expect(document.body.textContent).not.toContain("Planning body");
  });

  it("links to the project page when the application belongs to a project", async () => {
    await mount({ planningTab: createElement("p", null, "Planning body"), projectId: "p9" });
    expect(document.body.querySelector("a[aria-label='Open project']")?.getAttribute("href")).toBe("/projects/p9");
  });
});

describe("PartnerApplicationModal opened from the board", () => {
  it("has no Planning tab or project link and opens on Activity", async () => {
    await mount({});
    expect(tabLabels()).not.toContain("Planning");
    expect(document.body.textContent).toContain("Activity feed");
    expect(document.body.querySelector("a[aria-label='Open project']")).toBeNull();
  });
});
