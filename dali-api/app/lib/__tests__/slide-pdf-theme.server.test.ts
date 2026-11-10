import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/pdf/print-html.server", () => ({ inlineUploadImages: async (html: string) => html }));
vi.mock("playwright-core", () => ({ chromium: { launch: vi.fn() } }));

import { themeFontsHref, themeTokenCss, themeTokenNames } from "~/components/slides/deck/theme-tokens";
import { THEMES } from "~/components/slides/deck/themes";
import { createRequestGuard } from "~/lib/pdf/render-guard.server";
import { deckToPrintHtml } from "~/lib/pdf/slides-print-html.server";
import { FONTS_WAIT_MS, waitForFonts } from "~/lib/pdf/render.server";

const print = (opts: { fonts?: boolean } = {}) => deckToPrintHtml({ title: "Deck", themeId: "dali-dark", slides: [{ id: "s", pos: 0, layoutId: "blank", elements: [] }], ...opts });

describe("print CSS theme tokens", () => {
  it("defines every --color-* variable any theme refers to", async () => {
    const html = await print();
    const used = new Set<string>();
    for (const theme of THEMES) for (const value of Object.values(theme.colors)) for (const m of value.matchAll(/var\((--color-[\w-]+)\)/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) expect(html).toMatch(new RegExp(`${name}: #[0-9A-F]{6};`));
    expect([...used].sort()).toEqual(themeTokenNames());
  });

  it("uses the values app.css defines", () => {
    const css = readFileSync(new URL("../../app.css", import.meta.url), "utf8");
    for (const decl of themeTokenCss().split(";").filter(Boolean)) {
      const [name, value] = decl.trim().split(": ");
      expect(css).toMatch(new RegExp(`${name}:\\s*${value}`, "i"));
    }
  });
});

describe("print fonts", () => {
  it("links Mulish and Plus Jakarta Sans at the theme weights with display=block", async () => {
    const href = themeFontsHref();
    expect(href).toBe("https://fonts.googleapis.com/css2?family=Mulish:wght@400;500;700&family=Plus+Jakarta+Sans:wght@700&display=block");
    expect(await print()).toContain(`<link rel="stylesheet" href="${href}" />`);
  });

  it("leaves the link out when asked", async () => {
    expect(await print({ fonts: false })).not.toContain("fonts.googleapis.com");
  });

  it("is allowed through the server network guard for the font stylesheet and files", async () => {
    const guard = createRequestGuard(async () => []);
    expect(await guard.allow(themeFontsHref(), "stylesheet")).toBe(true);
    expect(await guard.allow("https://fonts.gstatic.com/s/mulish/v1/x.woff2", "font")).toBe(true);
  });
});

describe("waiting for fonts", () => {
  it("asks the page to wait, with a limit", async () => {
    const evaluate = vi.fn(async () => undefined);
    await waitForFonts({ evaluate });
    expect(evaluate).toHaveBeenCalledWith(expect.any(Function), FONTS_WAIT_MS);
  });

  it("gives up after the limit when fonts never become ready", async () => {
    vi.useFakeTimers();
    try {
      const page = {
        evaluate: (fn: (ms: number) => unknown, ms: number) => {
          vi.stubGlobal("document", { fonts: { ready: new Promise(() => {}) } });
          return Promise.resolve(fn(ms));
        },
      };
      let done = false;
      const wait = waitForFonts(page, 100).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(99);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await wait;
      expect(done).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
