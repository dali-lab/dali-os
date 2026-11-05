// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RenderSlide as DeckSlide } from "~/components/slides/deck/snapshot";
import type { LiveState } from "../types";

const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  session: { live: null as unknown, ready: true, start: vi.fn(), go: vi.fn(), end: vi.fn() },
  follow: null as unknown as Record<string, unknown>,
}));

vi.mock("react-router", () => ({
  useNavigate: () => m.navigate,
  Link: (p: { to: string; children: unknown }) => createElement("a", { href: p.to }, p.children as never),
}));
vi.mock("../usePresenterSession", () => ({ usePresenterSession: () => m.session }));
vi.mock("../useFollowDeck", () => ({ useFollowDeck: () => m.follow }));

import { ToastProvider } from "~/components/ui/toast";
import { PresentStage } from "../PresentStage";
import { PresenterView } from "../PresenterView";
import { PresentDriver, PresentFollower } from "../PresentRun";
import { PresentMenu } from "../PresentMenu";
import { DeckFollowLayer } from "../DeckFollowLayer";
import { presenterUrl, presentUrl } from "../urls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeResizeObserver {
  constructor(private cb: (entries: unknown[]) => void) {}
  observe() {
    this.cb([]);
  }
  disconnect() {}
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 1600 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 900 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
  m.session = { live: INACTIVE, ready: true, start: vi.fn(), go: vi.fn(), end: vi.fn() };
  m.follow = { ready: true, active: false, slideId: null, build: 0, presenter: null, startedAt: null, following: false, browseOnMyOwn: vi.fn(), follow: vi.fn() };
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  delete (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP;
});

const INACTIVE: LiveState = { active: false, slideId: null, build: 0, presenter: null, startedAt: null };
const live = (slideId: string, build = 0, presenterId = "me"): LiveState => ({
  active: true,
  slideId,
  build,
  presenter: { id: presenterId, name: "Ada" },
  startedAt: "2026-11-05T10:00:00.000Z",
});

const para = (text: string) => ({ id: text, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] });
const element = (slot: string, extra: Record<string, unknown> = {}) => ({ id: slot, kind: "text", slot, z: 1, blocks: [] as never, src: null, alt: null, textStyle: null, ...extra });
const slide = (id: string, elements: unknown[]): DeckSlide => ({ id, pos: 1, layoutId: "content", elements: elements as never });
// a: no builds. b: body builds in 2 steps. c: no builds.
const deck = {
  themeId: "dali-dark",
  slides: [
    slide("a", [element("title", { blocks: [para("Alpha")] })]),
    slide("b", [element("title", { blocks: [para("Beta")] }), element("body", { blocks: [para("one"), para("two")], build: 1, buildBullets: true })]),
    slide("c", [element("title", { blocks: [para("Gamma")] })]),
  ],
  notes: { a: "notes for a", b: "notes for b", c: "notes for c" },
};
const key = (k: string) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
const text = (sel: string) => container.querySelector(sel)?.textContent ?? null;
const mount = (node: React.ReactElement) => act(() => root.render(node));
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

describe("PresentStage with build steps", () => {
  const Harness = ({ onPos, from = { index: 1, step: 0 } }: { onPos?: (p: { index: number; step: number }) => void; from?: { index: number; step: number } }) => {
    const [pos, setPos] = useState(from);
    const renders: string[] = [];
    return createElement(
      "div",
      null,
      createElement(PresentStage, {
        slideIds: ["a", "b", "c"],
        index: pos.index,
        step: pos.step,
        stepsOf: (i: number) => [0, 3, 0][i],
        onIndexChange: () => {},
        onPositionChange: (p: { index: number; step: number }) => (onPos?.(p), setPos(p)),
        renderSlide: (id: string, { step }: { step?: number }) => (renders.push(`${id}@${step}`), createElement("i", { "data-at": `${id}@${step}` })),
      }),
      createElement("output", null, `${pos.index}:${pos.step}`),
    );
  };
  const at = () => container.querySelector("output")!.textContent;

  it("steps through a slide's builds with next, then moves on", () => {
    mount(createElement(Harness));
    expect(container.querySelector("[data-at]")!.getAttribute("data-at")).toBe("b@0");
    key("ArrowRight");
    key(" ");
    key("ArrowRight");
    expect(at()).toBe("1:3");
    key("ArrowRight");
    expect(at()).toBe("2:0");
    key("ArrowRight");
    expect(at()).toBe("2:0");
  });

  it("goes back through steps then to the previous slide's last step", () => {
    mount(createElement(Harness));
    key("ArrowRight");
    key("ArrowRight");
    key("ArrowLeft");
    expect(at()).toBe("1:1");
    key("ArrowLeft");
    key("ArrowLeft");
    expect(at()).toBe("0:0");
  });

  it("returns to the previous slide fully built", () => {
    mount(createElement(Harness, { from: { index: 2, step: 0 } }));
    key("ArrowLeft");
    expect(at()).toBe("1:3");
  });

  it("advances on a click and passes the step to the renderer", () => {
    mount(createElement(Harness));
    act(() => void (container.querySelector("[data-testid=present-slide]") as HTMLElement).click());
    expect(container.querySelector("[data-at]")!.getAttribute("data-at")).toBe("b@1");
  });
});

describe("PresenterView with build steps", () => {
  const View = ({ onPos }: { onPos?: (p: { index: number; step: number }) => void }) => {
    const [pos, setPos] = useState({ index: 1, step: 0 });
    return createElement(
      "div",
      null,
      createElement(PresenterView, {
        title: "Demo",
        slideIds: ["a", "b", "c"],
        notes: deck.notes,
        index: pos.index,
        step: pos.step,
        stepsOf: (i: number) => [0, 2, 0][i],
        onIndexChange: () => {},
        onPositionChange: (p: { index: number; step: number }) => (onPos?.(p), setPos(p)),
        renderSlide: (id: string, o: { step?: number }) => createElement("i", { "data-at": `${id}@${o.step}` }),
        onEnd: () => {},
      }),
      createElement("output", null, `${pos.index}:${pos.step}`),
    );
  };
  const nowAndNext = () => [...container.querySelectorAll("[data-at]")].map((n) => n.getAttribute("data-at"));

  it("shows the step count only on a slide that builds", () => {
    mount(createElement(View));
    expect(container.textContent).toContain("Step 0 of 2");
    act(() => button("Next").click());
    act(() => button("Next").click());
    expect(container.textContent).toContain("Step 2 of 2");
    act(() => button("Next").click());
    expect(container.textContent).not.toContain("Step");
  });

  it("previews the next step on the same slide, then the next slide", () => {
    mount(createElement(View));
    expect(nowAndNext()).toContain("b@1");
    expect(container.textContent).toContain("Next step");
    expect(button("Next step")).toBeDefined();
    act(() => button("Next step").click());
    act(() => button("Next step").click());
    expect(container.querySelector("output")!.textContent).toBe("1:2");
    expect(nowAndNext()).toContain("c@0");
    expect(button("Next slide")).toBeDefined();
  });

  it("moves with the keyboard and Back, and disables Next at the very end", () => {
    mount(createElement(View));
    key("ArrowRight");
    key("ArrowRight");
    key("ArrowRight");
    expect(container.querySelector("output")!.textContent).toBe("2:0");
    expect(button("Next slide").disabled).toBe(true);
    act(() => button("Back").click());
    expect(container.querySelector("output")!.textContent).toBe("1:2");
  });

  it("goes to a slide's first step from the filmstrip", () => {
    mount(createElement(View));
    act(() => button("Next").click());
    act(() => (container.querySelector("[aria-label='Go to slide 3']") as HTMLElement).click());
    expect(container.querySelector("output")!.textContent).toBe("2:0");
  });
});

describe("PresentDriver", () => {
  const driver = (extra: Record<string, unknown> = {}) =>
    createElement(PresentDriver, { pageId: "p1", title: "Demo", viewerId: "me", deck, startSlideId: "b", view: "present", onLeave: vi.fn(), ...extra } as never);

  it("starts the presentation from the slide it was opened on", () => {
    mount(driver());
    expect(m.session.start).toHaveBeenCalledWith("b", 0);
  });

  it("starts from the first slide when it wasn't told one", () => {
    mount(driver({ startSlideId: null }));
    expect(m.session.start).toHaveBeenCalledWith("a", 0);
  });

  it("resumes where the presentation already is when the same person is presenting", () => {
    m.session.live = live("b", 2);
    mount(driver());
    expect(m.session.start).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid=present-slide]")).not.toBeNull();
  });

  it("posts the slide and step on every move, through a slide's builds", () => {
    m.session.live = live("b", 0);
    mount(driver());
    key("ArrowRight");
    expect(m.session.go).toHaveBeenLastCalledWith("b", 1);
    m.session.live = live("b", 3);
    mount(driver());
    key("ArrowRight");
    expect(m.session.go).toHaveBeenLastCalledWith("c", 0);
    m.session.live = live("c", 0);
    mount(driver());
    key("ArrowLeft");
    expect(m.session.go).toHaveBeenLastCalledWith("b", 3);
  });

  it("ends on Escape and leaves once the presentation is over", () => {
    const onLeave = vi.fn();
    m.session.live = live("a");
    mount(driver({ onLeave }));
    key("Escape");
    expect(m.session.end).toHaveBeenCalled();
    expect(onLeave).not.toHaveBeenCalled();
    m.session.live = INACTIVE;
    mount(driver({ onLeave }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("does not leave before it has ever been active", () => {
    const onLeave = vi.fn();
    mount(driver({ onLeave }));
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("shows the presenter view with notes from each slide and posts moves", () => {
    m.session.live = live("b", 0);
    mount(driver({ view: "presenter" }));
    expect(text("[data-testid=notes]")).toBe("notes for b");
    expect(container.textContent).toContain("Step 0 of 3");
    act(() => button("Next").click());
    expect(m.session.go).toHaveBeenLastCalledWith("b", 1);
    act(() => button("End").click());
    expect(m.session.end).toHaveBeenCalled();
  });

  it("offers the slide show from the presenter view only in the desktop app", () => {
    m.session.live = live("b");
    mount(driver({ view: "presenter" }));
    expect(container.textContent).not.toContain("Open slide show");
    act(() => root.unmount());
    root = createRoot(container);
    (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP = { version: "1.0.0" };
    mount(driver({ view: "presenter" }));
    expect(container.querySelector("a[href='/slides/p1/present?slide=b']")?.textContent).toBe("Open slide show");
  });
});

describe("PresentFollower", () => {
  it("renders the presenter's slide at the presenter's step and cannot be driven", () => {
    m.follow = { ...(m.follow as object), active: true, slideId: "b", build: 3, presenter: { id: "other", name: "Ada" }, following: true };
    mount(createElement(PresentFollower, { pageId: "p1", deck, onLeave: vi.fn() }));
    expect(text("[data-slot=body]")).toBe("onetwo");
    key("ArrowRight");
    expect(text("[data-slot=body]")).toBe("onetwo");
    expect(container.textContent).toContain("Following Ada · Slide 2 of 3");
  });

  it("leaves from Browse on my own, and says so when nobody is presenting", () => {
    const onLeave = vi.fn();
    m.follow = { ...(m.follow as object), active: true, slideId: "a", build: 0, presenter: { id: "other", name: "Ada" }, following: true };
    mount(createElement(PresentFollower, { pageId: "p1", deck, onLeave }));
    act(() => button("Browse on my own").click());
    expect(onLeave).toHaveBeenCalled();
    m.follow = { ...(m.follow as object), active: false, presenter: null };
    mount(createElement(PresentFollower, { pageId: "p1", deck, onLeave }));
    expect(container.textContent).toContain("Nobody is presenting right now.");
    expect(container.querySelector("a[href='/slides/p1']")).not.toBeNull();
  });
});

describe("DeckFollowLayer", () => {
  const layer = (canEdit: boolean) =>
    createElement(DeckFollowLayer, { pageId: "p1", viewerId: "me", canEdit, token: null, deck, children: createElement("div", { "data-testid": "page" }, "the deck page") });
  const presenting = (extra: Record<string, unknown> = {}) => {
    m.follow = { ...(m.follow as object), active: true, slideId: "b", build: 1, presenter: { id: "other", name: "Ada" }, following: true, ...extra };
  };

  it("leaves the page alone when nobody is presenting", () => {
    mount(layer(false));
    expect(container.querySelector("[data-testid=page]")).not.toBeNull();
    expect(container.querySelector("[data-testid=present-stage]")).toBeNull();
    expect(container.querySelector("[role=status]")).toBeNull();
  });

  it("sends a viewer to the presenter's slide and step as soon as a presentation starts", () => {
    presenting();
    mount(layer(false));
    expect(container.querySelector("[data-testid=present-stage]")).not.toBeNull();
    expect(text("[data-slot=title]")).toBe("Beta");
    expect(text("[data-slot=body]")).toBe("");
    expect(container.textContent).toContain("Following Ada");
  });

  it("asks an editor first instead of taking over their screen", () => {
    presenting();
    mount(layer(true));
    expect(container.querySelector("[data-testid=present-stage]")).toBeNull();
    expect(container.textContent).toContain("Ada is presenting");
    act(() => button("Follow").click());
    expect((m.follow as { follow: ReturnType<typeof vi.fn> }).follow).toHaveBeenCalled();
    expect(container.querySelector("[data-testid=present-stage]")).not.toBeNull();
  });

  it("stops following on Browse on my own, and an editor is asked again afterwards", () => {
    presenting();
    mount(layer(false));
    act(() => button("Browse on my own").click());
    expect((m.follow as { browseOnMyOwn: ReturnType<typeof vi.fn> }).browseOnMyOwn).toHaveBeenCalled();
    presenting({ following: false });
    mount(layer(false));
    expect(container.querySelector("[data-testid=present-stage]")).toBeNull();
    expect(container.querySelector("[data-testid=page]")).not.toBeNull();
    expect(button("Follow")).toBeDefined();
  });

  it("does nothing for the person who is presenting", () => {
    presenting({ presenter: { id: "me", name: "Me" } });
    mount(layer(true));
    expect(container.querySelector("[data-testid=present-stage]")).toBeNull();
    expect(container.querySelector("[role=status]")).toBeNull();
  });
});

const withToast = (node: React.ReactElement) => createElement(ToastProvider, null, node);

describe("PresentMenu", () => {
  const openMenu = () => act(() => void (container.querySelector("[aria-label='Present options']") as HTMLElement).click());
  const item = (label: string) => [...document.body.querySelectorAll("[role=menuitem]")].find((n) => n.textContent === label) as HTMLElement;

  it("urls carry the slide to start from", () => {
    expect(presentUrl("p1", "b")).toBe("/slides/p1/present?slide=b");
    expect(presenterUrl("p1")).toBe("/slides/p1/presenter");
  });

  it("presents from the current slide", () => {
    mount(withToast(createElement(PresentMenu, { pageId: "p1", currentSlideId: "b" })));
    act(() => button("Present").click());
    expect(m.navigate).toHaveBeenCalledWith("/slides/p1/present?slide=b");
  });

  it("offers the beginning, the presenter view and the follow link", () => {
    mount(withToast(createElement(PresentMenu, { pageId: "p1", currentSlideId: "b" })));
    openMenu();
    expect([...document.body.querySelectorAll("[role=menuitem]")].map((n) => n.textContent)).toEqual(["From the beginning", "Presenter view", "Copy follow link"]);
    act(() => item("From the beginning").click());
    expect(m.navigate).toHaveBeenCalledWith("/slides/p1/present");
  });

  it("opens the presenter view in a new tab in a browser", () => {
    const open = vi.fn(() => ({}));
    vi.stubGlobal("open", open);
    mount(withToast(createElement(PresentMenu, { pageId: "p1", currentSlideId: "b" })));
    openMenu();
    act(() => item("Presenter view").click());
    expect(open).toHaveBeenCalledWith("/slides/p1/presenter?slide=b", "_blank");
    expect(m.navigate).not.toHaveBeenCalled();
  });

  it("falls back to the same tab when a window can't be opened, and in the desktop app", () => {
    const open = vi.fn(() => null);
    vi.stubGlobal("open", open);
    mount(withToast(createElement(PresentMenu, { pageId: "p1", currentSlideId: "b" })));
    openMenu();
    act(() => item("Presenter view").click());
    expect(m.navigate).toHaveBeenCalledWith("/slides/p1/presenter?slide=b");

    act(() => root.unmount());
    root = createRoot(container);
    m.navigate.mockClear();
    open.mockClear();
    (window as { __DALI_DESKTOP?: unknown }).__DALI_DESKTOP = { version: "1.0.0" };
    mount(withToast(createElement(PresentMenu, { pageId: "p2", currentSlideId: null })));
    openMenu();
    act(() => item("Presenter view").click());
    expect(open).not.toHaveBeenCalled();
    expect(m.navigate).toHaveBeenCalledWith("/slides/p2/presenter");
  });

  it("copies the deck link for followers", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    mount(withToast(createElement(PresentMenu, { pageId: "p1", currentSlideId: "b" })));
    openMenu();
    await act(async () => item("Copy follow link").click());
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/slides/p1`);
  });
});
