// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AGENT_TOUCH_EXPIRE_MS, AGENT_TOUCH_FADE_MS, type AgentTouch } from "~/components/collab/agent";
import { agentTouchCss, useAgentTouches, type AwarenessLike } from "../agent-touch";
import { useSlidePresence, type DeckDoc, type DeckUser, type SlidePeer } from "../useDeckDoc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeAwareness implements AwarenessLike {
  clientID = 1;
  states = new Map<number, unknown>();
  fns = new Set<() => void>();
  getStates() {
    return this.states;
  }
  on(_: "change", fn: () => void) {
    this.fns.add(fn);
  }
  off(_: "change", fn: () => void) {
    this.fns.delete(fn);
  }
  setLocalStateField(field: string, value: unknown) {
    this.states.set(this.clientID, { ...((this.states.get(this.clientID) as object) ?? {}), [field]: value });
  }
  set(clientId: number, state: unknown) {
    this.states.set(clientId, state);
    for (const fn of this.fns) fn();
  }
}

const agentUser = { name: "Claude", color: "#d97757", agent: { kind: "claude", action: "editing" } };

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const touch = (id: string, over: Partial<AgentTouch> = {}): AgentTouch => ({ id, clientId: 9, seq: 1, name: "Claude", color: "#d97757", at: 0, batch: 1, ...over });

describe("agentTouchCss", () => {
  it("outlines the touched element and slot box on this slide in the agent's colour, fading over AGENT_TOUCH_FADE_MS", () => {
    const css = agentTouchCss("s1", [touch("s1/e1")]);
    expect(css).toContain('[data-agent-stage] [data-element="e1"],[data-agent-stage] [data-slot="e1"]{--dali-agent:#d97757;outline:');
    expect(css).toContain(`dali-slide-agent-a ${AGENT_TOUCH_FADE_MS}ms`);
    expect(css).toContain("prefers-reduced-motion:no-preference");
    expect(css).toContain("@keyframes dali-slide-agent-a");
  });

  it("alternates the animation per batch so a re-touch restarts it", () => {
    expect(agentTouchCss("s1", [touch("s1/e1", { batch: 2 })])).toContain("dali-slide-agent-b ");
  });

  it("is empty for other slides' touches, unsafe ids or colours, or none", () => {
    expect(agentTouchCss("s1", [touch("s2/e1")])).toBe("");
    expect(agentTouchCss("s1", [touch('s1/e"]{}*{')])).toBe("");
    expect(agentTouchCss("s1", [touch("s1/e1", { color: "red;x:y" })])).toBe("");
    expect(agentTouchCss("s1", [])).toBe("");
  });
});

function Touches({ awareness, now, out }: { awareness: AwarenessLike | null; now: () => number; out: { current: AgentTouch[] } }) {
  out.current = useAgentTouches(awareness, now);
  return null;
}

describe("useAgentTouches", () => {
  it("lists an agent's touched keys from awareness and drops them when they expire", () => {
    vi.useFakeTimers();
    const awareness = new FakeAwareness();
    const out = { current: [] as AgentTouch[] };
    const now = () => Date.now();
    act(() => root.render(createElement(Touches, { awareness, now, out })));
    act(() => awareness.set(9, { user: agentUser, touched: { ids: ["s1/e1"], seq: 1 } }));
    expect(out.current.map((t) => t.id)).toEqual(["s1/e1"]);
    act(() => vi.advanceTimersByTime(AGENT_TOUCH_EXPIRE_MS));
    expect(out.current).toEqual([]);
  });

  it("ignores people's states and is empty without awareness", () => {
    const awareness = new FakeAwareness();
    const out = { current: [] as AgentTouch[] };
    act(() => root.render(createElement(Touches, { awareness, now: Date.now, out })));
    act(() => awareness.set(5, { user: { name: "Grace", color: "#aa3366" }, touched: { ids: ["s1/e1"], seq: 1 } }));
    expect(out.current).toEqual([]);
    act(() => root.render(createElement(Touches, { awareness: null, now: Date.now, out })));
    expect(out.current).toEqual([]);
  });
});

function Presence({ awareness, out }: { awareness: FakeAwareness; out: { current: Map<string, SlidePeer[]> } }) {
  const deck = { entry: { provider: { awareness } } } as unknown as DeckDoc;
  const me: DeckUser = { userId: "u1", name: "Ada", color: "#112233", photoUrl: null };
  out.current = useSlidePresence(deck, me, "s1");
  return null;
}

describe("useSlidePresence", () => {
  it("shows my own agent on its slide, though it shares my user id, and still hides my other tabs", () => {
    const awareness = new FakeAwareness();
    const out = { current: new Map<string, SlidePeer[]>() };
    act(() => root.render(createElement(Presence, { awareness, out })));
    act(() => {
      awareness.set(9, { user: agentUser, deckSlide: { slideId: "s2", userId: "u1", name: "Claude", color: "#d97757", photoUrl: null, agent: { kind: "claude" } } });
      awareness.set(4, { deckSlide: { slideId: "s2", userId: "u1", name: "Ada", color: "#112233", photoUrl: null } });
    });
    expect(out.current.get("s2")).toEqual([{ clientId: 9, userId: "u1", name: "Claude", color: "#d97757", photoUrl: null, agent: { kind: "claude" } }]);
  });

  it("lists two agents of one person separately, beside the person", () => {
    const awareness = new FakeAwareness();
    const out = { current: new Map<string, SlidePeer[]>() };
    act(() => root.render(createElement(Presence, { awareness, out })));
    const agent = (name: string) => ({ user: agentUser, deckSlide: { slideId: "s3", userId: "u2", name, color: "#d97757", photoUrl: null, agent: { kind: "nonsense" } } });
    act(() => {
      awareness.set(5, { deckSlide: { slideId: "s3", userId: "u2", name: "Grace", color: "#aa3366", photoUrl: "p.png" } });
      awareness.set(9, agent("Claude"));
      awareness.set(10, agent("Claude 2"));
    });
    const peers = out.current.get("s3")!;
    expect(peers.map((p) => p.name)).toEqual(["Grace", "Claude", "Claude 2"]);
    expect(peers[1].agent).toEqual({ kind: "other" });
    expect(peers[0].agent).toBeUndefined();
  });
});
