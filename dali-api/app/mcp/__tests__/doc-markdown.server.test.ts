import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    page: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
  },
}));

import { prisma } from "~/lib/db.server";
import { checkInlineRefs, parseInlineMarkdown, parseMarkdown } from "../doc-markdown.server";

const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findMany.mockResolvedValue([]);
  db.page.findMany.mockResolvedValue([]);
  db.task.findMany.mockResolvedValue([]);
});

function inlineTypes(blocks: any[]): string[] {
  return blocks.flatMap((b) => (Array.isArray(b.content) ? b.content.map((c: any) => c.type) : []));
}

describe("parseMarkdown", () => {
  it("keeps mentions whose ids exist", async () => {
    db.user.findMany.mockResolvedValue([{ id: "u1" }]);
    db.page.findMany.mockResolvedValue([{ id: "p1" }]);
    const { blocks, warnings } = await parseMarkdown("Hi [@Tim](/members/u1) see [Plan](/documents/p1)");
    expect(inlineTypes(blocks)).toEqual(["text", "mention", "text", "pageMention"]);
    expect(warnings).toEqual([]);
    expect(db.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ["u1"] } }, select: { id: true } });
  });

  it("writes unknown ids as plain text and says so", async () => {
    const { blocks, warnings } = await parseMarkdown("Hi [@Ghost](/members/nope) and [Gone](/documents/p9)");
    expect(inlineTypes(blocks)).not.toContain("mention");
    expect(inlineTypes(blocks)).not.toContain("pageMention");
    const text = (blocks[0]!.content as any[]).map((c) => c.text).join("");
    expect(text).toContain("@Ghost");
    expect(text).toContain("Gone");
    expect(warnings).toEqual([
      'No member with id nope: "Ghost" was written as plain text',
      'No page with id p9: "Gone" was written as plain text',
    ]);
  });

  it("skips the database when there are no references", async () => {
    await parseMarkdown("Just **text**");
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(db.page.findMany).not.toHaveBeenCalled();
    expect(db.task.findMany).not.toHaveBeenCalled();
  });

  it("checks task references", async () => {
    const { warnings } = await parseMarkdown("[Fix it](/projects/pr1?tab=progress&task=t1)");
    expect(db.task.findMany).toHaveBeenCalledWith({ where: { id: { in: ["t1"] } }, select: { id: true } });
    expect(warnings).toEqual(['No task with id t1: "Fix it" was written as plain text']);
  });
});

describe("checkInlineRefs", () => {
  it("checks references inside table cells", async () => {
    const blocks = [
      {
        id: "t",
        type: "table",
        props: { textColor: "default" },
        content: {
          type: "tableContent",
          columnWidths: [null],
          rows: [{ cells: [{ type: "tableCell", props: {}, content: [{ type: "mention", props: { id: "u2", label: "Ana" } }] }] }],
        },
        children: [],
      },
    ] as any;
    const { warnings } = await checkInlineRefs(blocks);
    expect(warnings).toEqual(['No member with id u2: "Ana" was written as plain text']);
  });
});

describe("parseInlineMarkdown", () => {
  it("returns inline content for one line", async () => {
    db.user.findMany.mockResolvedValue([{ id: "u1" }]);
    const { content } = await parseInlineMarkdown("Owner [@Tim](/members/u1)");
    expect(content.map((c) => c.type)).toEqual(["text", "mention"]);
  });

  it("returns empty content for an empty cell", async () => {
    expect(await parseInlineMarkdown("  ")).toEqual({ content: [], warnings: [] });
  });

  it("keeps <br> as a line break", async () => {
    const { content } = await parseInlineMarkdown("one<br>two");
    expect((content[0] as any).text).toBe("one\ntwo");
  });

  it("refuses more than one block", async () => {
    await expect(parseInlineMarkdown("one\n\ntwo")).rejects.toThrow(/one line of text/);
  });
});
