import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/s3", () => ({ isS3Configured: vi.fn(), getObjectWithMetadata: vi.fn(), putObject: vi.fn() }));
vi.mock("~/lib/pdf/render.server", () => ({ renderHtmlToPng: vi.fn() }));

import type { DeckRead } from "~/collab/read-deck.server";
import { htmlPreviewVersion } from "~/components/slides/deck/html-preview";
import { renderHtmlToPng } from "~/lib/pdf/render.server";
import { getObjectWithMetadata, isS3Configured, putObject } from "~/lib/s3";
import { getHtmlPreview, htmlPreviewKey } from "~/lib/slide-html-preview.server";

const PNG = Buffer.from([1, 2, 3]);
const pngData = `image/png;base64,${PNG.toString("base64")}`;

function deckWith(elements: Array<Record<string, unknown>>, themeId = "dali-dark"): DeckRead {
  return {
    v: 1,
    themeId,
    plainText: "",
    slides: [{ id: "s1", pos: 0, layoutId: "blank", notes: { blocks: [], text: "" }, elements: elements as never }],
  };
}

const html = (extra: Record<string, unknown> = {}) => ({ id: "e1", kind: "html", slot: null, html: "<p>hi</p>", x: 0, y: 0, w: 960.4, h: 540, ...extra });
const versionOf = (source = "<p>hi</p>", themeId = "dali-dark", w = 960, h = 540) => htmlPreviewVersion(source, themeId, { w, h });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isS3Configured).mockReturnValue(true);
  vi.mocked(getObjectWithMetadata).mockResolvedValue(null);
  vi.mocked(renderHtmlToPng).mockResolvedValue(pngData);
});

describe("getHtmlPreview", () => {
  it("keys one object per element", () => {
    expect(htmlPreviewKey("p1", "e1")).toBe("slides/html-previews/p1/e1.png");
  });

  it("serves the stored picture without rendering when its version matches", async () => {
    vi.mocked(getObjectWithMetadata).mockResolvedValue({ body: Buffer.from([9]), metadata: { v: versionOf() } });
    const out = await getHtmlPreview("p1", "e1", deckWith([html()]));
    expect(out).toEqual({ png: Buffer.from([9]), version: versionOf() });
    expect(renderHtmlToPng).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });

  it("renders at the element's rounded size and overwrites the same key when nothing is stored", async () => {
    const out = await getHtmlPreview("p1", "e1", deckWith([html()]));
    expect(out).toEqual({ png: PNG, version: versionOf() });
    const [markup, size] = vi.mocked(renderHtmlToPng).mock.calls[0];
    expect(size).toEqual({ w: 960, h: 540 });
    expect(markup).toContain("&lt;p>hi&lt;/p>");
    expect(putObject).toHaveBeenCalledWith("slides/html-previews/p1/e1.png", PNG, "image/png", { v: versionOf() });
  });

  it("re-renders when the source, theme or size changed since the stored picture", async () => {
    vi.mocked(getObjectWithMetadata).mockResolvedValue({ body: Buffer.from([9]), metadata: { v: versionOf() } });
    await getHtmlPreview("p1", "e1", deckWith([html({ html: "<p>bye</p>" })]));
    await getHtmlPreview("p1", "e1", deckWith([html()], "dali-light"));
    await getHtmlPreview("p1", "e1", deckWith([html({ w: 400 })]));
    expect(renderHtmlToPng).toHaveBeenCalledTimes(3);
    expect(vi.mocked(putObject).mock.calls.map((c) => c[3])).toEqual([
      { v: versionOf("<p>bye</p>") },
      { v: versionOf("<p>hi</p>", "dali-light") },
      { v: versionOf("<p>hi</p>", "dali-dark", 400) },
    ]);
  });

  it("draws a fill-slide element at the whole stage", async () => {
    await getHtmlPreview("p1", "e1", deckWith([html({ x: 0, y: 0, w: 1920, h: 1080, htmlFill: true })]));
    expect(vi.mocked(renderHtmlToPng).mock.calls[0][1]).toEqual({ w: 1920, h: 1080 });
  });

  it("stores nothing and returns null when the render does not finish", async () => {
    vi.mocked(renderHtmlToPng).mockResolvedValue(null);
    expect(await getHtmlPreview("p1", "e1", deckWith([html()]))).toBeNull();
    expect(putObject).not.toHaveBeenCalled();
  });

  it("returns null for a missing element, a non-HTML element, or without S3", async () => {
    expect(await getHtmlPreview("p1", "nope", deckWith([html()]))).toBeNull();
    expect(await getHtmlPreview("p1", "e1", deckWith([{ ...html(), kind: "text" }]))).toBeNull();
    vi.mocked(isS3Configured).mockReturnValue(false);
    expect(await getHtmlPreview("p1", "e1", deckWith([html()]))).toBeNull();
    expect(getObjectWithMetadata).not.toHaveBeenCalled();
    expect(renderHtmlToPng).not.toHaveBeenCalled();
  });

  it("shares one render between concurrent requests for the same version, then renders again later", async () => {
    let finish!: (v: string) => void;
    vi.mocked(renderHtmlToPng).mockReturnValueOnce(new Promise((r) => (finish = r)));
    const deck = deckWith([html()]);
    const a = getHtmlPreview("p1", "e1", deck);
    const b = getHtmlPreview("p1", "e1", deck);
    await vi.waitFor(() => expect(renderHtmlToPng).toHaveBeenCalledTimes(1));
    finish(pngData);
    expect(await a).toEqual(await b);
    expect(putObject).toHaveBeenCalledTimes(1);
    await getHtmlPreview("p1", "e1", deck);
    expect(getObjectWithMetadata).toHaveBeenCalledTimes(2);
  });
});
