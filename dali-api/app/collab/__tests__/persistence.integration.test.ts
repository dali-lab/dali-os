import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";
import { maybeSnapshot } from "~/collab/persistence";

const NAME = "doc:page1:body";
const stored = (text = "hello") => ({ state: new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>, plainText: text });

beforeEach(async () => {
  await prisma.collabDocument.create({ data: { name: NAME, state: new Uint8Array([0]) } });
});

const versions = (name = NAME) => prisma.collabDocumentVersion.findMany({ where: { name }, orderBy: { createdAt: "asc" } });

describe("maybeSnapshot", () => {
  it("writes the first snapshot with state, text and authors", async () => {
    expect(await maybeSnapshot(NAME, stored("first"), ["u1", "u2"])).toBe(true);
    const [v] = await versions();
    expect(v.plainText).toBe("first");
    expect(v.authorIds).toEqual(["u1", "u2"]);
    expect(Array.from(v.state)).toEqual([1, 2, 3]);
  });

  const setLatestAge = (ms: number) =>
    prisma.collabDocumentVersion.updateMany({ where: { name: NAME }, data: { createdAt: new Date(Date.now() - ms) } });

  it("throttles inside the 30s window and snapshots again after it", async () => {
    expect(await maybeSnapshot(NAME, stored(), [])).toBe(true);
    await setLatestAge(29_000);
    expect(await maybeSnapshot(NAME, stored(), [])).toBe(false);
    expect(await versions()).toHaveLength(1);
    await setLatestAge(31_000);
    expect(await maybeSnapshot(NAME, stored("later"), [])).toBe(true);
    expect(await versions()).toHaveLength(2);
  });

  it("concurrent stores on one doc produce exactly one snapshot", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => maybeSnapshot(NAME, stored(), ["u1"])));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await versions()).toHaveLength(1);
  });

  it("throttles per document, not globally", async () => {
    await prisma.collabDocument.create({ data: { name: "doc:page2:body", state: new Uint8Array([0]) } });
    const [a, b] = await Promise.all([maybeSnapshot(NAME, stored(), []), maybeSnapshot("doc:page2:body", stored(), [])]);
    expect([a, b]).toEqual([true, true]);
  });

  it("never snapshots a presence room", async () => {
    expect(await maybeSnapshot("presence:global", stored(), [])).toBe(false);
    expect(await prisma.collabDocumentVersion.count()).toBe(0);
  });
});
