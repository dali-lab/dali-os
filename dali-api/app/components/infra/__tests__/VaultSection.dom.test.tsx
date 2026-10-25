// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VaultSection, type VaultActions } from "../VaultSection";
import type { ProjectVault } from "~/lib/infra/vault-scope";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const vault: ProjectVault = {
  group: { id: "g1", name: "Ultrasound", externalId: "dali-project:p1" },
  members: [
    { id: "m2", email: "alan@example.edu", name: null, status: 0, type: 2, twoFactorEnabled: false, staffed: false },
    { id: "m1", email: "ada@example.edu", name: "Ada", status: 1, type: 2, twoFactorEnabled: true, staffed: true },
    { id: "m3", email: "joan@example.edu", name: null, status: -1, type: 2, twoFactorEnabled: true, staffed: true },
  ],
  collections: [
    { id: "c1", externalId: "ultrasound-secrets", itemCount: 4, recentUses: 9 },
    { id: "c2abcdefgh", externalId: null, itemCount: 0, recentUses: null },
  ],
  missing: [{ userId: "u5", name: "Katherine", email: "katherine@example.edu" }],
  noEmail: [{ userId: "u6", name: "Mary", email: null }],
  awaitingConfirm: 1,
};

let root: Root | null = null;
let container: HTMLDivElement;
function render(actions?: VaultActions, v: ProjectVault = vault) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(VaultSection, { vault: v, membersUrl: "https://vault.example.edu/#/m", actions })));
}
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

const text = () => container.textContent ?? "";
const button = (label: string, row?: string) => {
  const scope = row
    ? Array.from(container.querySelectorAll("tr")).find((tr) => tr.textContent?.includes(row))!
    : container;
  return Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)!;
};

describe("VaultSection", () => {
  it("summarizes the group against staffing", () => {
    render();
    expect(text()).toContain("Vaultwarden · Ultrasound");
    expect(text()).toContain("Staffed but not in the group: Katherine.");
    expect(text()).toContain("1 member is no longer staffed.");
    expect(text()).toContain("No DALI email, so not synced: Mary.");
    expect(text()).toContain("1 person is waiting to be confirmed");
  });

  it("links confirmation to the web vault", () => {
    render();
    expect(container.querySelector('a[href="https://vault.example.edu/#/m"]')).not.toBeNull();
  });

  it("shows each member's status, 2FA, and whether they're staffed", () => {
    render();
    const alan = Array.from(container.querySelectorAll("tr")).find((tr) => tr.textContent?.includes("alan@"))!;
    expect(alan.textContent).toContain("invited");
    expect(alan.textContent).toContain("off");
    expect(alan.textContent).toContain("not staffed");
    expect(text()).toContain("needs confirm");
    expect(text()).toContain("revoked");
  });

  it("labels collections and says when events are off", () => {
    render();
    expect(text()).toContain("ultrasound-secrets");
    expect(text()).toContain("Collection c2abcdef");
    expect(text()).toContain("Events off");
  });

  it("is read-only without actions", () => {
    render();
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("wires the console actions", () => {
    const actions = { busy: false, sync: vi.fn(), remove: vi.fn(), member: vi.fn() };
    render(actions);
    act(() => button("Add 1 staffed person").click());
    expect(actions.sync).toHaveBeenCalled();
    act(() => button("Remove", "alan@").click());
    expect(actions.remove).toHaveBeenCalledWith("alan@example.edu");
    act(() => button("Re-invite", "alan@").click());
    expect(actions.member).toHaveBeenCalledWith("m2", "reinvite");
    act(() => button("Restore", "joan@").click());
    expect(actions.member).toHaveBeenCalledWith("m3", "restore");
    act(() => button("Revoke", "ada@").click());
    expect(actions.member).toHaveBeenCalledWith("m1", "revoke");
  });

  it("disables sync when nobody is missing", () => {
    render({ busy: false, sync: vi.fn(), remove: vi.fn(), member: vi.fn() }, { ...vault, missing: [] });
    expect(button("Add 0 staffed people").disabled).toBe(true);
  });
});
