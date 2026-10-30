// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { DialogProvider } from "~/components/ui/dialog";
import { ToastProvider } from "~/components/ui/toast";
import { RolesDomainsPage } from "../RolesDomainsPage";
import type { AccessDomain, AccessMember } from "~/core/lib/access";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const domains: AccessDomain[] = [
  { id: "d-web", name: "Web", active: true, isSystem: false, usage: [] },
  { id: "d-ios", name: "iOS", active: true, isSystem: false, usage: [] },
];
const member = (n: number, domainId: string, extra: Partial<AccessMember> = {}): AccessMember => ({
  id: `u${n}`,
  name: `Ada Person${String(n).padStart(3, "0")}`,
  email: `ada${n}@example.edu`,
  photoUrl: null,
  isLabMember: true,
  isAlumni: false,
  access: "none",
  envAdmin: false,
  coreTitles: [],
  domains: [{ domainId, level: "P1", eligibilityId: null, leadAssignmentId: null }],
  otherLeads: [],
  ...extra,
});

// 60 web members (one an alum), 30 ios members
const members = [
  ...Array.from({ length: 60 }, (_, i) => member(i, "d-web", i === 59 ? { isAlumni: true } : {})),
  ...Array.from({ length: 30 }, (_, i) => member(100 + i, "d-ios")),
];
const data = { members, domains, term: "26F", viewerIsAdmin: false };

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () =>
        createElement(ToastProvider, null, createElement(DialogProvider, null, createElement(RolesDomainsPage, { data }))),
    },
  ]);
  root = createRoot(container);
  await act(async () => root.render(createElement(Stub)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const rows = () => container.querySelectorAll("tbody tr");
const loadMore = () =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === "Load more") as HTMLButtonElement | undefined;

describe("RolesDomainsPage roster slice", () => {
  it("renders 50 of 90 rows and Load more reveals the rest, alumni included", async () => {
    expect(rows()).toHaveLength(50);
    expect(container.textContent).toContain("Showing 50 of 90");
    await act(async () => loadMore()!.click());
    expect(rows()).toHaveLength(90);
    expect(container.textContent).toContain("Alumni");
    expect(loadMore()).toBeUndefined();
  });

  it("keeps the role tab counts on the full set", () => {
    expect(container.textContent).toContain("Everyone");
    expect(container.textContent).toMatch(/Everyone\s*90/);
  });

  it("returns to the first slice when the domain filter changes", async () => {
    await act(async () => loadMore()!.click());
    expect(rows()).toHaveLength(90);
    await act(async () => container.querySelector<HTMLButtonElement>("#domains-heading button")!.click());
    const webCard = [...container.querySelectorAll<HTMLButtonElement>("#domain-cards button")].find((b) =>
      b.textContent?.includes("Web"),
    )!;
    await act(async () => webCard.click());
    expect(rows()).toHaveLength(50);
    expect(container.textContent).toContain("Showing 50 of 60");
  });
});
