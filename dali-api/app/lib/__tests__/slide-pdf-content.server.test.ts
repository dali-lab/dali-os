import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("~/lib/pdf/print-html.server", () => ({ inlineUploadImages: async (html: string) => html }));

import { readDeck, toRenderDeck } from "~/collab/read-deck.server";
import { addSlide } from "~/components/slides/deck/deck-ops";
import { addChart, addCodeBlock, addIcon, addTable, addVideo } from "~/components/slides/deck/freeform-ops";
import { initDeck } from "~/components/slides/deck/model";
import { deckToPrintHtml } from "~/lib/pdf/slides-print-html.server";

describe("PDF of new element kinds", () => {
  it("prints charts, icons, video posters, tables and code as static markup on their own page", async () => {
    const doc = new Y.Doc();
    initDeck(doc);
    const slideId = addSlide(doc, "blank", null);
    addChart(doc, slideId, "bar");
    addChart(doc, slideId, "pie");
    addIcon(doc, slideId, "rocket");
    addVideo(doc, slideId, "https://youtu.be/dQw4w9WgXcQ");
    addTable(doc, slideId);
    addCodeBlock(doc, slideId);
    const render = toRenderDeck(readDeck(doc));
    const html = await deckToPrintHtml({ title: "Deck", themeId: render.themeId, slides: render.slides });
    expect(html.match(/<section class="pdf-page"/g)).toHaveLength(1);
    expect(html).toContain('data-chart="bar"');
    expect(html).toContain('data-chart="pie"');
    expect(html).toContain('data-icon="rocket"');
    expect(html).toContain("YouTube video");
    expect(html).toContain("data-slide-table");
    expect(html).toContain("<pre");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("recharts");
  });

  it("leaves out a chart whose data is invalid instead of failing the export", async () => {
    const doc = new Y.Doc();
    initDeck(doc);
    const slideId = addSlide(doc, "blank", null);
    addChart(doc, slideId, "bar");
    const render = toRenderDeck(readDeck(doc));
    render.slides[0].elements[0].chart = undefined;
    const html = await deckToPrintHtml({ title: "Deck", themeId: render.themeId, slides: render.slides });
    expect(html).toContain("Chart data is missing");
  });
});
