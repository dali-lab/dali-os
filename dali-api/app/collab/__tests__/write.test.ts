import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: {} }));
const getCollabServer = vi.fn();
vi.mock("../server", () => ({ getCollabServer }));
vi.mock("../persistence", () => ({ maybeSnapshot: vi.fn(), storeDocument: vi.fn() }));
const blocksToFragment = vi.fn();
vi.mock("../blocknote-server", () => ({ BLOCKNOTE_FRAGMENT: "blocknote", blocksToFragment }));
vi.mock("../legacy/pm-to-blocknote", () => ({ ensureBlocks: (c: unknown) => c }));
const announce = vi.fn();
const agentAnnouncer = vi.fn();
const changedTextRange = vi.fn();
vi.mock("../agent-presence.server", () => ({
  agentAnnouncer,
  bodyTexts: () => [],
  changedTextRange,
}));

const { replaceCollabDocContent } = await import("../write");

function fakeServer() {
  let finishStore!: () => void;
  const events: string[] = [];
  const conn = {
    transact: vi.fn((fn: (doc: { getXmlFragment: () => unknown }) => void) => {
      fn({ getXmlFragment: () => ({}) });
      events.push("body written");
      return new Promise<void>((res) => {
        finishStore = () => {
          events.push("stored");
          res();
        };
      });
    }),
    disconnect: vi.fn(async () => {
      events.push("disconnected");
    }),
  };
  getCollabServer.mockReturnValue({ hocuspocus: { openDirectConnection: vi.fn(async () => conn) } });
  announce.mockImplementation(() => events.push("announced"));
  return { conn, events, finishStore: () => finishStore() };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  agentAnnouncer.mockResolvedValue(announce);
  changedTextRange.mockReturnValue({ start: "s", end: "e" });
});

describe("replaceCollabDocContent on a live server", () => {
  it("announces the agent as soon as the body changes, before the save finishes", async () => {
    const { events, finishStore } = fakeServer();
    const done = replaceCollabDocContent("doc:p1:body", [], "u-ada");
    await flush();

    expect(events).toEqual(["body written", "announced"]);
    expect(announce).toHaveBeenCalledWith({
      action: "editing",
      docRoom: "doc:p1:body",
      range: { start: "s", end: "e" },
    });

    finishStore();
    await done;
    expect(events).toEqual(["body written", "announced", "stored", "disconnected"]);
  });

  it("starts the flag lookup before opening the document", async () => {
    fakeServer();
    const order: string[] = [];
    agentAnnouncer.mockImplementation(() => {
      order.push("flag");
      return Promise.resolve(announce);
    });
    const open = getCollabServer().hocuspocus.openDirectConnection;
    open.mockImplementation(async () => {
      order.push("open");
      return { transact: vi.fn(async (fn: (d: unknown) => void) => fn({ getXmlFragment: () => ({}) })), disconnect: vi.fn() };
    });
    await replaceCollabDocContent("doc:p1:body", [], "u-ada");
    expect(order).toEqual(["flag", "open"]);
  });

  it("still disconnects when the save fails", async () => {
    const { conn } = fakeServer();
    conn.transact.mockImplementationOnce(async () => {
      throw new Error("store failed");
    });
    await expect(replaceCollabDocContent("doc:p1:body", [], "u-ada")).rejects.toThrow("store failed");
    expect(conn.disconnect).toHaveBeenCalled();
  });
});
