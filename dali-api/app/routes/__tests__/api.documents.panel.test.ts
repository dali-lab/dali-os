import { beforeEach, describe, expect, it, vi } from "vitest";

const documentLoader = vi.fn();
vi.mock("~/routes/documents.$pageId", () => ({ loader: documentLoader }));

const { loader } = await import("~/routes/api.documents.$pageId.panel");

type Args = Parameters<typeof loader>[0];
const call = (pageId: string) =>
  loader({
    request: new Request("https://dali.test/api/documents/x/panel", { headers: { Cookie: "s=1" } }),
    params: { pageId },
    context: {},
  } as unknown as Args);

const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to } });

beforeEach(() => {
  documentLoader.mockReset();
});

describe("side panel document loader", () => {
  it("runs the document route's loader for the page, with the caller's cookies", async () => {
    documentLoader.mockResolvedValue({ pageId: "d1", title: "Spec" });
    expect(await call("d1")).toEqual({ kind: "doc", data: { pageId: "d1", title: "Spec" } });
    const args = documentLoader.mock.calls[0][0];
    expect(args.params).toEqual({ pageId: "d1" });
    expect(new URL(args.request.url).pathname).toBe("/documents/d1");
    expect(args.request.headers.get("Cookie")).toBe("s=1");
  });

  it("follows a notebook to its note instead of handing the redirect to the client", async () => {
    documentLoader.mockResolvedValueOnce(redirect("/documents/n2")).mockResolvedValueOnce({ pageId: "n2", title: "Oct 1" });
    expect(await call("nb")).toEqual({ kind: "doc", data: { pageId: "n2", title: "Oct 1" } });
    expect(documentLoader.mock.calls[1][0].params).toEqual({ pageId: "n2" });
  });

  it("treats a thrown 404 as missing", async () => {
    documentLoader.mockRejectedValue(new Response("Not found", { status: 404 }));
    expect(await call("gone")).toEqual({ kind: "missing" });
  });

  it("offers a link for a page that isn't a document", async () => {
    documentLoader.mockResolvedValue(redirect("/whiteboard/w1"));
    expect(await call("w1")).toEqual({ kind: "elsewhere", href: "/whiteboard/w1" });
  });

  it("gives up on a redirect loop", async () => {
    documentLoader.mockResolvedValue(redirect("/documents/loop"));
    expect(await call("loop")).toEqual({ kind: "missing" });
    expect(documentLoader).toHaveBeenCalledTimes(3);
  });

  it("rethrows real errors", async () => {
    documentLoader.mockRejectedValue(new Error("db down"));
    await expect(call("d1")).rejects.toThrow("db down");
  });
});
