import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const h = vi.hoisted(() => ({
  announce: vi.fn(),
  server: null as null | { hocuspocus: { openDirectConnection: (name: string) => Promise<unknown> } },
  findUnique: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({ prisma: { collabDocument: { findUnique: h.findUnique } } }));
vi.mock("../server", () => ({ getCollabServer: () => h.server }));
vi.mock("../persistence", () => ({ storeDocument: vi.fn().mockResolvedValue(null), maybeSnapshot: vi.fn() }));
vi.mock("../agent-presence.server", () => ({
  agentAnnouncer: async () => h.announce,
  pagePresenceRoom: (pageId: string) => `presence:doc:${pageId}`,
}));

import { addSlide, slideFragment } from "~/components/slides/deck/deck-ops";
import { addShape } from "~/components/slides/deck/freeform-ops";
import { initDeck } from "~/components/slides/deck/model";
import { transactDeck } from "../deck-live.server";

function storedDeck() {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, "content", null);
  return { state: Buffer.from(Y.encodeStateAsUpdate(doc)), slideId };
}

beforeEach(() => {
  h.announce.mockReset();
  h.findUnique.mockReset();
  h.server = null;
});

describe("transactDeck", () => {
  it("announces the agent's edit on the page bar and the deck, at the slide and elements it changed", async () => {
    const { state, slideId } = storedDeck();
    h.findUnique.mockResolvedValue({ state });
    let id: string | null = null;
    await transactDeck("p1", "u1", (doc) => {
      id = addShape(doc, slideId, "rect");
    });
    expect(h.announce).toHaveBeenCalledTimes(1);
    expect(h.announce).toHaveBeenCalledWith({
      action: "editing",
      presenceRoom: "presence:doc:p1",
      deckRoom: "slides:p1:deck",
      slideId,
      touched: [`${slideId}/${id}`],
    });
  });

  it("announces on the live document when a collab server holds it", async () => {
    const { state, slideId } = storedDeck();
    const live = new Y.Doc();
    Y.applyUpdate(live, new Uint8Array(state));
    h.server = {
      hocuspocus: {
        openDirectConnection: async () => ({
          transact: async (fn: (d: Y.Doc) => void) => fn(live),
          disconnect: async () => {},
        }),
      },
    };
    await transactDeck("p1", "u1", (doc) => {
      slideFragment(doc, slideId, "title")!.insert(0, [new Y.XmlText("Hi")]);
    });
    expect(h.announce).toHaveBeenCalledWith(expect.objectContaining({ slideId, touched: [`${slideId}/title`] }));
  });

  it("leaves out the slide when nothing on a slide changed", async () => {
    h.findUnique.mockResolvedValue({ state: storedDeck().state });
    await transactDeck("p1", "u1", (doc) => doc.getMap("deck").set("themeId", "dali-light"));
    expect(h.announce).toHaveBeenCalledWith({ action: "editing", presenceRoom: "presence:doc:p1", deckRoom: "slides:p1:deck", touched: [] });
  });
});
