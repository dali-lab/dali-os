// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { DialogProvider } from "~/components/ui/dialog";
import { ContactsTab } from "../ContactsTab";
import { ProjectsTab } from "../ProjectsTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function mount(ui: ReactElement) {
  const Stub = createRoutesStub([{ path: "/", Component: () => ui, loader: () => null }]);
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(DialogProvider, null, createElement(Stub, { initialEntries: ["/"] }))));
  await act(async () => {});
  return container;
}

const press = (el: Element) => act(() => void (el as HTMLElement).click());
const button = (label: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);
const intents = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[name="intent"]')).map((i) => i.value);
const text = () => document.body.textContent ?? "";

const ada = { id: "c1", name: "Ada Lovelace", email: "ada@example.edu", title: "CTO", userId: "u1" };
const grace = { id: "c2", name: "", email: "grace@example.edu", title: null, userId: null };
const orgBase = { id: "o1", name: "Example Co", isIndividual: false, primaryContactId: "m1", memberships: [{ id: "m1", role: "Lead", contact: ada }], projects: [] };

const contactsProps = (over: Record<string, unknown> = {}) =>
  ({
    org: orgBase,
    pendingInvites: [],
    otherOrgs: [{ id: "o2", name: "Other Co" }],
    allContacts: [ada, grace],
    canEdit: true,
    ...over,
  }) as never;

describe("ContactsTab", () => {
  it("lists members with their primary marker and the member actions only for editors", async () => {
    await mount(createElement(ContactsTab, contactsProps()));
    expect(text()).toContain("Ada Lovelace");
    expect(text()).toContain("Primary");
    expect(text()).toContain("ada@example.edu · CTO · Lead");
    expect(button("Move")).toBeTruthy();
    expect(button("Remove")).toBeTruthy();
    expect(button("Set primary")).toBeUndefined();
  });

  it("hides every editing control from a viewer", async () => {
    await mount(createElement(ContactsTab, contactsProps({ canEdit: false })));
    for (const label of ["Add existing contact", "Invite member", "Move", "Remove"]) expect(button(label)).toBeUndefined();
  });

  it("opens the invite form and the add-contact form on demand", async () => {
    await mount(createElement(ContactsTab, contactsProps()));
    expect(intents()).not.toContain("invite");
    expect(intents()).not.toContain("member-add");
    press(button("Invite member")!);
    expect(intents()).toContain("invite");
    press(button("Add existing contact")!);
    expect(intents()).toContain("member-add");
    press(button("Invite member")!);
    expect(intents()).not.toContain("invite");
  });

  it("opens the move form for one member at a time", async () => {
    await mount(
      createElement(
        ContactsTab,
        contactsProps({ org: { ...orgBase, memberships: [{ id: "m1", role: null, contact: ada }, { id: "m2", role: null, contact: grace }] } }),
      ),
    );
    const moves = Array.from(document.querySelectorAll('button[aria-label="Move"]'));
    press(moves[0]);
    expect(intents().filter((i) => i === "member-move")).toHaveLength(1);
    press(moves[1]);
    expect(intents().filter((i) => i === "member-move")).toHaveLength(1);
    press(button("Cancel")!);
    expect(intents()).not.toContain("member-move");
  });

  it("offers Move only when there is another organization, and names an email-only member by email", async () => {
    await mount(
      createElement(
        ContactsTab,
        contactsProps({ otherOrgs: [], org: { ...orgBase, primaryContactId: null, memberships: [{ id: "m2", role: null, contact: grace }] } }),
      ),
    );
    expect(button("Move")).toBeUndefined();
    expect(text()).toContain("grace@example.edu");
    expect(button("Set primary")).toBeTruthy();
  });

  it("shows pending invites with a revoke action, and the empty state without any", async () => {
    const view = await mount(
      createElement(
        ContactsTab,
        contactsProps({ org: { ...orgBase, memberships: [] }, pendingInvites: [{ id: "i1", email: "new@example.edu", displayRole: "CFO", expiresAt: new Date("2026-12-01") }] }),
      ),
    );
    expect(text()).toContain("new@example.edu");
    expect(text()).toContain("Invited");
    expect(button("Revoke invite")).toBeTruthy();
    act(() => root!.unmount());
    view.remove();
    await mount(createElement(ContactsTab, contactsProps({ org: { ...orgBase, memberships: [] } })));
    expect(text()).toContain("No members yet. Invite the first contact.");
  });

  it("shows an individual's one contact with a sign-in link instead of the member list", async () => {
    await mount(createElement(ContactsTab, contactsProps({ org: { ...orgBase, isIndividual: true } })));
    expect(text()).toContain("Contact");
    expect(button("Invite member")).toBeUndefined();
    expect(button("Resend sign-in link")).toBeTruthy();
    expect(text()).toContain("Active");
  });
});

const project = (over: Record<string, unknown> = {}) => ({
  id: "pp1",
  active: true,
  startedAt: new Date("2026-01-05"),
  endedAt: null,
  project: { id: "p1", name: "Site rebuild", iconEmoji: null, status: "Active", maintenancePlans: [] },
  ...over,
});
const projectsProps = (over: Record<string, unknown> = {}) =>
  ({ org: { ...orgBase, projects: [project()] }, linkableProjects: [{ id: "p9", name: "Another" }], canEdit: true, ...over }) as never;

describe("ProjectsTab", () => {
  it("lists linked projects with their state", async () => {
    await mount(createElement(ProjectsTab, projectsProps({ org: { ...orgBase, projects: [project(), project({ id: "pp2", active: false, endedAt: new Date("2026-02-01"), project: { id: "p2", name: "Old app", iconEmoji: null, status: "Archived", maintenancePlans: [] } })] } })));
    expect(text()).toContain("Site rebuild");
    expect(text()).toContain("Active");
    expect(text()).toContain("Archived");
    expect(text()).toContain("Ended");
  });

  it("says when nothing is linked", async () => {
    await mount(createElement(ProjectsTab, projectsProps({ org: { ...orgBase, projects: [] } })));
    expect(text()).toContain("No linked projects.");
  });

  it("opens the link form only when there is something to link, and only for editors", async () => {
    await mount(createElement(ProjectsTab, projectsProps()));
    expect(intents()).not.toContain("project-link");
    press(button("Link project")!);
    expect(intents()).toContain("project-link");
    act(() => root!.unmount());
    document.body.innerHTML = "";
    await mount(createElement(ProjectsTab, projectsProps({ linkableProjects: [] })));
    expect(button("Link project")).toBeUndefined();
    act(() => root!.unmount());
    document.body.innerHTML = "";
    await mount(createElement(ProjectsTab, projectsProps({ canEdit: false })));
    expect(button("Link project")).toBeUndefined();
    expect(button("Manage")).toBeUndefined();
  });

  it("keeps End and Unlink behind Manage, and offers End only on a partnership that has not ended", async () => {
    await mount(createElement(ProjectsTab, projectsProps()));
    expect(intents()).not.toContain("project-unlink");
    press(button("Manage")!);
    expect(intents()).toEqual(expect.arrayContaining(["project-end", "project-unlink"]));
    press(button("Manage")!);
    expect(intents()).not.toContain("project-unlink");
    act(() => root!.unmount());
    document.body.innerHTML = "";
    await mount(createElement(ProjectsTab, projectsProps({ org: { ...orgBase, projects: [project({ active: false, endedAt: new Date("2026-02-01") })] } })));
    press(button("Manage")!);
    expect(intents()).toContain("project-unlink");
    expect(intents()).not.toContain("project-end");
  });
});
