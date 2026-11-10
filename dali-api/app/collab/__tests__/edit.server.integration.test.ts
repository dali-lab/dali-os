import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { prisma } from "~/lib/db.server";
import { blocksToFragment, fragmentToBlocks, type DocBlock } from "~/collab/blocknote-server";
import { stripCommentFormats } from "~/collab/comment-formats";
import { applyDocOps, blockHash } from "~/collab/edit.server";

const NAME = "edittest:body";
const BASE = { backgroundColor: "default", textColor: "default", textAlignment: "left" };
const COMMENT = { "comment--t1": { threadId: "t1", orphan: false } };

function para(id: string, text: string): DocBlock {
  return { id, type: "paragraph", props: BASE, content: [{ type: "text", text, styles: {} }], children: [] };
}

function firstText(doc: Y.Doc, id: string): Y.XmlText {
  const group = doc.getXmlFragment("blocknote").get(0) as Y.XmlElement;
  const container = (group.toArray() as Y.XmlElement[]).find((el) => el.getAttribute("id") === id)!;
  return (container.get(0) as Y.XmlElement).get(0) as Y.XmlText;
}

function decode(state: Uint8Array): DocBlock[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const fragment = doc.getXmlFragment("blocknote");
  doc.transact(() => stripCommentFormats(fragment));
  return fragmentToBlocks(fragment);
}

const blocks = [para("keep", "commented note"), para("edit", "draft text"), para("gone", "remove me")];

beforeEach(async () => {
  const doc = new Y.Doc();
  doc.transact(() => blocksToFragment(blocks, doc.getXmlFragment("blocknote")));
  firstText(doc, "keep").format(0, 9, COMMENT);
  await prisma.collabDocument.create({
    data: { name: NAME, state: Y.encodeStateAsUpdate(doc) as Uint8Array<ArrayBuffer> },
  });
});

describe("applyDocOps without a collab server", () => {
  it("edits the stored doc, keeps comments elsewhere and saves the pre-edit version", async () => {
    const result = await applyDocOps(
      NAME,
      [
        { op: "replace_text", blockId: "edit", expectedHash: blockHash(blocks[1]!), find: "draft", replace: "final" },
        { op: "delete", blockId: "gone", expectedHash: blockHash(blocks[2]!) },
      ],
      "u-ada",
    );
    expect(result.touched).toEqual(["edit"]);

    const row = await prisma.collabDocument.findUniqueOrThrow({ where: { name: NAME } });
    const after = new Y.Doc();
    Y.applyUpdate(after, new Uint8Array(row.state));
    expect(firstText(after, "keep").toDelta()).toEqual([
      { insert: "commented", attributes: COMMENT },
      { insert: " note" },
    ]);
    expect(decode(new Uint8Array(row.state)).map((b) => [b.id, (b.content as { text: string }[])[0]!.text])).toEqual([
      ["keep", "commented note"],
      ["edit", "final text"],
    ]);

    const versions = await prisma.collabDocumentVersion.findMany({ where: { name: NAME } });
    const undo = versions.find((v) => v.label === "Before agent edit");
    expect(undo?.authorIds).toEqual(["u-ada"]);
    expect(decode(new Uint8Array(undo!.state)).map((b) => b.id)).toEqual(["keep", "edit", "gone"]);
    expect(undo!.plainText).toContain("remove me");
  });

  it("leaves the stored doc and versions alone when an op fails", async () => {
    const before = await prisma.collabDocument.findUniqueOrThrow({ where: { name: NAME } });
    await expect(
      applyDocOps(NAME, [{ op: "delete", blockId: "gone", expectedHash: "stale" }], "u-ada"),
    ).rejects.toMatchObject({ code: "BLOCK_CHANGED" });
    const row = await prisma.collabDocument.findUniqueOrThrow({ where: { name: NAME } });
    expect(Buffer.from(row.state).equals(Buffer.from(before.state))).toBe(true);
    expect(await prisma.collabDocumentVersion.count({ where: { name: NAME } })).toBe(0);
  });
});
