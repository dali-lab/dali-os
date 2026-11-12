// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoutesStub } from "react-router";
import { DialogProvider } from "~/components/ui/dialog";
import { renderDom } from "~/test-utils/render";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));

import HiringOnboarding from "../onboarding";

const row = {
  userId: "u1",
  name: "Ada Lovelace",
  photoUrl: null,
  domainKey: "design",
  role: "Designer",
  cycleId: "c1",
  cycleName: "Fall",
  startTermId: null,
  startTermCode: null,
  ownStartTermId: null,
  cycleTermSortKey: null,
  daliEmail: null,
  emailCreated: false,
  inSlack: false,
  figmaInvited: false,
  profileSubmitted: false,
};

describe("HiringOnboarding", () => {
  it("renders each member name as a link to their profile", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: HiringOnboarding,
        loader: () => ({
          cycles: [{ id: "c1", name: "Fall" }],
          selectedCycleId: "c1",
          domains: [],
          selectedDomain: null,
          rows: [row],
          allCycles: false,
          pillRoles: [],
          terms: [],
          startTermCandidates: [],
          hasUntermed: false,
          selectedTermId: null,
        }),
      },
    ]);
    const { container } = renderDom(createElement(DialogProvider, null, createElement(Stub, { initialEntries: ["/"] })));
    await act(async () => {});
    const link = container.querySelector<HTMLAnchorElement>('a[href="/members/u1"]');
    expect(link?.textContent).toBe("Ada Lovelace");
    vi.unstubAllGlobals();
  });
});
