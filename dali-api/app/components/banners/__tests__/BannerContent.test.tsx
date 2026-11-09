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
  it("narrows the card to the poster when a poster has no text", () => {
    expect(bannerCardWidth(banner())).toBe(POSTER_CARD_WIDTH);
  });

  it("keeps the full card when a poster has a headline, message or button", () => {
    expect(bannerCardWidth(banner({ headline: "Join us" }))).toBe(BANNER_CARD_WIDTH);
    expect(bannerCardWidth(banner({ body: "Bring yarn" }))).toBe(BANNER_CARD_WIDTH);
    expect(bannerCardWidth(banner({ ctaLabel: "RSVP" }))).toBe(BANNER_CARD_WIDTH);
  });

  it("keeps the full card for a poster with no image yet and for other kinds", () => {
    expect(bannerCardWidth(banner({ mediaUrl: null }))).toBe(BANNER_CARD_WIDTH);
    expect(bannerCardWidth(banner({ kind: "Image" }))).toBe(BANNER_CARD_WIDTH);
    expect(bannerCardWidth(banner({ kind: "Text", mediaUrl: null, headline: "Hi" }))).toBe(BANNER_CARD_WIDTH);
  });
});

describe("BannerContent poster", () => {
  it("shows a poster with no text whole, with no empty text column", () => {
    const html = render(banner());
    expect(html).not.toContain("grid-cols");
    expect(html).toContain("object-contain");
    expect(html).not.toContain("aspect-[3/4]");
  });

  it("keeps the poster beside its text when there is text", () => {
    const html = render(banner({ headline: "Join us" }));
    expect(html).toContain("grid-cols");
    expect(html).toContain("aspect-[3/4]");
    expect(html).toContain("Join us");
  });

  it("shows the add-an-image placeholder when a poster has no image", () => {
    expect(render(banner({ mediaUrl: null }))).toContain("Add an image");
  });
});

describe("BANNER_CROP_ASPECT", () => {
  it("crops each media kind to the frame it is shown in", () => {
    expect(BANNER_CROP_ASPECT).toEqual({ Image: 16 / 9, Poster: 3 / 4, Video: 16 / 9 });
    expect(BANNER_CROP_ASPECT.Text).toBeUndefined();
  });
});
