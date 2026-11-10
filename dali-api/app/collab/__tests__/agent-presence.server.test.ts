import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import type { Hocuspocus } from "@hocuspocus/server";

const publish = vi.fn();
const subscribe = vi.fn();
vi.mock("~/lib/realtime-bus.server", () => ({ publish, subscribe }));

const {
  AGENT_HIGHLIGHT_MS,
  AGENT_LINGER_MS,
  AGENT_RENEW_MS,
  AGENT_TOUCH_MS,
  AgentBlockNotFoundError,
  announceAgent,
  applyAgentAnnouncement,
  attachAgentPresence,
  blockPosition,
  bodyTexts,
  changedTextRange,
  agentDocKey,
  docViewerCount,
  enterAgentContext,
  pagePresenceRoom,
  pointAgent,
  republishAgents,
} = await import("../agent-presence.server");
const { AGENT_COLORS, AGENT_SESSION_COLORS, agentClientId } = await import("~/components/collab/agent");
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
  subscribe.mockReturnValue(() => {});
});

afterEach(() => {
  // Let every entry a test left behind linger out, so the next test starts empty.
  if (vi.isFakeTimers()) vi.advanceTimersByTime(AGENT_LINGER_MS);
  vi.useRealTimers();
});

describe("announceAgent", () => {
  it("does nothing outside an MCP request", async () => {
    await announceAgent({ action: "reading", presenceRoom: "presence:doc:p1" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes who the agent is and whose it is on the bus", async () => {
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
      at: expect.any(Number),
      docRoom: "doc:p1:body",
    });
  });

  it("swallows failures so presence never breaks the tool call", async () => {
    publish.mockImplementation(() => {
      throw new Error("bus down");
    });
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

/** Replace the whole body the way blocksToFragment does: every node rebuilt. */
function rewrite(doc: LiveDoc, paragraphs: string[]): string[] {
  const before = bodyTexts(doc).map((t) => t.toString());
  const fragment = doc.getXmlFragment("blocknote");
  fragment.delete(0, fragment.length);
  const fresh = liveDoc(paragraphs).getXmlFragment("blocknote").toArray() as Y.XmlElement[];
  fragment.insert(0, fresh.map((n) => n.clone()));
  return before;
}

function changed(before: string[], doc: LiveDoc) {
  const range = changedTextRange(before, doc);
  return range && { start: resolve(doc, range.start), end: resolve(doc, range.end) };
}

describe("changedTextRange", () => {
  it("spans only an appended line", () => {
    const doc = liveDoc(["Intro", "One", "Two", "Outro"]);
    const before = rewrite(doc, ["Intro", "One", "Two", "Three", "Outro"]);
    expect(changed(before, doc)).toEqual({
      start: { text: "Three", index: 0 },
      end: { text: "Three", index: 5 },
    });
  });

  it("spans a line edited in place", () => {
    const doc = liveDoc(["One", "Two", "Three"]);
    const before = rewrite(doc, ["One", "Two!", "Three"]);
    expect(changed(before, doc)).toEqual({
      start: { text: "Two!", index: 0 },
      end: { text: "Two!", index: 4 },
    });
  });

  it("spans every line between the first and last change", () => {
    const doc = liveDoc(["One", "Two", "Three", "Four"]);
    const before = rewrite(doc, ["One", "2", "Three", "4"]);
    expect(changed(before, doc)).toEqual({
      start: { text: "2", index: 0 },
      end: { text: "4", index: 1 },
    });
  });

  it("matches repeated lines from both ends without overlapping", () => {
    const doc = liveDoc(["Same", "Same"]);
    const before = rewrite(doc, ["Same", "Same", "Same"]);
    expect(changed(before, doc)).toEqual({
      start: { text: "Same", index: 0 },
      end: { text: "Same", index: 4 },
    });
  });

  it("skips empty lines at the edges of the change", () => {
    const doc = liveDoc(["One"]);
    const before = rewrite(doc, ["One", "", "Two", ""]);
    expect(changed(before, doc)).toEqual({
      start: { text: "Two", index: 0 },
      end: { text: "Two", index: 3 },
    });
  });

  it("is null when nothing changed, only lines were removed, or only empty lines were added", () => {
    let doc = liveDoc(["One", "Two"]);
    expect(changedTextRange(rewrite(doc, ["One", "Two"]), doc)).toBeNull();
    doc = liveDoc(["One", "Two", "Three"]);
    expect(changedTextRange(rewrite(doc, ["One", "Three"]), doc)).toBeNull();
    doc = liveDoc(["One"]);
    expect(changedTextRange(rewrite(doc, ["One", ""]), doc)).toBeNull();
  });

  it("spans the whole body when there is no prior text", () => {
    const doc = liveDoc(["", "Hello", "", "World", ""]);
    expect(changed([], doc)).toEqual({
      start: { text: "Hello", index: 0 },
      end: { text: "World", index: 5 },
    });
    expect(changedTextRange([], liveDoc(["", ""]))).toBeNull();
    expect(changedTextRange([], new Y.Doc())).toBeNull();
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

  it("highlights only the announced range, then collapses to its end", () => {
    const doc = liveDoc(["Intro", "Outro"]);
    const before = rewrite(doc, ["Intro", "Added", "Outro"]);
    const range = changedTextRange(before, doc);
    applyAgentAnnouncement(
      fakeHocuspocus({ "doc:p1:body": doc }),
      announcement({ docRoom: "doc:p1:body", range }),
    );

    let cursor = doc.awareness.getStates().get(ID)!.cursor;
    expect(resolve(doc, cursor.anchor)).toEqual({ text: "Added", index: 0 });
    expect(resolve(doc, cursor.head)).toEqual({ text: "Added", index: 5 });

    vi.advanceTimersByTime(AGENT_HIGHLIGHT_MS);
    cursor = doc.awareness.getStates().get(ID)!.cursor;
    expect(resolve(doc, cursor.anchor)).toEqual({ text: "Added", index: 5 });
  });

  it("shows no cursor when the write added no text", () => {
    const doc = liveDoc(["Hello"]);
    applyAgentAnnouncement(
      fakeHocuspocus({ "doc:p1:body": doc }),
      announcement({ docRoom: "doc:p1:body", range: null }),
    );
    expect(doc.awareness.getStates().get(ID)!.cursor).toBeNull();
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
    const detach = attachAgentPresence(fakeHocuspocus({ "presence:doc:p1": room }));
    expect(subscribe).toHaveBeenCalledWith("collab:agent-presence", expect.any(Function));
    const handler = subscribe.mock.calls[0]![1];

    handler("sync");
    expect(room.awareness.getStates().has(ID)).toBe(false);

    handler("change", JSON.stringify(announcement({ presenceRoom: "presence:doc:p1" })));
    expect(room.awareness.getStates().has(ID)).toBe(true);
    detach();
  });

  it("takes the agents out of their rooms when detached", () => {
    vi.useFakeTimers();
    const room = liveDoc([]);
    const detach = attachAgentPresence(fakeHocuspocus({ "presence:doc:p1": room }));
    subscribe.mock.calls[0]![1]("change", JSON.stringify(announcement({ presenceRoom: "presence:doc:p1" })));
    expect(room.awareness.getStates().has(ID)).toBe(true);
    detach();
    expect(room.awareness.getStates().has(ID)).toBe(false);
  });
});

type Run = string | { inline: string };
type BlockSpec = { id: string; runs: Run[]; children?: BlockSpec[] };

function blockGroup(blocks: BlockSpec[]): Y.XmlElement {
  const group = new Y.XmlElement("blockGroup");
  group.insert(
    0,
    blocks.map((b) => {
      const container = new Y.XmlElement("blockContainer");
      container.setAttribute("id", b.id);
      const paragraph = new Y.XmlElement("paragraph");
      paragraph.insert(
        0,
        b.runs.map((r) => (typeof r === "string" ? new Y.XmlText(r) : new Y.XmlElement(r.inline))),
      );
      container.insert(0, b.children ? [paragraph, blockGroup(b.children)] : [paragraph]);
      return container;
    }),
  );
  return group;
}

function blockDoc(blocks: BlockSpec[]): LiveDoc {
  const doc = new Y.Doc() as LiveDoc;
  doc.awareness = new Awareness(doc);
  doc.getXmlFragment("blocknote").insert(0, [blockGroup(blocks)]);
  return doc;
}

/** Where a relative position lands: the text run (by its string) and the index in it. */
function landing(doc: Y.Doc, json: unknown) {
  const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(json), doc)!;
  return { text: abs.type instanceof Y.XmlText ? abs.type.toString() : abs.type.constructor.name, index: abs.index };
}

/** A browser connected to the room: it hears the room's awareness while `connected`. */
function viewerOf(room: LiveDoc) {
  const viewer = new Awareness(new Y.Doc());
  const link = { connected: true };
  room.awareness.on("update", ({ added, updated, removed }: Record<string, number[]>) => {
    if (!link.connected) return;
    const changed = [...added!, ...updated!, ...removed!];
    applyAwarenessUpdate(viewer, encodeAwarenessUpdate(room.awareness, changed), null);
  });
  return { viewer, link };
}

function addPerson(room: LiveDoc, name: string) {
  const person = new Awareness(new Y.Doc());
  person.setLocalState({ user: { name, color: "#123456" } });
  applyAwarenessUpdate(room.awareness, encodeAwarenessUpdate(person, [person.clientID]), null);
  return person;
}

describe("touched blocks", () => {
  beforeEach(() => vi.useFakeTimers());

  it("carries what each edit touched, numbering every batch higher than the last", () => {
    const doc = liveDoc(["Hello"]);
    const hp = fakeHocuspocus({ "doc:p1:body": doc });
    applyAgentAnnouncement(hp, announcement({ docRoom: "doc:p1:body", touched: ["b1"], at: 0 }));
    const first = doc.awareness.getStates().get(ID)!.touched;
    expect(first.ids).toEqual(["b1"]);

    applyAgentAnnouncement(hp, announcement({ docRoom: "doc:p1:body", touched: ["b2", "b3"], at: 0 }));
    const second = doc.awareness.getStates().get(ID)!.touched;
    expect(second.ids).toEqual(["b2", "b3"]);
    expect(second.seq).toBe(first.seq + 1);
  });

  it("numbers batches from the publisher's clock, so every machine and a returning agent agree", () => {
    const doc = liveDoc(["Hello"]);
    applyAgentAnnouncement(
      fakeHocuspocus({ "doc:p1:body": doc }),
      announcement({ docRoom: "doc:p1:body", touched: ["b1"], at: 1_700_000_000_000 }),
    );
    expect(doc.awareness.getStates().get(ID)!.touched.seq).toBe(1_700_000_000_000);
  });

  it("keeps only the last 40 ids", () => {
    const doc = liveDoc(["Hello"]);
    const ids = Array.from({ length: 45 }, (_, i) => `b${i}`);
    applyAgentAnnouncement(fakeHocuspocus({ "doc:p1:body": doc }), announcement({ docRoom: "doc:p1:body", touched: ids }));
    expect(doc.awareness.getStates().get(ID)!.touched.ids).toEqual(ids.slice(5));
  });

  it("drops the list after AGENT_TOUCH_MS but keeps the agent", () => {
    const doc = liveDoc(["Hello"]);
    applyAgentAnnouncement(fakeHocuspocus({ "doc:p1:body": doc }), announcement({ docRoom: "doc:p1:body", touched: ["b1"] }));
    vi.advanceTimersByTime(AGENT_TOUCH_MS - 1);
    expect(doc.awareness.getStates().get(ID)!.touched).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(doc.awareness.getStates().get(ID)).not.toHaveProperty("touched");
  });

  it("keeps the list through a later announcement that touched nothing", () => {
    const doc = liveDoc(["Hello"]);
    const hp = fakeHocuspocus({ "doc:p1:body": doc });
    applyAgentAnnouncement(hp, announcement({ docRoom: "doc:p1:body", touched: ["b1"] }));
    applyAgentAnnouncement(hp, announcement({ action: "reading", docRoom: "doc:p1:body" }));
    expect(doc.awareness.getStates().get(ID)!.touched.ids).toEqual(["b1"]);
  });

  it("keeps the last caret through a delete or move that wrote no text", () => {
    const doc = liveDoc(["Intro", "Outro"]);
    const before = rewrite(doc, ["Intro", "Added", "Outro"]);
    const range = changedTextRange(before, doc);
    const hp = fakeHocuspocus({ "doc:p1:body": doc });
    applyAgentAnnouncement(hp, announcement({ docRoom: "doc:p1:body", range, touched: ["b2"] }));
    applyAgentAnnouncement(hp, announcement({ docRoom: "doc:p1:body", range: null }));
    applyAgentAnnouncement(hp, announcement({ docRoom: "doc:p1:body" }));
    applyAgentAnnouncement(hp, announcement({ docRoom: "doc:p1:body", touched: ["b3"] }));
    const cursor = doc.awareness.getStates().get(ID)!.cursor;
    expect(resolve(doc, cursor.anchor)).toEqual({ text: "Added", index: 5 });
    expect(resolve(doc, cursor.head)).toEqual({ text: "Added", index: 5 });
  });

  it("puts the caret straight at the end of the edit, since the block tint is the highlight", () => {
    const doc = liveDoc(["Intro", "Outro"]);
    const before = rewrite(doc, ["Intro", "Added", "Outro"]);
    const range = changedTextRange(before, doc);
    applyAgentAnnouncement(
      fakeHocuspocus({ "doc:p1:body": doc }),
      announcement({ docRoom: "doc:p1:body", range, touched: ["b2"] }),
    );
    const cursor = doc.awareness.getStates().get(ID)!.cursor;
    expect(resolve(doc, cursor.anchor)).toEqual({ text: "Added", index: 5 });
    expect(resolve(doc, cursor.head)).toEqual({ text: "Added", index: 5 });
  });

  it("is published capped by the announcer", async () => {
    const ids = Array.from({ length: 41 }, (_, i) => `b${i}`);
    vi.useRealTimers();
    await asAgent(() => announceAgent({ action: "editing", docRoom: "doc:p1:body", touched: ids }));
    expect(JSON.parse(publish.mock.calls[0]![1]).touched).toEqual(ids.slice(1));
  });
});

describe("presence over time", () => {
  beforeEach(() => vi.useFakeTimers());

  it("stays AGENT_LINGER_MS after the last announcement", () => {
    const room = liveDoc(["Hello"]);
    const { viewer } = viewerOf(room);
    applyAgentAnnouncement(fakeHocuspocus({ "doc:p1:body": room }), announcement({ docRoom: "doc:p1:body" }));

    vi.advanceTimersByTime(AGENT_LINGER_MS - 1);
    expect(room.awareness.getStates().has(ID)).toBe(true);
    expect(viewer.getStates().has(ID)).toBe(true);

    vi.advanceTimersByTime(1);
    expect(room.awareness.getStates().has(ID)).toBe(false);
    expect(viewer.getStates().has(ID)).toBe(false);
  });

  it("sends the state again every AGENT_RENEW_MS with a newer clock", () => {
    const room = liveDoc([]);
    applyAgentAnnouncement(fakeHocuspocus({ "presence:doc:p1": room }), announcement({ presenceRoom: "presence:doc:p1" }));
    const clock = () => room.awareness.meta.get(ID)!.clock;
    const first = clock();
    vi.advanceTimersByTime(AGENT_RENEW_MS);
    expect(clock()).toBeGreaterThan(first);
    const second = clock();
    vi.advanceTimersByTime(AGENT_RENEW_MS);
    expect(clock()).toBeGreaterThan(second);
  });

  it("comes back to a viewer that timed it out while disconnected", () => {
    const room = liveDoc(["Hello"]);
    const { viewer, link } = viewerOf(room);
    applyAgentAnnouncement(fakeHocuspocus({ "doc:p1:body": room }), announcement({ docRoom: "doc:p1:body" }));
    link.connected = false;
    vi.advanceTimersByTime(AGENT_RENEW_MS);
    // What awareness's own 30 s outdated check does: drop the state, remember its clock.
    removeAwarenessStates(viewer, [ID], "timeout");
    expect(viewer.getStates().has(ID)).toBe(false);

    link.connected = true;
    vi.advanceTimersByTime(AGENT_RENEW_MS);
    expect(viewer.getStates().has(ID)).toBe(true);
  });

  it("shows up in a room this machine loads after the announcement", () => {
    const docs: Record<string, LiveDoc> = {};
    const hp = fakeHocuspocus(docs);
    applyAgentAnnouncement(hp, announcement({ presenceRoom: "presence:doc:p1" }));
    const room = liveDoc([]);
    (hp.documents as unknown as Map<string, LiveDoc>).set("presence:doc:p1", room);
    vi.advanceTimersByTime(AGENT_RENEW_MS);
    expect(room.awareness.getStates().get(ID)!.user.name).toBe("Claude");
  });
});

describe("agent sessions", () => {
  beforeEach(() => vi.useFakeTimers());

  const agentsIn = (room: LiveDoc) =>
    [...room.awareness.getStates().entries()]
      .filter(([, s]) => s.user?.agent)
      .map(([id, s]) => ({ id, name: s.user.name as string, color: s.user.color as string }));

  it("gives each session of one person its own entry, colour and number", () => {
    const room = liveDoc([]);
    const hp = fakeHocuspocus({ "presence:doc:p1": room });
    applyAgentAnnouncement(hp, announcement({ presenceRoom: "presence:doc:p1", session: "g1", at: 1 }));
    applyAgentAnnouncement(hp, announcement({ presenceRoom: "presence:doc:p1", session: "g2", at: 2 }));

    const [first, second] = agentsIn(room).sort((a, b) => a.name.localeCompare(b.name));
    expect(first).toMatchObject({ name: "Claude", color: AGENT_COLORS.claude, id: agentClientId("u-ada", "claude", "g1") });
    expect(second!.name).toBe("Claude 2");
    expect(second!.color).not.toBe(AGENT_COLORS.claude);
    expect(AGENT_SESSION_COLORS).toContain(second!.color);
    expect(second!.id).not.toBe(first!.id);
  });

  it("numbers by first activity and drops the number when one is left", () => {
    const room = liveDoc([]);
    const hp = fakeHocuspocus({ "presence:doc:p1": room });
    const say = (session: string, at: number) =>
      applyAgentAnnouncement(hp, announcement({ presenceRoom: "presence:doc:p1", session, at }));
    say("g1", 1);
    say("g2", 2);
    say("g3", 3);
    expect(agentsIn(room).map((a) => a.name).sort()).toEqual(["Claude", "Claude 2", "Claude 3"]);

    vi.advanceTimersByTime(AGENT_LINGER_MS / 2);
    say("g2", 4);
    say("g3", 5);
    const before = agentsIn(room);
    vi.advanceTimersByTime(AGENT_LINGER_MS / 2);
    const after = agentsIn(room);
    expect(after.map((a) => a.name).sort()).toEqual(["Claude", "Claude 2"]);
    // Renamed sessions return as new clients: editors never relabel a caret.
    expect(after.some((a) => before.some((b) => b.id === a.id))).toBe(false);
    expect(after.find((a) => a.name === "Claude")!.id).toBe(agentClientId("u-ada", "claude", "g2"));

    vi.advanceTimersByTime(AGENT_LINGER_MS / 2 - 1);
    say("g3", 6);
    vi.advanceTimersByTime(1);
    expect(agentsIn(room)).toEqual([
      { id: agentClientId("u-ada", "claude", "g3"), name: "Claude", color: AGENT_COLORS.claude },
    ]);
  });

  it("numbers by session key, so machines that saw sessions in a different order agree", async () => {
    vi.resetModules();
    const other = await import("../agent-presence.server");
    const roomA = liveDoc([]);
    const roomB = liveDoc([]);
    const say = (apply: typeof applyAgentAnnouncement, room: LiveDoc, session: string) =>
      apply(fakeHocuspocus({ "presence:doc:p1": room }), announcement({ presenceRoom: "presence:doc:p1", session }));
    say(applyAgentAnnouncement, roomA, "g2");
    say(applyAgentAnnouncement, roomA, "g1");
    say(other.applyAgentAnnouncement, roomB, "g1");
    say(other.applyAgentAnnouncement, roomB, "g2");

    const sorted = (room: LiveDoc) => agentsIn(room).sort((a, b) => a.id - b.id);
    expect(sorted(roomA)).toEqual(sorted(roomB));
    expect(sorted(roomA).map((a) => a.name).sort()).toEqual(["Claude", "Claude 2"]);
    expect(agentsIn(roomA).find((a) => a.name === "Claude")!.id).toBe(agentClientId("u-ada", "claude", "g1"));
    vi.advanceTimersByTime(AGENT_LINGER_MS);
  });

  it("gives a session the same name and colour in the page's presence bar and its body", () => {
    const bar = liveDoc([]);
    const body = liveDoc(["Hello"]);
    const hp = fakeHocuspocus({ "presence:doc:p1": bar, "doc:p1:body": body });
    applyAgentAnnouncement(hp, announcement({ action: "reading", presenceRoom: "presence:doc:p1", session: "g1" }));
    applyAgentAnnouncement(hp, announcement({ docRoom: "doc:p1:body", session: "g2" }));
    expect(agentsIn(body).map((a) => a.name)).toEqual(["Claude 2"]);
    applyAgentAnnouncement(hp, announcement({ docRoom: "doc:p1:body", session: "g1" }));

    const look = (room: LiveDoc) =>
      Object.fromEntries(agentsIn(room).map((a) => [a.name, a.color]));
    expect(look(bar)).toEqual({ Claude: AGENT_COLORS.claude });
    expect(look(body)).toEqual({ Claude: AGENT_COLORS.claude, "Claude 2": expect.any(String) });
    expect(agentsIn(body).find((a) => a.name === "Claude")!.id).toBe(agentClientId("u-ada", "claude", "g1"));
  });

  it("numbers separately per room, per person and per agent kind", () => {
    const room = liveDoc([]);
    const hp = fakeHocuspocus({ "presence:doc:p1": room });
    applyAgentAnnouncement(hp, announcement({ presenceRoom: "presence:doc:p1", session: "g1", at: 1 }));
    applyAgentAnnouncement(hp, announcement({ presenceRoom: "presence:doc:p1", session: "g2", userId: "u-grace", at: 2 }));
    applyAgentAnnouncement(
      hp,
      announcement({ presenceRoom: "presence:doc:p1", session: "g3", kind: "cursor", name: "Cursor", at: 3 }),
    );
    expect(agentsIn(room).map((a) => a.name).sort()).toEqual(["Claude", "Claude", "Cursor"]);
  });

  it("drops a renamed session's pending batch so viewers don't replay it", () => {
    const doc = liveDoc(["Hello"]);
    const hp = fakeHocuspocus({ "doc:p1:body": doc });
    applyAgentAnnouncement(hp, announcement({ docRoom: "doc:p1:body", session: "g1", at: 1 }));
    vi.advanceTimersByTime(AGENT_LINGER_MS - 1_000);
    applyAgentAnnouncement(hp, announcement({ docRoom: "doc:p1:body", session: "g2", at: 2, touched: ["b1"] }));
    vi.advanceTimersByTime(1_000);
    const [only] = [...doc.awareness.getStates().values()].filter((s) => s.user?.agent);
    expect(only!.user.name).toBe("Claude");
    expect(only).not.toHaveProperty("touched");
  });
});

describe("agentDocKey", () => {
  it("maps a page's presence room and body room to one document", () => {
    expect(agentDocKey("presence:doc:p1")).toBe("doc:p1");
    expect(agentDocKey("doc:p1:body")).toBe("doc:p1");
    expect(agentDocKey("blogPost:b1:body")).toBe("blogPost:b1");
  });

  it("maps a slide deck's room to its page, so the deck and the page bar share one look", () => {
    expect(agentDocKey("slides:p1:deck")).toBe("doc:p1");
  });
});

describe("slide decks", () => {
  beforeEach(() => vi.useFakeTimers());

  const room = () => {
    const doc = new Y.Doc() as LiveDoc;
    doc.awareness = new Awareness(doc);
    return doc;
  };

  it("puts the agent on the slide it changed, with its look and kind", () => {
    const deck = room();
    applyAgentAnnouncement(fakeHocuspocus({ "slides:p1:deck": deck }), announcement({ deckRoom: "slides:p1:deck", slideId: "s2" }));
    const state = deck.awareness.getStates().get(ID)!;
    expect(state.user).toEqual({ name: "Claude", color: AGENT_COLORS.claude, agent: { kind: "claude", action: "editing" } });
    expect(state.deckSlide).toEqual({ slideId: "s2", userId: "u-ada", name: "Claude", color: AGENT_COLORS.claude, photoUrl: null, agent: { kind: "claude" } });
    expect(state).not.toHaveProperty("cursor");
  });

  it("is in the deck on no slide until a write names one, then stays on the last one named", () => {
    const deck = room();
    const hp = fakeHocuspocus({ "slides:p1:deck": deck });
    applyAgentAnnouncement(hp, announcement({ action: "reading", deckRoom: "slides:p1:deck" }));
    expect(deck.awareness.getStates().get(ID)!.deckSlide).toBeNull();
    applyAgentAnnouncement(hp, announcement({ deckRoom: "slides:p1:deck", slideId: "s1" }));
    applyAgentAnnouncement(hp, announcement({ deckRoom: "slides:p1:deck" }));
    expect(deck.awareness.getStates().get(ID)!.deckSlide.slideId).toBe("s1");
  });

  it("carries touched element keys and drops them after AGENT_TOUCH_MS", () => {
    const deck = room();
    applyAgentAnnouncement(fakeHocuspocus({ "slides:p1:deck": deck }), announcement({ deckRoom: "slides:p1:deck", slideId: "s1", touched: ["s1/title"] }));
    expect(deck.awareness.getStates().get(ID)!.touched.ids).toEqual(["s1/title"]);
    vi.advanceTimersByTime(AGENT_TOUCH_MS);
    expect(deck.awareness.getStates().get(ID)).not.toHaveProperty("touched");
    expect(deck.awareness.getStates().get(ID)!.deckSlide.slideId).toBe("s1");
  });

  it("joins the page's presence bar and the deck in one announcement", () => {
    const bar = room();
    const deck = room();
    applyAgentAnnouncement(
      fakeHocuspocus({ "presence:doc:p1": bar, "slides:p1:deck": deck }),
      announcement({ presenceRoom: "presence:doc:p1", deckRoom: "slides:p1:deck", slideId: "s1" }),
    );
    expect(bar.awareness.getStates().get(ID)!.user.subtitle).toBe("Ada Lovelace's agent");
    expect(deck.awareness.getStates().get(ID)!.deckSlide.slideId).toBe("s1");
  });

  it("publishes the slide and touched keys from the announcer", async () => {
    vi.useRealTimers();
    await asAgent(() => announceAgent({ action: "editing", deckRoom: "slides:p1:deck", slideId: "s1", touched: ["s1/e1"] }));
    expect(JSON.parse(publish.mock.calls[0]![1])).toMatchObject({ deckRoom: "slides:p1:deck", slideId: "s1", touched: ["s1/e1"] });
  });
});

describe("across machines", () => {
  beforeEach(() => vi.useFakeTimers());

  /** Another machine's copy of the same agent entry, forwarded by Redis with a higher clock. */
  function forwardFromElsewhere(room: LiveDoc, clock: number, state: Record<string, unknown>) {
    const elsewhere = new Awareness(Object.assign(new Y.Doc(), { clientID: ID }));
    elsewhere.meta.set(ID, { clock, lastUpdated: Date.now() });
    elsewhere.setLocalState(state);
    applyAwarenessUpdate(room.awareness, encodeAwarenessUpdate(elsewhere, [ID]), "redis");
    elsewhere.destroy();
  }

  it("publishes above a newer clock another machine forwarded, so its next batch still lands", () => {
    const room = liveDoc(["Hello"]);
    const { viewer } = viewerOf(room);
    const hp = fakeHocuspocus({ "doc:p1:body": room });
    applyAgentAnnouncement(hp, announcement({ docRoom: "doc:p1:body", touched: ["b1"] }));
    const ahead = room.awareness.meta.get(ID)!.clock + 50;
    forwardFromElsewhere(room, ahead, { user: { name: "Claude" }, touched: { ids: ["old"], seq: 1 } });

    applyAgentAnnouncement(hp, announcement({ docRoom: "doc:p1:body", touched: ["b2"] }));
    expect(room.awareness.meta.get(ID)!.clock).toBeGreaterThan(ahead);
    expect(viewer.getStates().get(ID)!.touched.ids).toEqual(["b2"]);
  });

  it("renews above a forwarded clock too, and still leaves", () => {
    const room = liveDoc([]);
    const { viewer } = viewerOf(room);
    const hp = fakeHocuspocus({ "presence:doc:p1": room });
    applyAgentAnnouncement(hp, announcement({ presenceRoom: "presence:doc:p1" }));
    forwardFromElsewhere(room, 1_000, { user: { name: "Stale" } });
    vi.advanceTimersByTime(AGENT_RENEW_MS);
    expect(viewer.getStates().get(ID)!.user.name).toBe("Claude");

    forwardFromElsewhere(room, room.awareness.meta.get(ID)!.clock + 50, { user: { name: "Claude" } });
    vi.advanceTimersByTime(AGENT_LINGER_MS - AGENT_RENEW_MS);
    expect(room.awareness.getStates().has(ID)).toBe(false);
    expect(viewer.getStates().has(ID)).toBe(false);
  });
});

describe("republishAgents", () => {
  beforeEach(() => vi.useFakeTimers());

  it("re-sends a room's agents as newer, for a client that just reconnected", () => {
    const room = liveDoc(["Hello"]);
    const { viewer } = viewerOf(room);
    applyAgentAnnouncement(fakeHocuspocus({ "doc:p1:body": room }), announcement({ docRoom: "doc:p1:body" }));
    removeAwarenessStates(viewer, [ID], "timeout");
    republishAgents("presence:doc:other");
    expect(viewer.getStates().has(ID)).toBe(false);
    republishAgents("doc:p1:body");
    expect(viewer.getStates().has(ID)).toBe(true);
  });
});

describe("blockPosition", () => {
  const doc = blockDoc([
    { id: "b1", runs: ["abc", { inline: "mention" }, "def"], children: [{ id: "c1", runs: ["child"] }] },
    { id: "empty", runs: [] },
  ]);
  const at = (point: Parameters<typeof blockPosition>[1]) => landing(doc, Y.relativePositionToJSON(blockPosition(doc, point)!));

  it("counts an offset across text runs, with inline elements as zero characters", () => {
    expect(at({ blockId: "b1", offset: 1 })).toEqual({ text: "abc", index: 1 });
    expect(at({ blockId: "b1", offset: 3 })).toEqual({ text: "def", index: 0 });
    expect(at({ blockId: "b1", offset: 4 })).toEqual({ text: "def", index: 1 });
  });

  it("clamps the offset to the block's own text, never its children's", () => {
    expect(at({ blockId: "b1", offset: 99 })).toEqual({ text: "def", index: 3 });
    expect(at({ blockId: "b1", offset: -5 })).toEqual({ text: "abc", index: 0 });
    expect(at({ blockId: "c1", offset: 2 })).toEqual({ text: "child", index: 2 });
  });

  it("goes to the start or (by default) the end without an offset", () => {
    expect(at({ blockId: "b1", at: "start" })).toEqual({ text: "abc", index: 0 });
    expect(at({ blockId: "b1" })).toEqual({ text: "def", index: 3 });
  });

  it("puts the caret in a block with no text", () => {
    expect(at({ blockId: "empty", offset: 3 }).index).toBe(0);
  });

  it("is null for a block that isn't there", () => {
    expect(blockPosition(doc, { blockId: "nope" })).toBeNull();
  });
});

describe("pointAgent", () => {
  let detach: () => void = () => {};
  const ROOM = "doc:p1:body";

  function machine(docs: Record<string, LiveDoc>) {
    detach = attachAgentPresence(fakeHocuspocus(docs));
    const handler = subscribe.mock.calls.at(-1)![1];
    publish.mockImplementation((_topic: string, data: string) => handler("change", data));
  }

  afterEach(() => {
    detach();
    detach = () => {};
    vi.unstubAllEnvs();
  });

  it("puts the agent's caret in the block, resolved where the doc is", async () => {
    const doc = blockDoc([{ id: "b1", runs: ["Hello world"] }]);
    machine({ [ROOM]: doc });
    await asAgent(async () => pointAgent({ docRoom: ROOM, blockId: "b1", offset: 6 }));

    const msg = JSON.parse(publish.mock.calls[0]![1]);
    expect(msg).toMatchObject({ action: "pointing", docRoom: ROOM, point: { blockId: "b1", offset: 6 } });
    const state = doc.awareness.getStates().get(ID)!;
    expect(state.user.agent).toEqual({ kind: "claude", action: "pointing" });
    expect(landing(doc, state.cursor.anchor)).toEqual({ text: "Hello world", index: 6 });
    expect(landing(doc, state.cursor.head)).toEqual({ text: "Hello world", index: 6 });
  });

  it("selects from the point to another block's start", async () => {
    const doc = blockDoc([
      { id: "b1", runs: ["Hello"] },
      { id: "b2", runs: ["World"] },
    ]);
    machine({ [ROOM]: doc });
    await asAgent(async () =>
      pointAgent({ docRoom: ROOM, blockId: "b1", at: "end", selectTo: { blockId: "b2", at: "start" } }),
    );
    const { cursor } = doc.awareness.getStates().get(ID)!;
    expect(landing(doc, cursor.anchor)).toEqual({ text: "Hello", index: 5 });
    expect(landing(doc, cursor.head)).toEqual({ text: "World", index: 0 });
  });

  it("keeps the caret on its character while someone types in front of it", async () => {
    const doc = blockDoc([{ id: "b1", runs: ["Hello world"] }]);
    machine({ [ROOM]: doc });
    await asAgent(async () => pointAgent({ docRoom: ROOM, blockId: "b1", offset: 6 }));
    const text = ((doc.getXmlFragment("blocknote").get(0) as Y.XmlElement).get(0) as Y.XmlElement)
      .get(0) as Y.XmlElement;
    (text.get(0) as Y.XmlText).insert(0, ">> ");
    expect(landing(doc, doc.awareness.getStates().get(ID)!.cursor.head)).toEqual({ text: ">> Hello world", index: 9 });
  });

  it("throws BLOCK_NOT_FOUND for an unknown block and announces nothing", async () => {
    machine({ [ROOM]: blockDoc([{ id: "b1", runs: ["Hello"] }]) });
    const missing = asAgent(async () => pointAgent({ docRoom: ROOM, blockId: "nope" }));
    await expect(missing).rejects.toBeInstanceOf(AgentBlockNotFoundError);
    await expect(missing).rejects.toMatchObject({ code: "BLOCK_NOT_FOUND", blockId: "nope" });
    await expect(
      asAgent(async () => pointAgent({ docRoom: ROOM, blockId: "b1", selectTo: { blockId: "gone" } })),
    ).rejects.toMatchObject({ blockId: "gone" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("shows no caret on a machine whose copy lacks the block", () => {
    vi.useFakeTimers();
    const doc = blockDoc([{ id: "b1", runs: ["Hello"] }]);
    applyAgentAnnouncement(
      fakeHocuspocus({ [ROOM]: doc }),
      announcement({ action: "pointing", docRoom: ROOM, point: { blockId: "other" } }),
    );
    expect(doc.awareness.getStates().get(ID)!.cursor).toBeNull();
  });

  it("reports how many people have the doc open here, not counting agents", async () => {
    const doc = blockDoc([{ id: "b1", runs: ["Hello"] }]);
    machine({ [ROOM]: doc });
    expect(docViewerCount(ROOM)).toBe(0);
    addPerson(doc, "Ada");
    addPerson(doc, "Grace");
    expect(await asAgent(async () => pointAgent({ docRoom: ROOM, blockId: "b1" }))).toEqual({ seen: 2 });
    expect(docViewerCount(ROOM)).toBe(2);
  });

  it("can't tell who sees it when another machine might have the doc", async () => {
    machine({});
    vi.stubEnv("REDIS_URL", "redis://example");
    expect(await asAgent(async () => pointAgent({ docRoom: ROOM, blockId: "b1" }))).toEqual({ seen: null });
    expect(publish).toHaveBeenCalledTimes(1);
    vi.stubEnv("REDIS_URL", "");
    expect(docViewerCount(ROOM)).toBe(0);
  });

  it("reports viewers but announces nothing outside an MCP request", () => {
    const doc = blockDoc([{ id: "b1", runs: ["Hello"] }]);
    machine({ [ROOM]: doc });
    addPerson(doc, "Ada");
    expect(pointAgent({ docRoom: ROOM, blockId: "b1" })).toEqual({ seen: 1 });
    expect(publish).not.toHaveBeenCalled();
  });
});
