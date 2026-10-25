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

const domain = (id: string, name: string): AccessDomain => ({ id, name, active: true, isSystem: false, usage: [] });
const member = (id: string, name: string, domainId: string): AccessMember => ({
  id,
  name,
  email: null,
  photoUrl: null,
  isLabMember: true,
  isAlumni: false,
  access: "none",
  envAdmin: false,
  coreTitles: [],
  domains: [{ domainId, level: "P1", eligibilityId: null, leadAssignmentId: null }],
  otherLeads: [],
});

const data = {
  members: [member("u1", "Ada Lovelace", "d-web"), member("u2", "Grace Hopper", "d-ios")],
  domains: [domain("d-web", "Web"), domain("d-ios", "iOS")],
  term: "26F",
  viewerIsAdmin: false,
};

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

const toggle = () => container.querySelector<HTMLButtonElement>("#domains-heading button")!;
const cards = () => container.querySelector<HTMLElement>("#domain-cards")!;
const card = (name: string) =>
  [...cards().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(name))!;

describe("RolesDomainsPage domain cards", () => {
  it("start collapsed", () => {
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().getAttribute("aria-controls")).toBe("domain-cards");
    expect(cards().hidden).toBe(true);
  });

  it("expand and collapse from the heading", async () => {
    await act(async () => toggle().click());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(cards().hidden).toBe(false);
    await act(async () => toggle().click());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(cards().hidden).toBe(true);
  });

  it("keep the picked domain's filter when collapsed", async () => {
    await act(async () => toggle().click());
    await act(async () => card("iOS").click());
    await act(async () => toggle().click());
    expect(container.textContent).toContain("Showing people in iOS");
    expect(container.textContent).toContain("Grace Hopper");
    expect(container.textContent).not.toContain("Ada Lovelace");
  });
});
