// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MentionHoverCard } from "./MentionHoverCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function hover(userId: string, name: string) {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ member: { id: userId, name, handle: null, photoUrl: null } }) })),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(MentionHoverCard, { userId }, "@someone"));
  });
  const chip = container.firstElementChild as HTMLElement;
  await act(async () => {
    chip.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    chip.dispatchEvent(new Event("mouseenter"));
    await vi.advanceTimersByTimeAsync(300);
  });
  return container.querySelector('[role="tooltip"]');
}

describe("MentionHoverCard initials", () => {
  it("shows first and last initials of the member's name", async () => {
    const card = await hover("u-initials-1", "Ada Lovelace");
    expect(card?.textContent).toContain("AL");
  });

  it("shows a dot when the member has no name", async () => {
    const card = await hover("u-initials-2", "  ");
    expect(card?.querySelector("span")?.textContent).toBe("·");
  });
});
