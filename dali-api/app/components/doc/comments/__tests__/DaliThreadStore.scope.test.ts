import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaliThreadStore, apiCommentsToThreadMap, getOrCreateStore } from "../DaliThreadStore";

const comment = (id: string, anchor: unknown, parentId: string | null = null) => ({
  id,
  parentId,
  author: "Ada",
  authorId: "u1",
  body: JSON.stringify([{ type: "paragraph", content: [{ type: "text", text: id }] }]),
  anchor: anchor as never,
  createdAt: "2026-11-05T10:00:00.000Z",
});

const title = { slideId: "s1", elementId: "title" };
const body = { slideId: "s1", elementId: "body" };

describe("apiCommentsToThreadMap scoping", () => {
  const comments = [
    comment("t1", { kind: "blocknote", ...title }),
    comment("t2", { kind: "blocknote", ...body }),
    comment("t3", { kind: "blocknote", slideId: "s2", elementId: "title" }),
    comment("doc", { kind: "blocknote" }),
    comment("pin", { kind: "slide", slideId: "s1" }),
    comment("reply", null, "t1"),
  ];

  it("gives a text box only its own threads, replies included", () => {
    const map = apiCommentsToThreadMap(comments, title);
    expect([...map.keys()]).toEqual(["t1"]);
    expect(map.get("t1")!.comments.map((c) => c.id)).toEqual(["t1", "reply"]);
    expect([...apiCommentsToThreadMap(comments, body).keys()]).toEqual(["t2"]);
  });

  it("keeps slide-scoped threads out of an unscoped document store", () => {
    expect([...apiCommentsToThreadMap(comments).keys()]).toEqual(["doc"]);
  });

  it("never lists pins as text threads", () => {
    expect(apiCommentsToThreadMap(comments, { slideId: "s1", elementId: "x" }).has("pin")).toBe(false);
  });
});

describe("a scoped DaliThreadStore", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const config = { pageId: "p1", canComment: true, canModerate: false, currentUserId: "u1", scope: title };

  beforeEach(() => {
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(JSON.stringify({ id: "new" }), { status: 201 })
        : new Response(JSON.stringify({ comments: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates a thread already anchored to its slide and element", async () => {
    const store = new DaliThreadStore(config);
    await store.createThread({ initialComment: { body: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] as never } });
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1].body)).toMatchObject({
      targetType: "doc",
      targetId: "p1",
      parentId: null,
      anchor: { kind: "blocknote", slideId: "s1", elementId: "title" },
    });
  });

  it("leaves an unscoped thread's anchor for the editor to set", async () => {
    const store = new DaliThreadStore({ ...config, scope: undefined });
    await store.createThread({ initialComment: { body: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] as never } });
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1].body).anchor).toBeNull();
  });

  it("keeps one store per text box", () => {
    const a = getOrCreateStore("pg", { ...config, pageId: undefined as never, scope: title });
    const b = getOrCreateStore("pg", { ...config, pageId: undefined as never, scope: body });
    const a2 = getOrCreateStore("pg", { ...config, pageId: undefined as never, scope: title });
    const doc = getOrCreateStore("pg");
    expect(a).toBe(a2);
    expect(a).not.toBe(b);
    expect(doc).not.toBe(a);
  });
});
