// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { renderDom, click } from "~/test-utils/render";

vi.mock("react-router", () => ({ useRevalidator: () => ({ revalidate: vi.fn() }) }));

import { AddMemberFlow } from "../AddMemberFlow";

const members = [
  { userId: "u1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.edu" },
] as never;

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const options = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button[role='option']"));

describe("AddMemberFlow person search", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ results: [{ userId: "u2", name: "Grace Hopper", email: "grace@example.edu" }] }),
      }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("lists on-board matches first, then off-board server matches, and picking one opens step two", async () => {
    const onStaffToProject = vi.fn();
    const { container } = renderDom(
      <AddMemberFlow
        cycleId="c1"
        projects={[{ id: "p1", name: "Atlas" }]}
        members={members}
        assignments={[]}
        domains={[]}
        onStaffToProject={onStaffToProject}
        onExternalMentorAdded={() => {}}
      />,
    );
    click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Add member"))!);
    const input = document.querySelector<HTMLInputElement>("input[role='combobox']")!;
    typeInto(input, "a");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetch).not.toHaveBeenCalled();

    typeInto(input, "ada");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain("q=ada");
    expect(options()[0].textContent).toContain("Ada Lovelace");
    expect(options()[0].textContent).toContain("On board");
    expect(options().some((o) => o.textContent?.includes("Grace Hopper"))).toBe(true);

    click(options()[0]);
    expect(container.textContent).toContain("Staff on a project");
    click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Atlas"))!);
    expect(onStaffToProject).toHaveBeenCalledWith("u1", "p1");
  });
});
