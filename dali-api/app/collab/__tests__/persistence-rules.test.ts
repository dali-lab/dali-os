import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";

vi.mock("~/lib/db.server", () => {
  const mock: any = {
    collabDocument: { findUnique: vi.fn(), upsert: vi.fn() },
    collabDocumentVersion: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    applicationReview: { findUnique: vi.fn(), update: vi.fn() },
    interview: { findUnique: vi.fn(), update: vi.fn() },
    interviewAssignment: { findMany: vi.fn() },
    domainApplication: { findUnique: vi.fn(), update: vi.fn() },
    task: { findUnique: vi.fn(), update: vi.fn() },
    epic: { updateMany: vi.fn() },
    educationSubmission: { findUnique: vi.fn(), update: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn((fn: (tx: any) => Promise<any>) => fn(mock)),
  };
  return { prisma: mock };
});

const { seedRegistryDoc, syncRegistryDocBack, indexPageBody } = vi.hoisted(() => ({
  seedRegistryDoc: vi.fn(),
  syncRegistryDocBack: vi.fn(),
  indexPageBody: vi.fn(),
}));
vi.mock("../sources", () => ({
  seedRegistryDoc,
  syncRegistryDocBack,
  isStructuredRoom: (entity: string) => entity === "form",
}));
vi.mock("~/lib/doc-search.server", () => ({ indexPageBody }));
vi.mock("../legacy/pm-to-blocknote", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../legacy/pm-to-blocknote")>();
  return { ...actual, mapPmDocToBlocks: vi.fn(actual.mapPmDocToBlocks) };
});

import { prisma } from "~/lib/db.server";
import { forceSnapshot, getPlainText, loadDocument, restoreVersion, storeDocument } from "../persistence";
import { blocksToFragment, fragmentToBlocks, plainTextToBlocks } from "../blocknote-server";
import { mapPmDocToBlocks } from "../legacy/pm-to-blocknote";
import { blocksToPlainText } from "~/components/doc/schema/configs";

const db = prisma as any;

function blockNoteDoc(text: string): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => blocksToFragment(plainTextToBlocks(text), doc.getXmlFragment("blocknote")));
  return doc;
}

function legacyDoc(text: string): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const p = new Y.XmlElement("paragraph");
    const t = new Y.XmlText();
    t.insert(0, text);
    p.insert(0, [t]);
    doc.getXmlFragment("default").push([p]);
  });
  return doc;
}

function findXmlText(el: Y.XmlFragment | Y.XmlElement, out: Y.XmlText[] = []): Y.XmlText[] {
  for (let i = 0; i < el.length; i++) {
    const c = el.get(i);
    if (c instanceof Y.XmlText) out.push(c);
    else if (c instanceof Y.XmlElement) findXmlText(c, out);
  }
  return out;
}

const stateOf = (doc: Y.Doc) => Buffer.from(Y.encodeStateAsUpdate(doc));

beforeEach(() => {
  vi.clearAllMocks();
  seedRegistryDoc.mockResolvedValue(false);
  syncRegistryDocBack.mockResolvedValue(false);
  db.collabDocument.upsert.mockResolvedValue({ updatedAt: new Date("2026-01-01") });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("getPlainText clone rule", () => {
  function docWithCommentMark() {
    const doc = blockNoteDoc("hello");
    doc.transact(() => findXmlText(doc.getXmlFragment("blocknote"))[0].format(0, 5, { "comment--abc": { id: "abc" } } as any));
    return doc;
  }

  it("reads text under a comment mark without mutating the live doc", () => {
    const doc = docWithCommentMark();
    const before = stateOf(doc);
    const updates: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => updates.push(u));

    expect(getPlainText(doc)).toBe("hello");

    expect(updates).toEqual([]);
    expect(stateOf(doc).equals(before)).toBe(true);
    expect(blocksToPlainText(fragmentToBlocks(doc.getXmlFragment("blocknote")))).toBe("");
  });

  it("leaves the comment attributes on the live doc intact", () => {
    const doc = docWithCommentMark();
    getPlainText(doc);
    const delta = findXmlText(doc.getXmlFragment("blocknote"))[0].toDelta();
    expect(delta[0].insert).toBe("hello");
    expect(Object.keys(delta[0].attributes)).toContain("comment--abc");
  });

  it("does not mutate a live legacy-only doc while falling back to it", () => {
    const doc = legacyDoc("legacy text");
    const before = stateOf(doc);
    expect(getPlainText(doc)).toBe("legacy text");
    expect(stateOf(doc).equals(before)).toBe(true);
    expect(doc.getXmlFragment("blocknote").length).toBe(0);
  });
});

describe("loadDocument", () => {
  it("applies stored bytes so the loaded doc matches the stored doc", async () => {
    const original = blockNoteDoc("round trip");
    db.collabDocument.findUnique.mockResolvedValue({ name: "task:t1:description", state: stateOf(original) });

    const target = new Y.Doc();
    await loadDocument("task:t1:description", target);

    expect(stateOf(target).equals(stateOf(original))).toBe(true);
    expect(db.collabDocument.upsert).not.toHaveBeenCalled();
  });

  it("does not convert or re-store a doc with neither fragment populated", async () => {
    db.collabDocument.findUnique.mockResolvedValue({ name: "doc:p:body", state: stateOf(new Y.Doc()) });
    await loadDocument("doc:p:body", new Y.Doc());
    expect(mapPmDocToBlocks).not.toHaveBeenCalled();
    expect(db.collabDocument.upsert).not.toHaveBeenCalled();
  });

  it("does not convert or re-store a doc whose blocknote fragment is populated", async () => {
    const original = blockNoteDoc("current");
    original.transact(() => original.getXmlFragment("default").push([new Y.XmlElement("paragraph")]));
    db.collabDocument.findUnique.mockResolvedValue({ name: "doc:p:body", state: stateOf(original) });

    await loadDocument("doc:p:body", new Y.Doc());

    expect(mapPmDocToBlocks).not.toHaveBeenCalled();
    expect(db.collabDocument.upsert).not.toHaveBeenCalled();
  });

  it("persists the converted bytes, and a second load of them does not convert again", async () => {
    db.collabDocument.findUnique.mockResolvedValue({ name: "doc:p:body", state: stateOf(legacyDoc("old body")) });

    await loadDocument("doc:p:body", new Y.Doc());
    expect(mapPmDocToBlocks).toHaveBeenCalledTimes(1);
    const persisted = db.collabDocument.upsert.mock.calls[0][0].create.state as Uint8Array;

    db.collabDocument.findUnique.mockResolvedValue({ name: "doc:p:body", state: Buffer.from(persisted) });
    db.collabDocument.upsert.mockClear();
    const second = new Y.Doc();
    await loadDocument("doc:p:body", second);

    expect(mapPmDocToBlocks).toHaveBeenCalledTimes(1);
    expect(db.collabDocument.upsert).not.toHaveBeenCalled();
    expect(blocksToPlainText(fragmentToBlocks(second.getXmlFragment("blocknote")))).toBe("old body");
  });

  it("opens a doc unconverted, without storing, when legacy conversion throws", async () => {
    vi.mocked(mapPmDocToBlocks).mockImplementationOnce(() => {
      throw new Error("unmappable");
    });
    const original = legacyDoc("keep me");
    db.collabDocument.findUnique.mockResolvedValue({ name: "doc:p:body", state: stateOf(original) });

    const doc = new Y.Doc();
    await expect(loadDocument("doc:p:body", doc)).resolves.toBeUndefined();

    expect(doc.getXmlFragment("blocknote").length).toBe(0);
    expect(doc.getXmlFragment("default").length).toBe(1);
    expect(db.collabDocument.upsert).not.toHaveBeenCalled();
  });

  it("propagates a corrupt stored state instead of opening an empty doc", async () => {
    db.collabDocument.findUnique.mockResolvedValue({ name: "doc:p:body", state: Buffer.from([255, 255, 255, 255]) });
    await expect(loadDocument("doc:p:body", new Y.Doc())).rejects.toThrow();
  });

  describe("seeding a room with no stored row", () => {
    beforeEach(() => db.collabDocument.findUnique.mockResolvedValue(null));

    const seeded = async (name: string) => {
      const doc = new Y.Doc();
      await loadDocument(name, doc);
      return blocksToPlainText(fragmentToBlocks(doc.getXmlFragment("blocknote")));
    };

    it("lets a registry-backed entity seed and skips the legacy plain-text seed", async () => {
      seedRegistryDoc.mockResolvedValue(true);
      await loadDocument("task:t1:description", new Y.Doc());
      expect(seedRegistryDoc).toHaveBeenCalledWith("task", "t1", expect.any(Y.Doc));
      expect(db.task.findUnique).not.toHaveBeenCalled();
    });

    it("does not consult the registry for names that are not entity:id:field", async () => {
      await loadDocument("weird-name", new Y.Doc());
      expect(seedRegistryDoc).not.toHaveBeenCalled();
    });

    it("seeds a review's rejection rationale", async () => {
      db.applicationReview.findUnique.mockResolvedValue({ feedback: "f", rejectionRationale: "too early" });
      expect(await seeded("review:r1:rejectionRationale")).toBe("too early");
    });

    it("leaves a review room empty when the review is gone", async () => {
      db.applicationReview.findUnique.mockResolvedValue(null);
      expect(await seeded("review:r1:feedback")).toBe("");
    });

    it("seeds a task description", async () => {
      db.task.findUnique.mockResolvedValue({ description: "ship it" });
      expect(await seeded("task:t1:description")).toBe("ship it");
    });

    it("seeds education submission feedback", async () => {
      db.educationSubmission.findUnique.mockResolvedValue({ feedbackText: "nice work" });
      expect(await seeded("edusubmission:s1:feedback")).toBe("nice work");
    });

    it("seeds interview recommendation notes", async () => {
      db.interview.findUnique.mockResolvedValue({ recommendationNotes: "hire" });
      expect(await seeded("interview:i1:recommendation")).toBe("hire");
    });

    it("leaves an interview room empty when the interview is gone", async () => {
      db.interview.findUnique.mockResolvedValue(null);
      expect(await seeded("interview:i1:notes")).toBe("");
    });

    it("seeds joint interview notes from each interviewer's latest note, named, skipping empty ones", async () => {
      db.interview.findUnique.mockResolvedValue({ id: "i1" });
      db.interviewAssignment.findMany.mockResolvedValue([
        {
          noteVersions: [{ content: "strong systems" }],
          cycleInterviewer: { user: { firstName: "Ada", lastName: "Lovelace" } },
        },
        { noteVersions: [], cycleInterviewer: { user: { firstName: "Grace", lastName: "Hopper" } } },
        {
          noteVersions: [{ content: "good fit" }],
          cycleInterviewer: { user: { firstName: null, lastName: null } },
        },
      ]);
      expect(await seeded("interview:i1:notes")).toBe(
        "--- Ada Lovelace ---\nstrong systems\n--- Interviewer ---\ngood fit",
      );
    });

    it("seeds nothing for an unknown entity", async () => {
      expect(await seeded("nope:x:y")).toBe("");
    });
  });
});

describe("storeDocument", () => {
  const doc = () => blockNoteDoc("body text");

  it("persists bytes that decode to the same document", async () => {
    const source = doc();
    const result = await storeDocument("task:t1:description", source);
    const saved = db.collabDocument.upsert.mock.calls[0][0];
    expect(saved.where).toEqual({ name: "task:t1:description" });
    expect(saved.create.state).toBe(result!.state);
    expect(saved.update.state).toBe(result!.state);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, result!.state);
    expect(stateOf(restored).equals(stateOf(source))).toBe(true);
  });

  it("syncs a review rejection rationale back", async () => {
    await storeDocument("review:r1:rejectionRationale", doc());
    expect(db.applicationReview.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { rejectionRationale: "body text" } });
  });

  it("syncs a task description back", async () => {
    await storeDocument("task:t1:description", doc());
    expect(db.task.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { description: "body text" } });
  });

  it("syncs an epic description by its descriptionDocId, not its id", async () => {
    await storeDocument("epic:room-xyz:description", doc());
    expect(db.epic.updateMany).toHaveBeenCalledWith({ where: { descriptionDocId: "room-xyz" }, data: { description: "body text" } });
  });

  it("syncs education submission feedback back", async () => {
    await storeDocument("edusubmission:s1:feedback", doc());
    expect(db.educationSubmission.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { feedbackText: "body text" } });
  });

  it("syncs interview recommendation notes back", async () => {
    await storeDocument("interview:i1:recommendation", doc());
    expect(db.interview.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { recommendationNotes: "body text" } });
  });

  it("does not write the joint interview notes to any source column", async () => {
    await storeDocument("interview:i1:notes", doc());
    expect(db.interview.update).not.toHaveBeenCalled();
  });

  it("does not sync a field with no source column", async () => {
    await storeDocument("task:t1:other", doc());
    expect(db.task.update).not.toHaveBeenCalled();
  });

  it("returns state without any sync-back for non entity:id:field names", async () => {
    const result = await storeDocument("loose-name", doc());
    expect(result!.plainText).toBe("body text");
    expect(syncRegistryDocBack).not.toHaveBeenCalled();
  });

  it("skips the plain-text sync when a registry source handled the sync-back", async () => {
    syncRegistryDocBack.mockResolvedValue(true);
    const result = await storeDocument("task:t1:description", doc());
    expect(syncRegistryDocBack).toHaveBeenCalledWith("task", "t1", expect.any(Y.Doc));
    expect(db.task.update).not.toHaveBeenCalled();
    expect(result!.plainText).toBe("body text");
  });

  it("indexes a page body for search with the row's updatedAt", async () => {
    await storeDocument("doc:page1:body", doc());
    expect(indexPageBody).toHaveBeenCalledWith("page1", "body text", new Date("2026-01-01"));
  });

  it("still saves when search indexing fails", async () => {
    indexPageBody.mockRejectedValue(new Error("index down"));
    const result = await storeDocument("doc:page1:body", doc());
    expect(result!.plainText).toBe("body text");
    expect(db.collabDocument.upsert).toHaveBeenCalledOnce();
  });

  it("does not index non-body doc fields", async () => {
    await storeDocument("doc:page1:other", doc());
    expect(indexPageBody).not.toHaveBeenCalled();
  });

  it("mirrors structured rooms as JSON instead of prose plain text", async () => {
    const d = new Y.Doc();
    const items = d.getArray<Y.Map<unknown>>("items");
    const q = new Y.Map<unknown>();
    q.set("label", "Name");
    items.push([q]);
    const result = await storeDocument("form:f1:draft", d);
    expect(JSON.parse(result!.plainText)).toEqual({ items: [{ label: "Name" }] });
  });

  it("stores the doc but does not sync back when the upsert fails", async () => {
    db.collabDocument.upsert.mockRejectedValue(new Error("db down"));
    await expect(storeDocument("task:t1:description", doc())).rejects.toThrow("db down");
    expect(db.task.update).not.toHaveBeenCalled();
  });
});

function fakeServer(live: Y.Doc) {
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const conn = {
    document: live as Y.Doc | null,
    transact: vi.fn(async (fn: (d: Y.Doc) => void) => fn(live)),
    disconnect,
  };
  const server: any = { hocuspocus: { openDirectConnection: vi.fn().mockResolvedValue(conn) } };
  return { server, conn, disconnect };
}

describe("forceSnapshot", () => {
  it("rejects presence rooms without opening a connection", async () => {
    const { server } = fakeServer(new Y.Doc());
    await expect(forceSnapshot(server, "presence:p1", "x", [])).rejects.toThrow("presence room");
    expect(server.hocuspocus.openDirectConnection).not.toHaveBeenCalled();
  });

  it("writes a labeled version of the live doc, bypassing the throttle", async () => {
    const live = blockNoteDoc("before enhance");
    const { server, disconnect } = fakeServer(live);
    await forceSnapshot(server, "doc:p1:body", "Before enhance", ["u1"]);

    expect(db.collabDocumentVersion.findFirst).not.toHaveBeenCalled();
    const data = db.collabDocumentVersion.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ name: "doc:p1:body", plainText: "before enhance", authorIds: ["u1"], label: "Before enhance" });
    expect(Buffer.from(data.state).equals(stateOf(live))).toBe(true);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("disconnects and writes nothing when the document is missing", async () => {
    const { server, conn, disconnect } = fakeServer(new Y.Doc());
    conn.document = null;
    await expect(forceSnapshot(server, "doc:p1:body", "x", [])).rejects.toThrow("Document not found");
    expect(db.collabDocumentVersion.create).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

describe("restoreVersion", () => {
  it("rejects presence rooms before touching the database", async () => {
    const { server } = fakeServer(new Y.Doc());
    await expect(restoreVersion(server, "presence:p1", "v1")).rejects.toThrow("presence room");
    expect(db.collabDocumentVersion.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a missing version", async () => {
    db.collabDocumentVersion.findUnique.mockResolvedValue(null);
    const { server } = fakeServer(new Y.Doc());
    await expect(restoreVersion(server, "doc:p1:body", "v1")).rejects.toThrow("Version not found");
    expect(server.hocuspocus.openDirectConnection).not.toHaveBeenCalled();
  });

  it("rejects a version that belongs to another document", async () => {
    db.collabDocumentVersion.findUnique.mockResolvedValue({ name: "doc:other:body", state: stateOf(blockNoteDoc("x")) });
    const { server } = fakeServer(new Y.Doc());
    await expect(restoreVersion(server, "doc:p1:body", "v1")).rejects.toThrow("Version not found");
    expect(server.hocuspocus.openDirectConnection).not.toHaveBeenCalled();
  });

  it("replaces the live blocknote content with the snapshot's", async () => {
    db.collabDocumentVersion.findUnique.mockResolvedValue({ name: "doc:p1:body", state: stateOf(blockNoteDoc("old version")) });
    const live = blockNoteDoc("current");
    const { server, disconnect } = fakeServer(live);

    await restoreVersion(server, "doc:p1:body", "v1");

    expect(blocksToPlainText(fragmentToBlocks(live.getXmlFragment("blocknote")))).toContain("old version");
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("restores a pre-migration legacy snapshot through the PM mapper", async () => {
    db.collabDocumentVersion.findUnique.mockResolvedValue({ name: "doc:p1:body", state: stateOf(legacyDoc("ancient")) });
    const live = new Y.Doc();
    const { server } = fakeServer(live);

    await restoreVersion(server, "doc:p1:body", "v1");

    expect(blocksToPlainText(fragmentToBlocks(live.getXmlFragment("blocknote")))).toBe("ancient");
  });
});
