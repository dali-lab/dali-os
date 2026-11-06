import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isPartnerAccount: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/slide-decks.server", () => ({ deckAccess: vi.fn(), readDeckModel: vi.fn() }));
vi.mock("~/lib/slide-html-preview.server", () => ({ getHtmlPreview: vi.fn() }));

import { isNonMember, isPartnerAccount, requireAuth } from "~/lib/auth";
import { deckAccess, readDeckModel } from "~/lib/slide-decks.server";
import { getHtmlPreview } from "~/lib/slide-html-preview.server";
import { loader } from "~/routes/slides.$pageId.html-preview.$elementId";

const read = { themeId: "dali-dark", slides: [] };

const get = (v = "abc") =>
  loader({
    request: new Request(`http://localhost/slides/p1/html-preview/e1?v=${v}`),
    params: { pageId: "p1", elementId: "e1" },
    context: {},
  } as never) as Promise<Response>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(isPartnerAccount).mockResolvedValue(false as never);
  vi.mocked(deckAccess).mockResolvedValue({ ok: true, page: { id: "p1", title: "Deck", iconEmoji: null }, canEdit: false, canComment: false } as never);
  vi.mocked(readDeckModel).mockResolvedValue(read as never);
  vi.mocked(getHtmlPreview).mockResolvedValue({ png: Buffer.from([137, 80, 78, 71]), version: "abc" });
});

describe("slides html-preview", () => {
  it("returns the element's PNG from the deck the server holds", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(deckAccess).toHaveBeenCalledWith("u1", "p1", expect.any(Request));
    expect(getHtmlPreview).toHaveBeenCalledWith("p1", "e1", read);
  });

  it("lets the browser keep it forever only when it is the version asked for", async () => {
    expect((await get("abc")).headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect((await get("old")).headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("answers 404 without caching when there is no picture", async () => {
    vi.mocked(getHtmlPreview).mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("answers 404 to someone who cannot view the deck, before reading it", async () => {
    vi.mocked(deckAccess).mockResolvedValue({ ok: false, status: 404, error: "Slide deck not found." } as never);
    expect((await get()).status).toBe(404);
    expect(readDeckModel).not.toHaveBeenCalled();
    expect(getHtmlPreview).not.toHaveBeenCalled();
  });

  it("rejects signed-out, non-member and partner callers", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({ ok: false } as never);
    expect((await get()).status).toBe(401);
    vi.mocked(isNonMember).mockResolvedValueOnce(true);
    expect((await get()).status).toBe(403);
    vi.mocked(isPartnerAccount).mockResolvedValueOnce(true as never);
    expect((await get()).status).toBe(403);
    expect(getHtmlPreview).not.toHaveBeenCalled();
  });
});
