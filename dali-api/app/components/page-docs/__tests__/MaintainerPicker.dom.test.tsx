// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { renderDom, click } from "~/test-utils/render";

const search = vi.hoisted(() => vi.fn());
vi.mock("~/components/doc/schema/mention", () => ({ searchMentionableUsers: search }));
vi.mock("~/components/doc", () => ({ DocEditor: () => null }));
vi.mock("~/components/collab/CommentsRail", () => ({ CommentsRail: () => null }));
vi.mock("~/lib/upload-client", () => ({ uploadFileToS3: vi.fn() }));

import { MaintainerPicker } from "../PageDocPage";

const users = [
  { id: "u1", name: "Ada Lovelace", handle: "ada" },
  { id: "u2", name: "Grace Hopper", handle: "grace" },
];

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("MaintainerPicker", () => {
  beforeEach(() => {
    search.mockReset();
    search.mockResolvedValue(users);
  });

  it("shows the current maintainer, assigns a searched member and clears", async () => {
    const onSelect = vi.fn();
    const { container } = renderDom(<MaintainerPicker currentLabel="Ada Lovelace" onSelect={onSelect} />);
    await flush();
    const input = container.querySelector<HTMLInputElement>("input[role='combobox']")!;
    expect(input.value).toBe("Ada Lovelace");

    act(() => input.focus());
    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>("button[role='option']"));
    expect(rows.map((r) => r.textContent)).toEqual([
      "ALAda Lovelace",
      "ALAda Lovelace@ada",
      "GHGrace Hopper@grace",
    ]);
    click(rows[2]);
    expect(onSelect).toHaveBeenLastCalledWith(users[1]);
    expect(container.querySelector<HTMLInputElement>("input[role='combobox']")!.value).toBe("Grace Hopper");

    click(Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Clear")!);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("searches as you type", async () => {
    const { container } = renderDom(<MaintainerPicker currentLabel={null} onSelect={() => {}} />);
    await flush();
    const input = container.querySelector<HTMLInputElement>("input[role='combobox']")!;
    act(() => input.focus());
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "gra");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    expect(search).toHaveBeenLastCalledWith("gra");
  });
});
