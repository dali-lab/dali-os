import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BANNER_CARD_WIDTH,
  BANNER_CROP_ASPECT,
  BannerContent,
  POSTER_CARD_WIDTH,
  bannerCardWidth,
  type BannerView,
} from "~/components/banners/BannerContent";

const banner = (over: Partial<BannerView> = {}): BannerView => ({
  name: "Crochet night",
  kind: "Poster",
  mediaUrl: "/api/upload/raw?key=poster.png",
  videoUrl: null,
  headline: "",
  body: "",
  ctaLabel: "",
  ctaUrl: "",
  tone: "Card",
  frequency: "Once",
  allowSnooze: false,
  author: "Ada",
  ...over,
});

const render = (b: BannerView) => renderToStaticMarkup(createElement(BannerContent, { banner: b, inert: true }));

describe("bannerCardWidth", () => {
  it("narrows the card to the poster for every poster, with or without text or an image", () => {
    expect(bannerCardWidth(banner())).toBe(POSTER_CARD_WIDTH);
    expect(bannerCardWidth(banner({ headline: "Join us", body: "Bring yarn", ctaLabel: "RSVP" }))).toBe(POSTER_CARD_WIDTH);
    expect(bannerCardWidth(banner({ mediaUrl: null }))).toBe(POSTER_CARD_WIDTH);
  });

  it("keeps the full card for other kinds", () => {
    expect(bannerCardWidth(banner({ kind: "Image" }))).toBe(BANNER_CARD_WIDTH);
    expect(bannerCardWidth(banner({ kind: "Video" }))).toBe(BANNER_CARD_WIDTH);
    expect(bannerCardWidth(banner({ kind: "Text", mediaUrl: null, headline: "Hi" }))).toBe(BANNER_CARD_WIDTH);
  });
});

describe("BannerContent poster", () => {
  it("shows a poster with no text whole at up to 80% of the window", () => {
    const html = render(banner());
    expect(html).not.toContain("grid-cols");
    expect(html).toContain("object-contain");
    expect(html).toContain("max-h-[80vh]");
  });

  it("stacks the text under the whole poster, never beside it", () => {
    const html = render(banner({ headline: "Join us" }));
    expect(html).not.toContain("grid-cols");
    expect(html).toContain("object-contain");
    expect(html).toContain("max-h-[60vh]");
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("Join us"));
    expect(html).toContain("text-2xl");
  });

  it("shows the add-an-image placeholder when a poster has no image", () => {
    expect(render(banner({ mediaUrl: null }))).toContain("Add an image");
  });
});

describe("BannerContent image", () => {
  it("shows the whole 16:9 image with no height cap that crops it", () => {
    const html = render(banner({ kind: "Image", headline: "Open house" }));
    expect(html).toContain("aspect-[16/9]");
    expect(html).not.toContain("max-h-[50vh]");
    expect(html).not.toContain("overflow-hidden");
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("Open house"));
  });
});

describe("BANNER_CROP_ASPECT", () => {
  it("crops each media kind to the frame it is shown in", () => {
    expect(BANNER_CROP_ASPECT).toEqual({ Image: 16 / 9, Poster: 3 / 4, Video: 16 / 9 });
    expect(BANNER_CROP_ASPECT.Text).toBeUndefined();
  });
});
