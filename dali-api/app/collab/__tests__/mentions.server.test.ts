import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";

// extractMentionUserIds is pure, but ../mentions.server imports prisma + notify
// at load; mock them so the CI test job (no generated client) can import it.
vi.mock("~/lib/db");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));

import { extractMentionUserIds } from "../mentions.server";

// Build a Y.Doc "default" XmlFragment shaped like what y-prosemirror produces:
// paragraph elements containing text + `mention` elements whose `id` attr is
// the tagged user id.
function docWith(mentionIds: string[][]): Y.Doc {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("default");
  for (const ids of mentionIds) {
    const p = new Y.XmlElement("paragraph");
    p.push([new Y.XmlText("hi ")]);
    for (const id of ids) {
      const mention = new Y.XmlElement("mention");
      mention.setAttribute("id", id);
      mention.setAttribute("label", `user-${id}`);
      p.push([mention]);
    }
    fragment.push([p]);
  }
  return doc;
}

describe("extractMentionUserIds", () => {
  it("collects ids from mention nodes across paragraphs, deduped", () => {
    const doc = docWith([["u1", "u2"], ["u1", "u3"]]);
    expect(extractMentionUserIds(doc).sort()).toEqual(["u1", "u2", "u3"]);
  });

  it("returns nothing for a doc with no mentions", () => {
    const doc = docWith([[], []]);
    expect(extractMentionUserIds(doc)).toEqual([]);
  });

  it("ignores mention elements with no id", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const p = new Y.XmlElement("paragraph");
    const bare = new Y.XmlElement("mention"); // no id attribute
    p.push([bare]);
    fragment.push([p]);
    expect(extractMentionUserIds(doc)).toEqual([]);
  });

  it("collects ids from converted (blocknote-fragment) documents, incl. nested children", async () => {
    const { blocksToFragment } = await import("../blocknote-server");
    const doc = new Y.Doc();
    doc.transact(() => {
      blocksToFragment(
        [
          {
            id: "b1",
            type: "paragraph",
            props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
            content: [
              { type: "text", text: "cc ", styles: {} },
              { type: "mention", props: { id: "u1", label: "one" } },
            ],
            children: [
              {
                id: "b2",
                type: "paragraph",
                props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
                content: [{ type: "mention", props: { id: "u2", label: "two" } }],
                children: [],
              },
            ],
          },
        ],
        doc.getXmlFragment("blocknote"),
      );
    });
    expect(extractMentionUserIds(doc).sort()).toEqual(["u1", "u2"]);
  });
});
