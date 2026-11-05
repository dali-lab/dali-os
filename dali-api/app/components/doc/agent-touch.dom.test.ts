// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { DecorationSet } from "prosemirror-view";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { agentTouchPluginKey, createAgentTouchPlugin } from "./agent-touch";
import { AGENT_TOUCH_EXPIRE_MS, AGENT_TOUCH_FADE_MS } from "~/components/collab/agent";

const KEY = "agent-touch-test";

function setup() {
  const editor = BlockNoteEditor.create({
    initialContent: [
      { id: "b1", type: "paragraph", content: "One" },
      { id: "b2", type: "paragraph", content: "Two", children: [{ id: "c1", type: "paragraph", content: "Child" }] },
    ],
  });
  const el = document.createElement("div");
  document.body.appendChild(el);
  editor.mount(el);
  const awareness = new Awareness(new Y.Doc());
  const agent = new Awareness(new Y.Doc());
  const say = (state: Record<string, unknown> | null) => {
    agent.setLocalState(state);
    applyAwarenessUpdate(awareness, encodeAwarenessUpdate(agent, [agent.clientID]), null);
  };
  const touch = (ids: string[], seq: number, color = "#d97757") =>
    say({
      user: { name: "Claude", color, agent: { kind: "claude", action: "editing" } },
      touched: { ids, seq },
    });
  const block = (id: string) => el.querySelector<HTMLElement>(`.bn-block-outer[data-id="${id}"]`)!;
  const touchedIds = () =>
    [...el.querySelectorAll<HTMLElement>(".bn-block-outer.dali-agent-touched")].map((n) => n.dataset.id);
  const mount = () => editor.registerExtension({ key: KEY, prosemirrorPlugins: [createAgentTouchPlugin(awareness)] });
  return { editor, el, awareness, agent, say, touch, block, touchedIds, mount };
}

const flush = () => vi.advanceTimersByTime(0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "queueMicrotask"] });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("agent touch decorations", () => {
  it("tints the blocks an agent touched in its colour, with the fade length", () => {
    const t = setup();
    t.mount();
    t.touch(["b1", "c1"], 1);
    expect(t.touchedIds()).toEqual(["b1", "c1"]);
    const style = t.block("b1").getAttribute("style") ?? "";
    expect(style).toContain("--dali-agent: #d97757");
    expect(style).toContain(`--dali-agent-fade: ${AGENT_TOUCH_FADE_MS}ms`);
    expect(t.block("b2").classList.contains("dali-agent-touched")).toBe(false);
  });

  it("removes the tint when the touch expires, even though the agent stays", () => {
    const t = setup();
    t.mount();
    t.touch(["b1"], 1);
    vi.advanceTimersByTime(AGENT_TOUCH_EXPIRE_MS - 1);
    expect(t.touchedIds()).toEqual(["b1"]);
    vi.advanceTimersByTime(1);
    expect(t.touchedIds()).toEqual([]);
  });

  it("doesn't restart the fade when the agent's state is merely sent again", () => {
    const t = setup();
    t.mount();
    t.touch(["b1"], 1);
    vi.advanceTimersByTime(AGENT_TOUCH_EXPIRE_MS - 100);
    t.touch(["b1"], 1, "#d97757");
    vi.advanceTimersByTime(100);
    expect(t.touchedIds()).toEqual([]);
  });

  it("alternates the fade class per batch so a re-touched block fades again", () => {
    const t = setup();
    t.mount();
    t.touch(["b1"], 1);
    const first = [...t.block("b1").classList].find((c) => /^dali-agent-touched-[ab]$/.test(c));
    t.touch(["b1"], 2);
    const second = [...t.block("b1").classList].find((c) => /^dali-agent-touched-[ab]$/.test(c));
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it("marks a block whose content arrives after the awareness naming it", () => {
    const t = setup();
    t.mount();
    t.touch(["late"], 1);
    expect(t.touchedIds()).toEqual([]);
    t.editor.insertBlocks([{ id: "late", type: "paragraph", content: "Late" }], "b1", "after");
    expect(t.touchedIds()).toEqual(["late"]);
  });

  it("shows a batch already in awareness when the editor mounts", () => {
    const t = setup();
    t.touch(["b2"], 1);
    t.mount();
    flush();
    expect(t.touchedIds()).toEqual(["b2"]);
  });

  it("stays inert while nothing is touched", () => {
    const t = setup();
    t.mount();
    const dispatch = vi.spyOn(t.editor.prosemirrorView!, "dispatch");
    t.say({ user: { name: "Claude", color: "#d97757", agent: { kind: "claude", action: "reading" } } });
    const person = new Awareness(new Y.Doc());
    person.setLocalState({ user: { name: "Ada", color: "#123456" }, touched: { ids: ["b1"], seq: 1 } });
    applyAwarenessUpdate(t.awareness, encodeAwarenessUpdate(person, [person.clientID]), null);
    flush();
    expect(dispatch).not.toHaveBeenCalled();
    expect(agentTouchPluginKey.getState(t.editor.prosemirrorState)).toBe(DecorationSet.empty);
    expect(t.touchedIds()).toEqual([]);
  });

  it("stops listening and clears its timer when removed", () => {
    const t = setup();
    t.mount();
    const set = vi.spyOn(globalThis, "setTimeout");
    const clear = vi.spyOn(globalThis, "clearTimeout");
    t.touch(["b1"], 1);
    const expiry = set.mock.results[set.mock.calls.findIndex(([, ms]) => ms === AGENT_TOUCH_EXPIRE_MS)]!.value;
    const off = vi.spyOn(t.awareness, "off");
    t.editor.unregisterExtension(KEY);
    expect(off).toHaveBeenCalledWith("change", expect.any(Function));
    expect(clear).toHaveBeenCalledWith(expiry);
    t.touch(["b2"], 2);
    expect(t.touchedIds()).toEqual([]);
  });
});
