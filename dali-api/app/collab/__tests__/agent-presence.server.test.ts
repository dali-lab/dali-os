import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import type { Hocuspocus } from "@hocuspocus/server";

const publish = vi.fn();
const subscribe = vi.fn();
vi.mock("~/lib/realtime-bus.server", () => ({ publish, subscribe }));
const isFeatureEnabled = vi.fn();
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn(async () => ({})) }));

const {
  AGENT_HIGHLIGHT_MS,
  AGENT_LINGER_MS,
  announceAgent,
  applyAgentAnnouncement,
  attachAgentPresence,
  bodyTextRange,
  enterAgentContext,
  pagePresenceRoom,
} = await import("../agent-presence.server");
const { agentClientId } = await import("~/components/collab/agent");
type Announcement = Parameters<typeof applyAgentAnnouncement>[1];

type LiveDoc = Y.Doc & { awareness: Awareness };

function liveDoc(paragraphs: string[]): LiveDoc {
  const doc = new Y.Doc() as LiveDoc;
  doc.awareness = new Awareness(doc);
  const group = new Y.XmlElement("blockGroup");
  doc.getXmlFragment("blocknote").insert(0, [group]);
  group.insert(
    0,
    paragraphs.map((text) => {
      const container = new Y.XmlElement("blockContainer");
      const paragraph = new Y.XmlElement("paragraph");
      paragraph.insert(0, [new Y.XmlText(text)]);
      container.insert(0, [paragraph]);
      return container;
    }),
  );
  return doc;
}

function fakeHocuspocus(docs: Record<string, LiveDoc>) {
  return { documents: new Map(Object.entries(docs)) } as unknown as Hocuspocus;
}

const announcement = (overrides: Partial<Announcement> = {}): Announcement => ({
  kind: "claude",
  name: "Claude",
  userId: "u-ada",
  ownerName: "Ada Lovelace",
  action: "editing",
  ...overrides,
});

const ID = agentClientId("u-ada", "claude");

function resolve(doc: Y.Doc, json: unknown) {
  const abs = Y.createAbsolutePositionFromRelativePosition(
    Y.createRelativePositionFromJSON(json),
    doc,
  )!;
  return { text: (abs.type as Y.XmlText).toString(), index: abs.index };
}

/** Run with an MCP agent identity in its own async context, as one request. */
function asAgent<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((res, rej) => {
    setTimeout(() => {
      enterAgentContext({ clientName: "claude-code", userId: "u-ada", ownerName: "Ada Lovelace" });
      fn().then(res, rej);
    });
  });
}

beforeEach(() => {
  publish.mockReset();
  subscribe.mockReset();
  isFeatureEnabled.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("announceAgent", () => {
  it("does nothing outside an MCP request", async () => {
    isFeatureEnabled.mockResolvedValue(true);
    await announceAgent({ action: "reading", presenceRoom: "presence:doc:p1" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("does nothing when the owner's flag is off", async () => {
    isFeatureEnabled.mockResolvedValue(false);
    await asAgent(() => announceAgent({ action: "reading", presenceRoom: "presence:doc:p1" }));
    expect(isFeatureEnabled).toHaveBeenCalledWith("agent-presence", "u-ada", {});
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes who the agent is and whose it is on the bus", async () => {
    isFeatureEnabled.mockResolvedValue(true);
    await asAgent(() => announceAgent({ action: "editing", docRoom: "doc:p1:body" }));
    expect(publish).toHaveBeenCalledTimes(1);
    const [topic, data] = publish.mock.calls[0]!;
    expect(topic).toBe("collab:agent-presence");
    expect(JSON.parse(data)).toEqual({
      kind: "claude",
      name: "Claude",
      userId: "u-ada",
      ownerName: "Ada Lovelace",
      action: "editing",
      docRoom: "doc:p1:body",
    });
  });

  it("swallows failures so presence never breaks the tool call", async () => {
    isFeatureEnabled.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      asAgent(() => announceAgent({ action: "reading", presenceRoom: "presence:doc:p1" })),
    ).resolves.toBeUndefined();
    err.mockRestore();
  });
});

describe("pagePresenceRoom", () => {
  it("matches the room DocumentEditor's PresenceProvider joins", () => {
    expect(pagePresenceRoom("p1")).toBe("presence:doc:p1");
  });
});

describe("bodyTextRange", () => {
  it("spans the first to the last non-empty text", () => {
    const doc = liveDoc(["", "Hello", "", "World", ""]);
    const range = bodyTextRange(doc)!;
    expect(resolve(doc, Y.relativePositionToJSON(range.start))).toEqual({ text: "Hello", index: 0 });
    expect(resolve(doc, Y.relativePositionToJSON(range.end))).toEqual({ text: "World", index: 5 });
  });

  it("is null for an empty body", () => {
    expect(bodyTextRange(liveDoc(["", ""]))).toBeNull();
    expect(bodyTextRange(new Y.Doc())).toBeNull();
  });
});

describe("applyAgentAnnouncement", () => {
  beforeEach(() => vi.useFakeTimers());

  it("adds the agent to a presence room as its own peer, owned by the member", () => {
    const room = liveDoc([]);
    applyAgentAnnouncement(
      fakeHocuspocus({ "presence:doc:p1": room }),
      announcement({ action: "reading", presenceRoom: "presence:doc:p1" }),
    );
    const state = room.awareness.getStates().get(ID);
    expect(state?.user).toMatchObject({
      name: "Claude",
      color: "#d97757",
      userId: "u-ada",
      photoUrl: null,
      subtitle: "Ada Lovelace's agent",
      agent: { kind: "claude", action: "reading" },
      idle: false,
    });
  });

  it("highlights the written body, then collapses to a caret at the end", () => {
    const doc = liveDoc(["Hello", "World"]);
    applyAgentAnnouncement(fakeHocuspocus({ "doc:p1:body": doc }), announcement({ docRoom: "doc:p1:body" }));

    let state = doc.awareness.getStates().get(ID)!;
    expect(state.user).toEqual({
      name: "Claude",
      color: "#d97757",
      agent: { kind: "claude", action: "editing" },
    });
    expect(state.user).not.toHaveProperty("userId");
    expect(resolve(doc, state.cursor.anchor)).toEqual({ text: "Hello", index: 0 });
    expect(resolve(doc, state.cursor.head)).toEqual({ text: "World", index: 5 });

    vi.advanceTimersByTime(AGENT_HIGHLIGHT_MS);
    state = doc.awareness.getStates().get(ID)!;
    expect(resolve(doc, state.cursor.anchor)).toEqual({ text: "World", index: 5 });
    expect(resolve(doc, state.cursor.head)).toEqual({ text: "World", index: 5 });
  });

  it("shows no cursor for a read or an empty body", () => {
    const doc = liveDoc([""]);
    applyAgentAnnouncement(fakeHocuspocus({ "doc:p1:body": doc }), announcement({ docRoom: "doc:p1:body" }));
    expect(doc.awareness.getStates().get(ID)!.cursor).toBeNull();

    const read = liveDoc(["Hello"]);
    applyAgentAnnouncement(
      fakeHocuspocus({ "doc:p2:body": read }),
      announcement({ action: "reading", docRoom: "doc:p2:body" }),
    );
    expect(read.awareness.getStates().get(ID)!.cursor).toBeNull();
  });

  it("removes the agent after it lingers, and each call restarts the clock", () => {
    const room = liveDoc([]);
    const hp = fakeHocuspocus({ "presence:doc:p1": room });
    const msg = announcement({ presenceRoom: "presence:doc:p1" });

    applyAgentAnnouncement(hp, msg);
    vi.advanceTimersByTime(AGENT_LINGER_MS - 1);
    applyAgentAnnouncement(hp, msg);
    vi.advanceTimersByTime(AGENT_LINGER_MS - 1);
    expect(room.awareness.getStates().has(ID)).toBe(true);

    vi.advanceTimersByTime(1);
    expect(room.awareness.getStates().has(ID)).toBe(false);
  });

  it("shows the agent again on a call after it has lingered out", () => {
    const room = liveDoc(["Hello"]);
    const hp = fakeHocuspocus({ "doc:p1:body": room });
    const msg = announcement({ docRoom: "doc:p1:body" });

    applyAgentAnnouncement(hp, msg);
    vi.advanceTimersByTime(AGENT_LINGER_MS);
    expect(room.awareness.getStates().has(ID)).toBe(false);

    applyAgentAnnouncement(hp, msg);
    expect(room.awareness.getStates().has(ID)).toBe(true);
    vi.advanceTimersByTime(AGENT_HIGHLIGHT_MS);
    expect(room.awareness.getStates().has(ID)).toBe(true);
  });

  it("reaches a connected viewer again after it has lingered out", () => {
    const room = liveDoc(["Hello"]);
    const viewer = new Awareness(new Y.Doc());
    room.awareness.on("update", ({ added, updated, removed }: Record<string, number[]>) => {
      const changed = [...added!, ...updated!, ...removed!];
      applyAwarenessUpdate(viewer, encodeAwarenessUpdate(room.awareness, changed), null);
    });
    const hp = fakeHocuspocus({ "doc:p1:body": room });
    const msg = announcement({ docRoom: "doc:p1:body" });

    applyAgentAnnouncement(hp, msg);
    expect(viewer.getStates().has(ID)).toBe(true);
    vi.advanceTimersByTime(AGENT_LINGER_MS);
    expect(viewer.getStates().has(ID)).toBe(false);

    applyAgentAnnouncement(hp, msg);
    expect(viewer.getStates().has(ID)).toBe(true);
    vi.advanceTimersByTime(AGENT_LINGER_MS);
    expect(viewer.getStates().has(ID)).toBe(false);
  });

  it("keeps one entry per agent across repeated calls", () => {
    const room = liveDoc([]);
    const hp = fakeHocuspocus({ "presence:doc:p1": room });
    applyAgentAnnouncement(hp, announcement({ action: "reading", presenceRoom: "presence:doc:p1" }));
    applyAgentAnnouncement(hp, announcement({ action: "editing", presenceRoom: "presence:doc:p1" }));
    expect([...room.awareness.getStates().keys()].filter((id) => id !== room.clientID)).toEqual([ID]);
    expect(room.awareness.getStates().get(ID)!.user.agent.action).toBe("editing");
  });

  it("shows two members' agents side by side", () => {
    const room = liveDoc([]);
    const hp = fakeHocuspocus({ "presence:doc:p1": room });
    applyAgentAnnouncement(hp, announcement({ presenceRoom: "presence:doc:p1" }));
    applyAgentAnnouncement(hp, announcement({ userId: "u-grace", presenceRoom: "presence:doc:p1" }));
    expect(room.awareness.getStates().has(ID)).toBe(true);
    expect(room.awareness.getStates().has(agentClientId("u-grace", "claude"))).toBe(true);
  });

  it("skips rooms this machine doesn't have open", () => {
    const hp = fakeHocuspocus({});
    expect(() =>
      applyAgentAnnouncement(hp, announcement({ presenceRoom: "presence:doc:p1", docRoom: "doc:p1:body" })),
    ).not.toThrow();
    vi.advanceTimersByTime(AGENT_LINGER_MS);
  });
});

describe("attachAgentPresence", () => {
  it("applies announcements from the bus and ignores bare sync pings", () => {
    vi.useFakeTimers();
    const room = liveDoc([]);
    attachAgentPresence(fakeHocuspocus({ "presence:doc:p1": room }));
    expect(subscribe).toHaveBeenCalledWith("collab:agent-presence", expect.any(Function));
    const handler = subscribe.mock.calls[0]![1];

    handler("sync");
    expect(room.awareness.getStates().has(ID)).toBe(false);

    handler("change", JSON.stringify(announcement({ presenceRoom: "presence:doc:p1" })));
    expect(room.awareness.getStates().has(ID)).toBe(true);
    vi.advanceTimersByTime(AGENT_LINGER_MS);
  });
});
