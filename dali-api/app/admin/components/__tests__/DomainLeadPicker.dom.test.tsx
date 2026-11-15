// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { renderDom, click } from "~/test-utils/render";

const submit = vi.hoisted(() => vi.fn());
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useFetcher: () => ({ submit, state: "idle", Form: "form" }),
  };
});
vi.mock("~/components/ui/dialog", () => ({
  useDialog: () => ({ confirm: vi.fn() }),
  useConfirmSubmit: () => vi.fn(),
}));

import { DomainLeadPicker, type Member } from "../admin-shared";

const member = {
  id: "u1",
  firstName: "Ada",
  lastName: "Lovelace",
  daliEmail: "ada@example.edu",
  domainLeadAssignments: [{ id: "a1", domain: { id: "d1", name: "Design" } }],
} as unknown as Member;
const domains = [
  { id: "d1", name: "Design" },
  { id: "d2", name: "Engineering" },
  { id: "d3", name: "Product" },
];

function mount() {
  return renderDom(
    <DomainLeadPicker member={member} domains={domains} existingAssignments={member.domainLeadAssignments} />,
  );
}
const trigger = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("button")).find((b) => b.textContent?.includes("+ Domain"))!;
const rows = () => Array.from(document.querySelectorAll<HTMLElement>("[role='menuitem']"));

describe("DomainLeadPicker", () => {
  it("offers only unassigned domains and submits the chosen one, then closes", () => {
    submit.mockClear();
    const { container } = mount();
    click(trigger(container));
    expect(rows().map((r) => r.textContent)).toEqual(["Engineering", "Product"]);
    click(rows()[1]);
    expect(submit).toHaveBeenCalledWith(
      { intent: "add-domain-lead", userId: "u1", domainId: "d3" },
      { method: "post" },
    );
    expect(rows()).toHaveLength(0);
  });

  it("opens from the keyboard, moves with arrows and closes on Escape", () => {
    const { container } = mount();
    const btn = trigger(container);
    act(() => btn.focus());
    act(() => {
      btn.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(rows()).toHaveLength(2);
    const menu = document.querySelector<HTMLElement>("[role='menu']")!;
    act(() => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(rows()).toHaveLength(0);
  });

  it("hides the trigger when every domain is assigned", () => {
    const { container } = renderDom(
      <DomainLeadPicker
        member={member}
        domains={[domains[0]]}
        existingAssignments={member.domainLeadAssignments}
      />,
    );
    expect(container.textContent).not.toContain("+ Domain");
  });
});
