import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    page: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
  },
}));

vi.mock("~/lib/s3", () => ({ putObject: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "node:dns/promises";
import { putObject } from "~/lib/s3";
import { prisma } from "~/lib/db.server";
import { checkInlineRefs, parseInlineMarkdown, parseMarkdown } from "../doc-markdown.server";

const db = prisma as any;

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(putObject).mockResolvedValue(undefined);
  vi.mocked(lookup).mockImplementation((async (host: string) => [
    { address: host === "internal.example.com" ? "10.0.0.5" : "93.184.216.34", family: 4 },
  ]) as never);
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

describe("parseMarkdown images", () => {
  const png = () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
  const types = (blocks: any[]) => blocks.map((b) => b.type);

  it("adds no warnings and does no work for a page without images", async () => {
    const { blocks, warnings } = await parseMarkdown("# Title\n\nJust text.");
    expect(types(blocks)).toEqual(["heading", "paragraph"]);
    expect(warnings).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });

  it("moves an inline image into its own block and says so", async () => {
    const { blocks, warnings } = await parseMarkdown("See ![q3](/api/upload/raw?key=uploads/q3.png) for details.");
    expect(types(blocks)).toEqual(["paragraph", "image"]);
    expect(warnings).toEqual(['Image "q3" was inside a paragraph and was moved to its own block after it']);
  });

  it("uploads a data image under the MCP prefix", async () => {
    const { blocks, warnings } = await parseMarkdown(`![dot](data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")})`);
    expect(vi.mocked(putObject).mock.calls[0]![0]).toMatch(/^uploads\/doc-images\/mcp\/[0-9a-f-]{36}-image\.png$/);
    expect(blocks[0]!.props.url).toContain("uploads%2Fdoc-images%2Fmcp%2F");
    expect(warnings).toEqual(['Image "dot" was copied into DALI']);
  });

  it("fetches an external image and uploads it", async () => {
    fetchMock.mockResolvedValue(png());
    const { blocks, warnings } = await parseMarkdown("![chart](https://cdn.example.com/chart.png)");
    expect(blocks[0]!.props.url).toContain("uploads%2Fdoc-images%2Fmcp%2F");
    expect(warnings).toEqual(['Image "chart" was copied into DALI']);
  });

  it("writes a link and warns when the image cannot be fetched", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    const { blocks, warnings } = await parseMarkdown("![chart](https://cdn.example.com/chart.png)");
    expect(types(blocks)).toEqual(["paragraph"]);
    expect(warnings).toEqual(['Image "chart" could not be fetched (HTTP 404) and was written as a link']);
  });

  it("refuses a private address with a warning", async () => {
    const { warnings } = await parseMarkdown("![x](https://internal.example.com/a.png)");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnings[0]).toContain("the address is not allowed");
  });

  it("resolves at most ten images per call and keeps the rest as links", async () => {
    fetchMock.mockImplementation(async () => png());
    const md = Array.from({ length: 12 }, (_, n) => `![i${n}](https://cdn.example.com/${n}.png)`).join("\n\n");
    const { blocks, warnings } = await parseMarkdown(md);
    expect(putObject).toHaveBeenCalledTimes(10);
    expect(types(blocks).filter((t) => t === "image")).toHaveLength(10);
    expect(warnings.filter((w) => w.includes("limit of 10 images"))).toHaveLength(2);
  });

  it("keeps images and mention warnings together", async () => {
    const { warnings } = await parseMarkdown("Hi [@Ghost](/members/nope) ![q](/api/upload/raw?key=uploads/q.png) end");
    expect(warnings).toHaveLength(2);
  });
});
