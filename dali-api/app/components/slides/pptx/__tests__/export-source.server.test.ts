import * as Y from "yjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDownloadUrl: vi.fn(async (key: string) => `https://s3.example/${key}`),
  requireAuth: vi.fn(),
  isNonMember: vi.fn(async () => false),
  isPartnerAccount: vi.fn(async () => false),
  deckAccess: vi.fn(),
  loadDeck: vi.fn(),
  readLiveDeck: vi.fn(),
  logAuditEvent: vi.fn(async () => {}),
}));

vi.mock("~/lib/s3", () => ({ getDownloadUrl: mocks.getDownloadUrl }));
vi.mock("~/lib/auth", () => ({
  requireAuth: mocks.requireAuth,
  isNonMember: mocks.isNonMember,
  isPartnerAccount: mocks.isPartnerAccount,
}));
vi.mock("~/lib/slide-decks.server", () => ({ deckAccess: mocks.deckAccess, loadDeck: mocks.loadDeck }));
vi.mock("~/collab/deck-live.server", () => ({ readLiveDeck: mocks.readLiveDeck }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: mocks.logAuditEvent }));

import JSZip from "jszip";
import { readDeck } from "~/collab/read-deck.server";
import { addSlide, deleteSlide } from "~/components/slides/deck/deck-ops";
import { initDeck } from "~/components/slides/deck/model";
import { buildDeckPptx } from "../export.server";
import { createImageLoader, uploadKeyOf } from "../export-images.server";
import { loader } from "~/routes/slides.$pageId.export-pptx";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const response = (bytes: Uint8Array, ok = true) => ({ ok, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }) as unknown as Response;

describe("tombstones", () => {
  it("leaves deleted slides out of the file", async () => {
    const doc = new Y.Doc();
    initDeck(doc);
    const first = addSlide(doc, "title", null);
    const second = addSlide(doc, "content", first);
    addSlide(doc, "content", second);
    deleteSlide(doc, second);
    const built = await buildDeckPptx(readDeck(doc), { title: "T", loadImage: async () => null });
    expect(built.slideCount).toBe(2);
    const zip = await JSZip.loadAsync(built.buffer);
    expect(zip.file("ppt/slides/slide2.xml")).not.toBeNull();
    expect(zip.file("ppt/slides/slide3.xml")).toBeNull();
  });
});

describe("export images", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads only unreserved uploads keys from the raw upload route", () => {
    expect(uploadKeyOf("/api/upload/raw?key=uploads/doc-images/a.png")).toBe("uploads/doc-images/a.png");
    expect(uploadKeyOf("/api/upload/raw?key=other/a.png")).toBeNull();
    expect(uploadKeyOf("https://evil.example/a.png")).toBeNull();
    expect(uploadKeyOf("not a url at all %")).toBeNull();
  });

  it("returns an embeddable image with its size", async () => {
    const load = createImageLoader(async () => response(PNG));
    const image = await load("/api/upload/raw?key=uploads/doc-images/a.png");
    expect(mocks.getDownloadUrl).toHaveBeenCalledWith("uploads/doc-images/a.png");
    expect(image?.data.startsWith("image/png;base64,")).toBe(true);
    expect(image?.size).toEqual({ width: 1, height: 1 });
  });

  it("skips formats PowerPoint can't embed, failed fetches and foreign sources", async () => {
    const webp = new TextEncoder().encode("RIFF....WEBPVP8 ");
    expect(await createImageLoader(async () => response(webp))("/api/upload/raw?key=uploads/a.webp")).toBeNull();
    expect(await createImageLoader(async () => response(PNG, false))("/api/upload/raw?key=uploads/a.png")).toBeNull();
    const fetchSpy = vi.fn(async () => response(PNG));
    expect(await createImageLoader(fetchSpy)("https://elsewhere.example/a.png")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("export route", () => {
  const request = (id = "p1") => ({ request: new Request(`https://os.example.edu/slides/${id}/export.pptx`), params: { pageId: id } }) as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
    mocks.isNonMember.mockResolvedValue(false);
    mocks.isPartnerAccount.mockResolvedValue(false);
    mocks.deckAccess.mockResolvedValue({ ok: true, page: { id: "p1", title: "Q4 review!", iconEmoji: null }, canEdit: false });
    mocks.loadDeck.mockResolvedValue({ slides: [], version: "v", storage: "yjs" });
    mocks.readLiveDeck.mockResolvedValue({ read: { v: 1, themeId: "dali-dark", slides: [], plainText: "" }, updatedAt: null });
  });

  it("rejects signed-out, non-member and partner callers", async () => {
    mocks.requireAuth.mockResolvedValueOnce({ ok: false });
    expect((await loader(request())).status).toBe(401);
    mocks.isNonMember.mockResolvedValueOnce(true);
    expect((await loader(request())).status).toBe(403);
    mocks.isPartnerAccount.mockResolvedValueOnce(true);
    expect((await loader(request())).status).toBe(403);
    expect(mocks.deckAccess).not.toHaveBeenCalled();
  });

  it("answers 404 when the viewer can't see the deck", async () => {
    mocks.deckAccess.mockResolvedValueOnce({ ok: false, status: 404, error: "nope" });
    const res = await loader(request());
    expect(res.status).toBe(404);
    expect(mocks.readLiveDeck).not.toHaveBeenCalled();
  });

  it("serves a view-only member an attachment named after the deck and logs it", async () => {
    const res = await loader(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="Q4_review.pptx"');
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    expect(zip.file("ppt/presentation.xml")).not.toBeNull();
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "document.export", targetId: "p1", metadata: expect.objectContaining({ format: "pptx" }) }));
  });

  it("exports a deck that has not moved to live storage from its saved slides", async () => {
    mocks.loadDeck.mockResolvedValueOnce({
      slides: [{ id: "s1", layout: "title", title: "Legacy title", notes: "old notes" }],
      version: "v",
      storage: "json",
    });
    const res = await loader(request());
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    expect(await zip.file("ppt/slides/slide1.xml")!.async("string")).toContain("Legacy title");
    expect(mocks.readLiveDeck).not.toHaveBeenCalled();
  });
});
