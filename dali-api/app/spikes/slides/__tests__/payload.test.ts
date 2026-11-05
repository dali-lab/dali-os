import { describe, it, expect, afterAll } from "vitest";
import * as Y from "yjs";
import WebSocket from "ws";
import { Server } from "@hocuspocus/server";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { addSlide, addTextElement, initDeck, slidesMap } from "../deck-model";

const WORDS = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore".split(" ");
function paragraph(seed: number, chars: number): string {
  let s = "";
  let i = seed;
  while (s.length < chars) s += WORDS[(i++ * 7) % WORDS.length] + " ";
  return s.trim();
}

function buildDeck(slides: number, textPerSlide: number, elementsPerSlide: number, notesChars = 0) {
  const doc = new Y.Doc();
  initDeck(doc);
  const updates: Uint8Array[] = [];
  for (let i = 0; i < slides; i++) {
    addSlide(doc, `slide-${i}`, i + 1);
    for (let e = 0; e < elementsPerSlide; e++) {
      addTextElement(doc, `slide-${i}`, `el-${e}`, undefined, paragraph(i * 10 + e, textPerSlide / elementsPerSlide));
    }
  }
  void notesChars;
  void updates;
  return doc;
}

describe("payload sizes", () => {
  it("measures a realistic 100-slide deck and a ~2MB single transaction", () => {
    const realistic = buildDeck(100, 900, 4);
    const realisticState = Y.encodeStateAsUpdate(realistic).byteLength;

    const heavy = new Y.Doc();
    const captured: Uint8Array[] = [];
    heavy.on("update", (u: Uint8Array) => captured.push(u));
    heavy.transact(() => {
      initDeck(heavy);
      for (let i = 0; i < 60; i++) {
        addSlide(heavy, `s${i}`, i);
        for (let e = 0; e < 4; e++) addTextElement(heavy, `s${i}`, `e${e}`, undefined, paragraph(i + e, 8000));
      }
    });
    const maxSingleUpdate = Math.max(...captured.map((u) => u.byteLength));
    console.log(
      `PAYLOAD realistic100SlideState=${realisticState}B heavy60SlideSingleUpdate=${maxSingleUpdate}B`,
    );
    expect(maxSingleUpdate).toBeGreaterThan(1_048_576);
    expect(maxSingleUpdate).toBeLessThan(4_194_304);
    expect(realisticState).toBeGreaterThan(0);
    // the transaction yields exactly one update message (initDeck/addSlide nest into the outer transact)
    expect(captured.length).toBe(1);
  });
});

const servers: Server[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => s.destroy()));
});

async function startServer(maxPayload: number) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const server = new Server({ port, quiet: true, debounce: 0 }, { maxPayload });
  await server.listen();
  servers.push(server);
  return { server, port };
}

async function connect(port: number, name: string) {
  const doc = new Y.Doc();
  let closes = 0;
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${port}`,
    name,
    document: doc,
    WebSocketPolyfill: WebSocket as never,
    onClose: () => void closes++,
  });
  await new Promise<void>((resolve) => provider.on("synced", () => resolve()));
  return { doc, provider, closes: () => closes };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendBigTransaction(maxPayload: number, name: string) {
  const { server, port } = await startServer(maxPayload);
  const client = await connect(port, name);
  const big = new Y.Doc();
  big.transact(() => {
    initDeck(big);
    for (let i = 0; i < 60; i++) {
      addSlide(big, `s${i}`, i);
      for (let e = 0; e < 4; e++) addTextElement(big, `s${i}`, `e${e}`, undefined, paragraph(i + e, 8000));
    }
  });
  const update = Y.encodeStateAsUpdate(big);
  const closesBefore = client.closes();
  Y.applyUpdate(client.doc, update);
  await sleep(800);
  const serverDoc = server.hocuspocus.documents.get(name);
  const received = serverDoc ? slidesMap(serverDoc).size : 0;
  const closesAfter = client.closes();
  client.provider.destroy();
  return { received, update: update.byteLength, reconnectCloses: closesAfter - closesBefore };
}

describe("Hocuspocus maxPayload with a ~2MB client transaction", () => {
  it("1MB limit rejects it (socket closed, server never gets the slides)", async () => {
    const r = await sendBigTransaction(1_048_576, "slides:limit1mb:deck");
    console.log(`PAYLOAD 1MB-limit ${JSON.stringify(r)}`);
    expect(r.update).toBeGreaterThan(1_048_576);
    expect(r.received).toBe(0);
    expect(r.reconnectCloses).toBeGreaterThan(0);
  }, 20_000);

  it("4MB limit accepts it", async () => {
    const r = await sendBigTransaction(4_194_304, "slides:limit4mb:deck");
    console.log(`PAYLOAD 4MB-limit ${JSON.stringify(r)}`);
    expect(r.received).toBe(60);
  }, 20_000);
});
