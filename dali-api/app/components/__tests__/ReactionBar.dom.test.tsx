// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReactionBar } from "../ReactionBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PALETTE = ["❤️", "🔥", "😂"] as const;

let container: HTMLDivElement;
let root: Root;
function mount(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(ui));
}
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

const button = (name: string) =>
  [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === name);
const panel = () => document.querySelector('[aria-label="Add reaction"][role="dialog"]') as HTMLElement | null;

describe("ReactionBar", () => {
  it("shows a chip per reaction and toggles it on click", () => {
    const onReact = vi.fn();
    mount(
      <ReactionBar
        reactions={[{ emoji: "🔥", count: 2, mine: true }]}
        palette={PALETTE}
        onReact={onReact}
      />,
    );
    const chip = button("🔥 2")!;
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    act(() => chip.click());
    expect(onReact).toHaveBeenCalledWith("🔥");
  });

  it("opens the picker on a real surface, not bare emoji over the page", () => {
    mount(<ReactionBar reactions={[]} palette={PALETTE} onReact={() => {}} />);
    const trigger = container.querySelector('button[aria-label="Add reaction"]') as HTMLButtonElement;
    expect(trigger.className).toContain("rounded-full");
    act(() => trigger.click());
    const p = panel()!;
    expect(p).not.toBeNull();
    for (const cls of ["bg-os-card", "border", "z-[60]"]) expect(p.className).toContain(cls);
    expect([...p.querySelectorAll("button")].map((b) => b.textContent)).toEqual([...PALETTE]);
  });

  it("reacts with the picked emoji and closes", () => {
    const onReact = vi.fn();
    mount(<ReactionBar reactions={[]} palette={PALETTE} onReact={onReact} />);
    act(() => (container.querySelector('button[aria-label="Add reaction"]') as HTMLButtonElement).click());
    const heart = [...panel()!.querySelectorAll("button")].find((b) => b.textContent === "❤️")!;
    act(() => heart.click());
    expect(onReact).toHaveBeenCalledWith("❤️");
    expect(panel()).toBeNull();
  });
});
