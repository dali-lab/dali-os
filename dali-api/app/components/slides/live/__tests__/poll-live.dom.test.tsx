// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PollContext, PollBox, toggleChoice, type PollResult } from "~/components/slides/deck/content-render";
import type { RenderElement } from "~/components/slides/deck/snapshot";
import { PollLayer } from "../PollLayer";
import { PresenterPolls, pollsOnSlide } from "../PresenterPolls";
import { ReactionBar } from "../ReactionBar";
import { ReactionOverlay } from "../ReactionOverlay";
import { parseReaction } from "../useReactions";
import { REACTIONS, type PollsState } from "../polls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.useFakeTimers();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});
const render = (node: React.ReactElement) => act(() => root.render(node));
const click = (el: Element | null) => act(() => void (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));

const element = (poll: unknown): RenderElement =>
  ({ id: "poll1", kind: "poll", slot: null, z: 1, blocks: [], src: null, alt: null, textStyle: null, x: 0, y: 0, w: 960, h: 540, poll }) as never;
const SINGLE = { question: "Ship it?", options: ["Yes", "No", "Later"] };
const placed = { x: 0, y: 0, w: 960, h: 540, rot: 0 };
const result = (over: Partial<PollResult> = {}): PollResult => ({ counts: [3, 1, 0, 0, 0, 0], total: 4, mine: [], closed: false, ...over });
const Layer = PollLayer as unknown as React.FC<{ state: PollsState; onVote?: (id: string, c: number[]) => void; children?: React.ReactNode }>;
const options = () => [...container.querySelectorAll("[data-poll-option]")] as HTMLElement[];

describe("PollBox", () => {
  it("shows the question and options with no counts when there is no live context", () => {
    render(createElement(PollBox, { placed, element: element(SINGLE) }));
    expect(container.textContent).toContain("Ship it?");
    expect(options().map((o) => o.textContent)).toEqual(["Yes", "No", "Later"]);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("[data-poll-count]")).toBeNull();
  });

  it("shows counts and the total as a results view for someone who cannot vote", () => {
    render(createElement(Layer, { state: { active: true, polls: { poll1: result() } } }, createElement(PollBox, { placed, element: element(SINGLE) })));
    expect(options().map((o) => o.textContent)).toEqual(["Yes3", "No1", "Later0"]);
    expect(container.textContent).toContain("4 votes");
    expect(container.querySelector("button")).toBeNull();
  });

  it("lets a follower vote, sending the one choice", () => {
    const onVote = vi.fn();
    render(createElement(Layer, { state: { active: true, polls: { poll1: result() } }, onVote }, createElement(PollBox, { placed, element: element(SINGLE) })));
    click(options()[1]);
    expect(onVote).toHaveBeenCalledWith("poll1", [1]);
  });

  it("clears the vote when the chosen option is clicked again and marks it pressed", () => {
    const onVote = vi.fn();
    render(createElement(Layer, { state: { active: true, polls: { poll1: result({ mine: [1] }) } }, onVote }, createElement(PollBox, { placed, element: element(SINGLE) })));
    expect(options()[1].getAttribute("aria-pressed")).toBe("true");
    click(options()[1]);
    expect(onVote).toHaveBeenCalledWith("poll1", []);
  });

  it("toggles answers on a poll that takes several", () => {
    const onVote = vi.fn();
    const multi = { ...SINGLE, multi: true };
    render(createElement(Layer, { state: { active: true, polls: { poll1: result({ mine: [0] }) } }, onVote }, createElement(PollBox, { placed, element: element(multi) })));
    click(options()[2]);
    expect(onVote).toHaveBeenCalledWith("poll1", [0, 2]);
    click(options()[0]);
    expect(onVote).toHaveBeenLastCalledWith("poll1", []);
  });

  it("stops taking votes once voting is closed and says so", () => {
    const onVote = vi.fn();
    render(createElement(Layer, { state: { active: true, polls: { poll1: result({ closed: true }) } }, onVote }, createElement(PollBox, { placed, element: element(SINGLE) })));
    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("Voting closed");
  });

  it("lets a follower vote on a poll nobody has voted on yet", () => {
    const onVote = vi.fn();
    render(createElement(Layer, { state: { active: true, polls: {} }, onVote }, createElement(PollBox, { placed, element: element(SINGLE) })));
    click(options()[0]);
    expect(onVote).toHaveBeenCalledWith("poll1", [0]);
  });

  it("does not let a click on an option move the slide show", () => {
    const parent = vi.fn();
    const onVote = vi.fn();
    render(
      createElement(
        "div",
        { onClick: parent },
        createElement(Layer, { state: { active: true, polls: { poll1: result() } }, onVote }, createElement(PollBox, { placed, element: element(SINGLE) })),
      ),
    );
    click(options()[0]);
    expect(parent).not.toHaveBeenCalled();
  });

  it("says when the poll is missing", () => {
    render(createElement(PollBox, { placed, element: element(undefined) }));
    expect(container.textContent).toContain("Poll is missing");
  });

  it("is available without a provider by default", () => {
    expect(PollContext).toBeDefined();
  });
});

describe("toggleChoice", () => {
  it("replaces on a single poll and toggles on a multi poll", () => {
    expect(toggleChoice([0], 1, false)).toEqual([1]);
    expect(toggleChoice([1], 1, false)).toEqual([]);
    expect(toggleChoice([2], 0, true)).toEqual([0, 2]);
    expect(toggleChoice([0, 2], 2, true)).toEqual([0]);
  });
});

describe("PresenterPolls", () => {
  const polls = [{ id: "poll1", poll: SINGLE }];
  const props = () => ({ onClose: vi.fn(), onOpen: vi.fn(), onReset: vi.fn(), onReactionsOff: vi.fn() });

  it("shows live counts and the total for each poll on the slide", () => {
    render(createElement(PresenterPolls, { polls, state: { active: true, polls: { poll1: result() } }, reactionsOff: false, ...props() }));
    expect([0, 1, 2].map((i) => container.querySelector(`[data-poll-count="${i}"]`)!.textContent)).toEqual(["3", "1", "0"]);
    expect(container.textContent).toContain("4 votes");
  });

  it("closes voting, reopens it, and resets", () => {
    const p = props();
    render(createElement(PresenterPolls, { polls, state: { active: true, polls: { poll1: result() } }, reactionsOff: false, ...p }));
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Close voting")!);
    expect(p.onClose).toHaveBeenCalledWith("poll1");
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Reset")!);
    expect(p.onReset).toHaveBeenCalledWith("poll1");
    const q = props();
    render(createElement(PresenterPolls, { polls, state: { active: true, polls: { poll1: result({ closed: true }) } }, reactionsOff: false, ...q }));
    click([...container.querySelectorAll("button")].find((b) => b.textContent === "Reopen voting")!);
    expect(q.onOpen).toHaveBeenCalledWith("poll1");
  });

  it("disables reset while there are no votes", () => {
    render(createElement(PresenterPolls, { polls, state: { active: true, polls: {} }, reactionsOff: false, ...props() }));
    expect([...container.querySelectorAll("button")].find((b) => b.textContent === "Reset")!.hasAttribute("disabled")).toBe(true);
  });

  it("switches reactions off and on", () => {
    const p = props();
    render(createElement(PresenterPolls, { polls: [], state: { active: true, polls: {} }, reactionsOff: false, ...p }));
    const toggle = container.querySelector("input[role=switch]") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    click(toggle);
    expect(p.onReactionsOff).toHaveBeenCalledWith(true);
  });

  it("finds the polls among a slide's elements", () => {
    expect(pollsOnSlide([{ id: "a", kind: "text" }, { id: "poll1", kind: "poll", poll: SINGLE }, { id: "b", kind: "poll" }])).toEqual(polls);
    expect(pollsOnSlide(undefined)).toEqual([]);
  });
});

describe("reactions", () => {
  it("floats each reaction and takes no clicks", () => {
    render(createElement(ReactionOverlay, { items: [{ id: "1", emoji: "🎉", left: 20 }, { id: "2", emoji: "👍", left: 60 }] }));
    expect([...container.querySelectorAll("[data-reaction]")].map((e) => e.textContent)).toEqual(["🎉", "👍"]);
    expect(container.querySelector("[data-testid=reaction-overlay]")!.className).toContain("pointer-events-none");
  });

  it("offers every reaction, sends the one tapped, then waits a second before the next", async () => {
    const onReact = vi.fn(async () => true);
    render(createElement(ReactionBar, { onReact }));
    const buttons = [...container.querySelectorAll("button")] as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent)).toEqual([...REACTIONS]);
    click(buttons[0]);
    expect(onReact).toHaveBeenCalledWith("👍");
    expect(buttons.every((b) => b.disabled)).toBe(true);
    click(buttons[1]);
    expect(onReact).toHaveBeenCalledTimes(1);
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(buttons.every((b) => !b.disabled)).toBe(true);
  });

  it("reads a reaction event and ignores a malformed one", () => {
    expect(parseReaction('{"id":"a","emoji":"🎉"}')).toEqual({ id: "a", emoji: "🎉" });
    expect(parseReaction("1")).toBeNull();
    expect(parseReaction("not json")).toBeNull();
    expect(parseReaction('{"id":3}')).toBeNull();
  });
});
