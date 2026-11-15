// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { renderDom } from "~/test-utils/render";
import { ParticipantPicker } from "../scheduling";

const users = [
  { id: "u1", firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@example.edu" },
  { id: "u2", firstName: "Grace", lastName: "Hopper", daliEmail: "grace@example.edu" },
];

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const options = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button[role='option']"));

function mount(over: Partial<Parameters<typeof ParticipantPicker>[0]> = {}) {
  const onChangeUsers = vi.fn();
  const onChangeGuestEmails = vi.fn();
  const view = renderDom(
    <ParticipantPicker
      users={users}
      groups={[]}
      selectedUserIds={[]}
      selectedGroupIds={[]}
      onChangeUsers={onChangeUsers}
      onChangeGroups={() => {}}
      usersById={new Map(users.map((u) => [u.id, u]))}
      groupsById={new Map()}
      resolvedCount={0}
      onChangeGuestEmails={onChangeGuestEmails}
      {...over}
    />,
  );
  const input = view.container.querySelector<HTMLInputElement>("input[role='combobox']")!;
  return { ...view, input, onChangeUsers, onChangeGuestEmails };
}

describe("ParticipantPicker", () => {
  it("filters members by name or email and adds one with Enter", () => {
    const { input, onChangeUsers } = mount();
    act(() => input.focus());
    typeInto(input, "hopper");
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining("Grace Hopper")]);
    typeInto(input, "ada@");
    expect(options()[0].textContent).toContain("ada@example.edu");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onChangeUsers).toHaveBeenCalledWith(["u1"]);
  });

  it("offers a typed address as a guest invite", () => {
    const { input, onChangeGuestEmails } = mount();
    act(() => input.focus());
    typeInto(input, "guest@example.org");
    expect(options()[0].textContent).toContain("Invite guest@example.org");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onChangeGuestEmails).toHaveBeenCalledWith(["guest@example.org"]);
  });

  it("peels the last chip with Backspace on an empty query", () => {
    const { input, onChangeUsers } = mount({ selectedUserIds: ["u1", "u2"] });
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    });
    expect(onChangeUsers).toHaveBeenCalledWith(["u1"]);
  });
});
