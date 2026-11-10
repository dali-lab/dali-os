import { describe, expect, it } from "vitest";
import type { DocBlock, DocInline, DocTableCell, DocTableContent } from "../blocknote-server";
import { collectInlineRefs, downgradeInlineRefs, linksToInlineRefs } from "../inline-refs";

const text = (value: string): DocInline => ({ type: "text", text: value, styles: {} });
const user = (id: string, label: string): DocInline => ({ type: "mention", props: { id, label } });
const page = (pageId: string, label: string): DocInline => ({ type: "pageMention", props: { pageId, label } });
const task = (taskId: string, label: string): DocInline => ({
  type: "taskMention",
  props: { taskId, projectId: "pr1", label },
});

function para(content: DocInline[], children: DocBlock[] = []): DocBlock {
  return { id: "b", type: "paragraph", props: {}, content, children };
}

function table(cells: (DocTableCell | DocInline[])[]): DocBlock {
  return {
    id: "t",
    type: "table",
    props: {},
    content: { type: "tableContent", rows: [{ cells }] },
    children: [],
  };
}

const cellObj = (content: DocInline[]): DocTableCell => ({ type: "tableCell", props: {}, content });

function doc(): DocBlock[] {
  return [
    para([text("Hi "), user("u1", "kiran"), text(" "), page("p1", "Roadmap")], [
      para([user("u2", "ana"), task("t1", "Ship it"), user("u1", "kiran")]),
    ]),
    table([cellObj([page("p2", "Notes"), text(" ")]), [task("t2", "Review"), user("", "ghost")]]),
    { id: "c", type: "codeBlock", props: {}, content: [text("@u9")], children: [] },
    { id: "i", type: "image", props: { url: "x" }, children: [] },
  ];
}

describe("collectInlineRefs", () => {
  it("collects unique ids from paragraphs, children and both cell shapes", () => {
    expect(collectInlineRefs(doc())).toEqual({
      userIds: ["u1", "u2"],
      pageIds: ["p1", "p2"],
      taskIds: ["t1", "t2"],
    });
  });

  it("returns empty lists for a doc with no refs", () => {
    expect(collectInlineRefs([para([text("plain")])])).toEqual({ userIds: [], pageIds: [], taskIds: [] });
  });
});

describe("downgradeInlineRefs", () => {
  const known = {
    userIds: new Set(["u1"]),
    pageIds: new Set(["p2"]),
    taskIds: new Set(["t1"]),
  };

  it("turns unknown refs into text and keeps known ones", () => {
    const { blocks } = downgradeInlineRefs(doc(), known);
    expect(blocks[0]!.content).toEqual([text("Hi "), user("u1", "kiran"), text(" "), text("Roadmap")]);
    expect(blocks[0]!.children[0]!.content).toEqual([text("@ana"), task("t1", "Ship it"), user("u1", "kiran")]);
    const rows = (blocks[1]!.content as DocTableContent).rows;
    expect((rows[0]!.cells[0] as DocTableCell).content).toEqual([page("p2", "Notes"), text(" ")]);
    expect(rows[0]!.cells[1]).toEqual([text("Review"), text("@ghost")]);
  });

  it("reports what it downgraded in document order", () => {
    expect(downgradeInlineRefs(doc(), known).downgraded).toEqual([
      { type: "pageMention", id: "p1", label: "Roadmap" },
      { type: "mention", id: "u2", label: "ana" },
      { type: "taskMention", id: "t2", label: "Review" },
      { type: "mention", id: "", label: "ghost" },
    ]);
  });

  it("checks each ref type against its own id set", () => {
    const { downgraded } = downgradeInlineRefs([para([page("u1", "Same id"), task("p2", "Same id")])], known);
    expect(downgraded.map((ref) => ref.type)).toEqual(["pageMention", "taskMention"]);
  });

  it("drops a downgraded ref with an empty label instead of leaving an empty text run", () => {
    const { blocks, downgraded } = downgradeInlineRefs([para([text("a"), page("p9", ""), text("b")])], known);
    expect(blocks[0]!.content).toEqual([text("a"), text("b")]);
    expect(downgraded).toEqual([{ type: "pageMention", id: "p9", label: "" }]);
  });

  it("relabels kept user mentions from userLabels", () => {
    const { blocks } = downgradeInlineRefs([para([user("u1", "Kiran Patel"), user("u2", "ana")])], {
      ...known,
      userIds: new Set(["u1", "u2"]),
      userLabels: new Map([["u1", "kiran"]]),
    });
    expect(blocks[0]!.content).toEqual([user("u1", "kiran"), user("u2", "ana")]);
  });

  it("downgrades a task mention whose project does not match", () => {
    const { blocks, downgraded } = downgradeInlineRefs([para([task("t1", "Ship it")]), para([task("t3", "Other")])], {
      ...known,
      taskIds: new Set(["t1", "t3"]),
      taskProjects: new Map([["t1", "pr2"], ["t3", "pr1"]]),
    });
    expect(blocks[0]!.content).toEqual([text("Ship it")]);
    expect(blocks[1]!.content).toEqual([task("t3", "Other")]);
    expect(downgraded).toEqual([{ type: "taskMention", id: "t1", label: "Ship it", reason: "projectMismatch" }]);
  });

  it("leaves blocks without inline content without a content key", () => {
    const { blocks } = downgradeInlineRefs(doc(), known);
    expect(blocks[3]).toEqual({ id: "i", type: "image", props: { url: "x" }, children: [] });
    expect("content" in blocks[3]!).toBe(false);
  });

  it("does not mutate its input", () => {
    const input = doc();
    const snapshot = structuredClone(input);
    const { blocks } = downgradeInlineRefs(input, { userIds: new Set(), pageIds: new Set(), taskIds: new Set() });
    expect(input).toEqual(snapshot);
    expect(blocks).not.toEqual(snapshot);
  });

  it("returns the doc unchanged when every ref is known", () => {
    const all = { userIds: new Set(["u1", "u2", ""]), pageIds: new Set(["p1", "p2"]), taskIds: new Set(["t1", "t2"]) };
    const { blocks, downgraded } = downgradeInlineRefs(doc(), all);
    expect(blocks).toEqual(doc());
    expect(downgraded).toEqual([]);
  });
});

describe("linksToInlineRefs", () => {
  const link = (href: string, content: DocInline[]): DocInline => ({ type: "link", href, content });

  it("converts matching links in bare-array cells", () => {
    const [block] = linksToInlineRefs([table([[link("/members/u1", [text("@kiran")])]])]);
    expect((block!.content as DocTableContent).rows[0]!.cells[0]).toEqual([user("u1", "kiran")]);
  });

  it("unescapes \\< in a converted label", () => {
    const [block] = linksToInlineRefs([para([link("/documents/p1", [text("a \\<b>")])])]);
    expect(block!.content).toEqual([page("p1", "a <b>")]);
  });

  it("leaves a link with no text run alone", () => {
    const empty = link("/documents/p1", []);
    expect(linksToInlineRefs([para([empty])])[0]!.content).toEqual([empty]);
  });
});
