// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { act } from "react";
import { renderDom } from "~/test-utils/render";
import { PersonPicker, type PersonOption } from "./PersonPicker";

const people: PersonOption[] = [
  { id: "u1", name: "Ada Lovelace", secondary: "ada@example.edu" },
  { id: "u2", name: "Grace Hopper", secondary: "grace@example.edu" },
];

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const options = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button[role='option']"));
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

function Multi({ onChange }: { onChange?: (ids: string[]) => void }) {
  const [ids, setIds] = useState<string[]>([]);
  return (
    <PersonPicker
      mode="multi"
      people={people}
      values={ids}
      name="userIds"
      ariaLabel="People"
      onChange={(next) => {
        setIds(next);
        onChange?.(next);
      }}
    />
  );
}

describe("PersonPicker multi", () => {
  it("filters by last name and by email, and toggles picks into chips and hidden inputs", () => {
    const onChange = vi.fn();
    const { container } = renderDom(<Multi onChange={onChange} />);
    click(container.querySelector("button[aria-label='People']")!);
    typeInto(document.querySelector<HTMLInputElement>("input[role='combobox']")!, "hopper");
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining("Grace Hopper")]);
    typeInto(document.querySelector<HTMLInputElement>("input[role='combobox']")!, "ada@example");
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining("Ada Lovelace")]);
    click(options()[0]);
    expect(onChange).toHaveBeenLastCalledWith(["u1"]);
    expect(container.querySelector("input[type='hidden'][name='userIds']")).toHaveProperty("value", "u1");
    click(options()[0]);
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("does not open when disabled", () => {
    const { container } = renderDom(
      <PersonPicker mode="multi" people={people} values={[]} onChange={() => {}} ariaLabel="People" disabled />,
    );
    click(container.querySelector("button[aria-label='People']")!);
    expect(options()).toHaveLength(0);
  });
});

function Single({ onChange, onQueryChange }: { onChange?: (id: string | null) => void; onQueryChange?: (q: string) => void }) {
  const [id, setId] = useState<string | null>("u1");
  return (
    <PersonPicker
      people={people}
      value={id}
      ariaLabel="Maintainer"
      clearLabel="Clear"
      onQueryChange={onQueryChange}
      onChange={(next) => {
        setId(next);
        onChange?.(next);
      }}
    />
  );
}

describe("PersonPicker single", () => {
  it("shows the current person, replaces it on pick and reports queries", () => {
    const onChange = vi.fn();
    const onQueryChange = vi.fn();
    const { container } = renderDom(<Single onChange={onChange} onQueryChange={onQueryChange} />);
    const input = container.querySelector<HTMLInputElement>("input[role='combobox']")!;
    expect(input.value).toBe("Ada Lovelace");
    act(() => input.focus());
    typeInto(input, "gra");
    expect(onQueryChange).toHaveBeenLastCalledWith("gra");
    click(options()[0]);
    expect(onChange).toHaveBeenLastCalledWith("u2");
    expect(container.querySelector<HTMLInputElement>("input[role='combobox']")!.value).toBe("Grace Hopper");
  });

  it("keeps the label of a pick that a later search no longer returns, and clears", () => {
    const onChange = vi.fn();
    const { container, rerender } = renderDom(
      <PersonPicker people={people} value="u2" onChange={onChange} clearLabel="Clear" selectedPerson={people[1]} />,
    );
    rerender(
      <PersonPicker people={[]} value="u2" onChange={onChange} clearLabel="Clear" selectedPerson={people[1]} />,
    );
    expect(container.querySelector<HTMLInputElement>("input[role='combobox']")!.value).toBe("Grace Hopper");
    click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Clear")!);
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
