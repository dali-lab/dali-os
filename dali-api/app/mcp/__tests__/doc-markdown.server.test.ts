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

const MEMBER_QUERY = (ids: string[]) => ({
  where: { id: { in: ids }, daliMember: { isNot: null }, handle: { not: null } },
  select: { id: true, handle: true },
});

describe("parseMarkdown", () => {
  it("keeps mentions of lab members and pages that exist", async () => {
    db.user.findMany.mockResolvedValue([{ id: "u1", handle: "tim" }]);
    db.page.findMany.mockResolvedValue([{ id: "p1" }]);
    const { blocks, warnings } = await parseMarkdown("Hi [@tim](/members/u1) see [Plan](/documents/p1)");
    expect(inlineTypes(blocks)).toEqual(["text", "mention", "text", "pageMention"]);
    expect(warnings).toEqual([]);
    expect(db.user.findMany).toHaveBeenCalledWith(MEMBER_QUERY(["u1"]));
  });

  it("stores the member's handle as the mention label, like a web chip", async () => {
    db.user.findMany.mockResolvedValue([{ id: "u1", handle: "tim" }]);
    const { blocks } = await parseMarkdown("Hi [@Tim Tregubov](/members/u1)");
    expect((blocks[0]!.content as any[])[1]).toEqual({ type: "mention", props: { id: "u1", label: "tim" } });
  });

  it("writes a non-member or unknown user as plain text and says so", async () => {
    db.user.findMany.mockResolvedValue([]);
    const { blocks, warnings } = await parseMarkdown("Hi [@Partner](/members/u7)");
    expect(inlineTypes(blocks)).not.toContain("mention");
    expect((blocks[0]!.content as any[]).map((c) => c.text).join("")).toBe("Hi @Partner");
    expect(warnings).toEqual(['No member with id u7: "Partner" was written as plain text']);
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
    expect(db.task.findMany).toHaveBeenCalledWith({ where: { id: { in: ["t1"] } }, select: { id: true, projectId: true } });
    expect(warnings).toEqual(['No task with id t1: "Fix it" was written as plain text']);
  });

  it("keeps a task link whose project matches", async () => {
    db.task.findMany.mockResolvedValue([{ id: "t1", projectId: "pr1" }]);
    const { blocks, warnings } = await parseMarkdown("[Fix it](/projects/pr1?tab=progress&task=t1)");
    expect(inlineTypes(blocks)).toEqual(["taskMention"]);
    expect(warnings).toEqual([]);
  });

  it("writes a task link naming the wrong project as plain text", async () => {
    db.task.findMany.mockResolvedValue([{ id: "t1", projectId: "pr2" }]);
    const { blocks, warnings } = await parseMarkdown("[Fix it](/projects/pr1?tab=progress&task=t1)");
    expect(inlineTypes(blocks)).toEqual(["text"]);
    expect(warnings).toEqual(['Task t1 is not in the project its link names: "Fix it" was written as plain text']);
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
    db.user.findMany.mockResolvedValue([{ id: "u1", handle: "tim" }]);
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
