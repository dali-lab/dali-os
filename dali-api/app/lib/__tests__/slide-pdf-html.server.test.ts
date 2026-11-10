import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("~/lib/pdf/print-html.server", () => ({ inlineUploadImages: async (html: string) => html }));
vi.mock("playwright-core", () => ({ chromium: { launch: vi.fn() } }));

import { readDeck, toRenderDeck } from "~/collab/read-deck.server";
import { addSlide } from "~/components/slides/deck/deck-ops";
import { addHtml } from "~/components/slides/deck/freeform-ops";
import { initDeck } from "~/components/slides/deck/model";
import { deckHasHtml, deckToPrintHtml } from "~/lib/pdf/slides-print-html.server";
import { HTML_FRAME_TIMEOUT_MS, settleHtmlFrames, type SettlePage } from "~/lib/pdf/render.server";

async function printed(fill = true) {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, "blank", null);
  addHtml(doc, slideId, "<p>hi</p><script>1</script>", { fill });
  const render = toRenderDeck(readDeck(doc));
  const html = await deckToPrintHtml({ title: "Deck", themeId: render.themeId, slides: render.slides });
  return { html, render };
}

describe("PDF of custom HTML", () => {
  it("prints a sandboxed frame at full size with the policy and theme, and a hidden placeholder beside it", async () => {
    const { html, render } = await printed();
    expect(html).toContain("<iframe");
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-same-origin");
    expect(html).toMatch(/referrer[pP]olicy="no-referrer"/);
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("--slide-accent:#FF8B81");
    expect(html).toContain("width:1920px;height:1080px");
    expect(html).toContain("data-html-fallback");
    expect(html).toContain("Custom HTML");
    expect(deckHasHtml(render.slides)).toBe(true);
  });

  it("is not flagged for settling when the deck has none", async () => {
    const doc = new Y.Doc();
    initDeck(doc);
    addSlide(doc, "blank", null);
    expect(deckHasHtml(toRenderDeck(readDeck(doc)).slides)).toBe(false);
  });
});

function fakePage(frames: Array<"loads" | "times out" | "no frame">) {
  const evaluated: number[] = [];
  const waits: number[] = [];
  const page: SettlePage = {
    $$: async () =>
      frames.map((kind, i) => ({
        contentFrame: async () =>
          kind === "no frame"
            ? null
            : {
                waitForLoadState: async (_s: "load", o: { timeout: number }) => {
                  if (kind === "times out") throw new Error(`timeout ${o.timeout}`);
                },
              },
        evaluate: async () => void evaluated.push(i),
      })),
    waitForTimeout: async (ms) => void waits.push(ms),
  };
  return { page, evaluated, waits };
}

describe("settling custom HTML frames", () => {
  it("does nothing without frames", async () => {
    const { page, waits } = fakePage([]);
    expect(await settleHtmlFrames(page)).toBe(0);
    expect(waits).toEqual([]);
  });

  it("settles after loaded frames and leaves them in place", async () => {
    const { page, evaluated, waits } = fakePage(["loads", "loads"]);
    expect(await settleHtmlFrames(page, { settleMs: 123 })).toBe(0);
    expect(evaluated).toEqual([]);
    expect(waits).toEqual([123]);
  });

  it("falls back to the placeholder for a frame that times out or has no frame, using the 2s limit", async () => {
    const seen: number[] = [];
    const base = fakePage(["loads", "times out", "no frame"]);
    const original = base.page.$$;
    base.page.$$ = async (s) => {
      const handles = await original(s);
      return handles.map((h) => ({
        ...h,
        contentFrame: async () => {
          const f = await h.contentFrame();
          return f && { waitForLoadState: async (st: "load", o: { timeout: number }) => (seen.push(o.timeout), f.waitForLoadState(st, o)) };
        },
      }));
    };
    expect(await settleHtmlFrames(base.page)).toBe(2);
    expect(base.evaluated).toEqual([1, 2]);
    expect(seen).toEqual([HTML_FRAME_TIMEOUT_MS, HTML_FRAME_TIMEOUT_MS]);
    expect(HTML_FRAME_TIMEOUT_MS).toBe(2000);
  });

  it("skips the settle wait when every frame fell back", async () => {
    const { page, waits } = fakePage(["times out"]);
    expect(await settleHtmlFrames(page)).toBe(1);
    expect(waits).toEqual([]);
  });
});
