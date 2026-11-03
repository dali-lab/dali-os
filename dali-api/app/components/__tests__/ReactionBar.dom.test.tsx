// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MAX_REACTION_EMOJI } from "~/lib/reactions";

const confirm = vi.hoisted(() => vi.fn());
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm }) }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));

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
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const button = (name: string) =>
  [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === name);
const panel = () => document.querySelector('[aria-label="Add reaction"][role="dialog"]') as HTMLElement | null;
const openPicker = () =>
  act(() => (container.querySelector('button[aria-label="Add reaction"]') as HTMLButtonElement).click());

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
    expect(chip.className).toContain("border-os-accent");
    act(() => chip.click());
    expect(onReact).toHaveBeenCalledWith("🔥");
  });

  it("gives a reaction you haven't made a border only on hover", () => {
    mount(
      <ReactionBar
        reactions={[{ emoji: "🔥", count: 1, mine: false }]}
        palette={PALETTE}
        onReact={() => {}}
      />,
    );
    const chip = button("🔥 1")!;
    expect(chip.className).toContain("border-transparent");
    expect(chip.className).toContain("hover:border-os-container-hi");
  });

  it("renders a custom emoji's image", () => {
    mount(
      <ReactionBar
        reactions={[{ emoji: ":parrot:", count: 1, mine: false, imageUrl: "/parrot.gif" }]}
        palette={PALETTE}
        onReact={() => {}}
      />,
    );
    expect(button(":parrot: 1")!.querySelector("img")!.getAttribute("src")).toBe("/parrot.gif");
  });

  it("falls back to the name for a deleted emoji, and only you can still toggle it", () => {
    const onReact = vi.fn();
    mount(
      <ReactionBar
        reactions={[
          { emoji: ":gone:", count: 2, mine: true, imageUrl: null },
          { emoji: ":lost:", count: 1, mine: false, imageUrl: null },
        ]}
        palette={PALETTE}
        onReact={onReact}
      />,
    );
    expect(button(":gone: 2")!.textContent).toBe(":gone:2");
    expect(button(":gone: 2")!.disabled).toBe(false);
    expect(button(":lost: 1")!.disabled).toBe(true);
  });

  it("hides the add chip at the emoji cap", () => {
    const reactions = Array.from({ length: MAX_REACTION_EMOJI }, (_, i) => ({
      emoji: `:e${i}:`,
      count: 1,
      mine: false,
    }));
    mount(<ReactionBar reactions={reactions} palette={PALETTE} onReact={() => {}} />);
    expect(button("Add reaction")).toBeUndefined();
  });

  it("opens the picker on a real surface, in the chips' shape", () => {
    mount(<ReactionBar reactions={[]} palette={PALETTE} onReact={() => {}} />);
    expect(button("Add reaction")!.className).toContain("h-6");
    openPicker();
    const p = panel()!;
    expect(p).not.toBeNull();
    for (const cls of ["bg-os-card", "border", "z-[60]"]) expect(p.className).toContain(cls);
    for (const emoji of PALETTE) {
      expect([...p.querySelectorAll("button")].some((b) => b.textContent === emoji)).toBe(true);
    }
  });

  // The panel's z-index beats the dialog layer, so a confirm opened behind an
  // open picker can't be clicked.
  it("closes the picker before asking to delete a custom emoji", async () => {
    confirm.mockReturnValue(new Promise(() => {}));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          emoji: [{ id: "e1", name: "parrot", imageUrl: "/p.gif", addedBy: "Ada", canDelete: true }],
        }),
      ),
    );
    mount(<ReactionBar reactions={[]} palette={PALETTE} onReact={() => {}} />);
    await act(async () => openPicker());
    await act(async () => {
      button(":parrot:")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    await act(async () => button("Delete emoji")!.click());
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: "destructive" }));
    expect(panel()).toBeNull();
  });

  it("reacts with the picked emoji and closes", () => {
    const onReact = vi.fn();
    mount(<ReactionBar reactions={[]} palette={PALETTE} onReact={onReact} />);
    openPicker();
    const heart = [...panel()!.querySelectorAll("button")].find((b) => b.textContent === "❤️")!;
    act(() => heart.click());
    expect(onReact).toHaveBeenCalledWith("❤️", undefined);
    expect(panel()).toBeNull();
  });
});
