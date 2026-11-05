import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as Y from "yjs";
import pg from "pg";
import type { Slide } from "~/components/slides/types";
import { loadOrConvertDeck, seedDeckDoc, slideCount, type ConversionStore } from "../convert";
import { readDeck, slidesMap } from "../deck-model";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LEGACY: Slide[] = [
  { id: "a", layout: "title", title: "Hello", subtitle: "Sub", notes: "say hi" },
  { id: "b", layout: "content", title: "Agenda", body: [{ type: "paragraph", content: "one two" }] as never },
  { id: "c", layout: "image", title: "Photo", image: { src: "https://x/y.png", alt: "y" } },
];

describe("seedDeckDoc", () => {
  it("maps the legacy JSON to keyed slides with text fragments, notes and image elements", () => {
    const doc = new Y.Doc();
    seedDeckDoc(doc, LEGACY);
    const read = readDeck(doc);
    expect(read.slides.map((s) => [s.id, s.layoutId])).toEqual([["a", "title"], ["b", "content"], ["c", "image"]]);
    expect(read.slides[0].notes.text).toBe("say hi");
    expect(read.slides[1].elements.find((e) => e.id === "body")!.text).toBe("one two");
    expect(read.plainText).toContain("Hello");
    expect(slidesMap(doc).get("c")!.get("elements")).toBeInstanceOf(Y.Map);
  });
});

function memoryStore(): ConversionStore & { rows: Map<string, Uint8Array>; flips: number } {
  const rows = new Map<string, Uint8Array>();
  let chain: Promise<unknown> = Promise.resolve();
  const store = {
    rows,
    flips: 0,
    withLock<T>(_name: string, fn: (tx: never) => Promise<T>): Promise<T> {
      const run = chain.then(() =>
        fn({
          getState: async (n: string) => rows.get(n) ?? null,
          putState: async (n: string, s: Uint8Array) => void rows.set(n, s),
          flipStorage: async () => (++store.flips, true),
        } as never),
      );
      chain = run.catch(() => {});
      return run;
    },
  };
  return store as never;
}

describe("conversion logic with a fake lock", () => {
  it("two concurrent conversions: one converts, the other returns the stored state", async () => {
    const store = memoryStore();
    const read = async () => LEGACY;
    const [r1, r2] = await Promise.all([
      loadOrConvertDeck(store, "slides:p:deck", read),
      loadOrConvertDeck(store, "slides:p:deck", read),
    ]);
    expect([r1.converted, r2.converted].sort()).toEqual([false, true]);
    expect(r1.state).toEqual(r2.state);
    expect(slideCount(r1.state)).toBe(3);
    expect(store.flips).toBe(1);
  });
});

describe("why deterministic-clientID seeding is unsafe", () => {
  const seedWith = (clientID: number, slides: Slide[]) => {
    const d = new Y.Doc();
    d.clientID = clientID;
    seedDeckDoc(d, slides);
    return d;
  };

  it("identical content + fixed clientID dedupes (the premise)", () => {
    const live = new Y.Doc();
    Y.applyUpdate(live, Y.encodeStateAsUpdate(seedWith(7, LEGACY)));
    Y.applyUpdate(live, Y.encodeStateAsUpdate(seedWith(7, LEGACY)));
    expect(readDeck(live).slides.length).toBe(3);
  });

  it("but block ids come from the server editor, so two 'identical' seeds already differ in content", () => {
    const a = readDeck(seedWith(7, LEGACY));
    const b = readDeck(seedWith(7, LEGACY));
    const ids = (r: ReturnType<typeof readDeck>) => r.slides.flatMap((s) => s.elements.flatMap((e) => e.blocks.map((bl) => bl.id)));
    expect(ids(a)).not.toEqual(ids(b));
  });

  it("re-seeding an already-converted doc with the same clientID but changed content is silently dropped, and replicas diverge", () => {
    const changed = LEGACY.map((s) => (s.id === "a" ? { ...s, title: "Hello CHANGED" } : s));
    const first = seedWith(7, LEGACY);
    const second = seedWith(7, changed);

    const replica1 = new Y.Doc();
    const replica2 = new Y.Doc();
    Y.applyUpdate(replica1, Y.encodeStateAsUpdate(first));
    Y.applyUpdate(replica2, Y.encodeStateAsUpdate(second));
    Y.applyUpdate(replica1, Y.encodeStateAsUpdate(replica2));
    Y.applyUpdate(replica2, Y.encodeStateAsUpdate(replica1));

    const t1 = readDeck(replica1).plainText;
    const t2 = readDeck(replica2).plainText;
    console.log(`DETERMINISTIC-SEED replica1=${JSON.stringify(t1.slice(0, 40))} replica2=${JSON.stringify(t2.slice(0, 40))}`);
    expect(t1).not.toBe(t2);
    expect(Y.encodeStateVector(replica1)).toEqual(Y.encodeStateVector(replica2));
  });
});

const PG_URL = process.env.SPIKE_PG_URL;

describe.skipIf(!PG_URL)("conversion race on real Postgres (set SPIKE_PG_URL to a throwaway db)", () => {
  let pool: pg.Pool;

  function pgStore(opts: { lock: boolean }): ConversionStore {
    return {
      async withLock(name, fn) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          if (opts.lock) await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [name]);
          const result = await fn({
            getState: async (n) => {
              const r = await client.query("SELECT state FROM spike_collab_document WHERE name = $1", [n]);
              return r.rows[0] ? new Uint8Array(r.rows[0].state) : null;
            },
            putState: async (n, s) => {
              await client.query(
                "INSERT INTO spike_collab_document(name, state) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET state = excluded.state",
                [n, Buffer.from(s)],
              );
            },
            flipStorage: async (n) => {
              const r = await client.query("UPDATE spike_deck SET storage = 'yjs' WHERE name = $1 AND storage = 'json'", [n]);
              return r.rowCount === 1;
            },
          });
          await client.query("COMMIT");
          return result;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      },
    };
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: PG_URL, max: 4 });
    await pool.query("CREATE TABLE IF NOT EXISTS spike_collab_document (name text PRIMARY KEY, state bytea NOT NULL)");
    await pool.query("CREATE TABLE IF NOT EXISTS spike_deck (name text PRIMARY KEY, storage text NOT NULL)");
  });
  afterAll(async () => {
    await pool.query("DROP TABLE IF EXISTS spike_collab_document, spike_deck");
    await pool.end();
  });

  const reset = async (name: string) => {
    await pool.query("DELETE FROM spike_collab_document WHERE name = $1", [name]);
    await pool.query("DELETE FROM spike_deck WHERE name = $1", [name]);
    await pool.query("INSERT INTO spike_deck(name, storage) VALUES ($1, 'json')", [name]);
  };
  const stored = async (name: string) =>
    new Uint8Array((await pool.query("SELECT state FROM spike_collab_document WHERE name = $1", [name])).rows[0].state);

  it("with the advisory lock + re-check: 5 racing conversions produce one state and one storage flip", async () => {
    const name = "slides:race-locked:deck";
    await reset(name);
    const store = pgStore({ lock: true });
    const read = async () => {
      await sleep(30);
      return LEGACY;
    };
    const results = await Promise.all(Array.from({ length: 5 }, () => loadOrConvertDeck(store, name, read)));
    expect(results.filter((r) => r.converted).length).toBe(1);
    const row = await stored(name);
    for (const r of results) expect(r.state).toEqual(row);
    expect(slideCount(row)).toBe(3);
    expect((await pool.query("SELECT storage FROM spike_deck WHERE name = $1", [name])).rows[0].storage).toBe("yjs");
  });

  it("negative control, no lock and no re-check: every caller converts and the callers hold different states", async () => {
    const name = "slides:race-unlocked:deck";
    await reset(name);
    const store = pgStore({ lock: false });
    const read = async () => {
      await sleep(30);
      return LEGACY;
    };
    const results = await Promise.all(
      Array.from({ length: 3 }, () => loadOrConvertDeck(store, name, read, { skipRecheck: true })),
    );
    expect(results.filter((r) => r.converted).length).toBe(3);
    const distinct = new Set(results.map((r) => Buffer.from(r.state).toString("base64")));
    expect(distinct.size).toBe(3);
    const row = await stored(name);
    console.log(`UNLOCKED-RACE keyed slide count in stored row = ${slideCount(row)} (keys are stable, so no duplicates, but 2 of 3 callers hold a discarded clientID history)`);
    expect(slideCount(row)).toBe(3);
  });
});
