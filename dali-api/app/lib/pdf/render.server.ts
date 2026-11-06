// Headless-Chromium PDF rendering — the shared primitive behind screen-accurate
// PDF exports (signed agreements, doc export, certificates, partner deliverables).
// Feed it a self-contained HTML string (see print-html.server.ts) and it returns
// a PDF buffer rendered by the same engine the browser uses.
//
// A single browser instance is reused across renders; each render gets its own
// context/page and renders are serialised so concurrent exports don't multiply
// Chromium's memory on the small Fly machines. Prod points at the system
// Chromium via CHROMIUM_EXECUTABLE_PATH (installed in the Docker image); locally
// it falls back to a detected Chrome/Chromium.

import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright-core";
import { guardContext, PNG_HARD_TIMEOUT_MS, RenderTimeoutError, type RoutableContext } from "./render-guard.server";

export { PDF_HARD_TIMEOUT_MS, PNG_HARD_TIMEOUT_MS, RenderTimeoutError } from "./render-guard.server";

// Container-safe flags: no sandbox (no user namespaces), no /dev/shm reliance.
const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--font-render-hinting=none",
];

// Common local Chrome/Chromium locations, used only when the env var is unset
// (i.e. dev machines — the prod image always sets CHROMIUM_EXECUTABLE_PATH).
const LOCAL_FALLBACKS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function executablePath(): string | undefined {
  const fromEnv = process.env.CHROMIUM_EXECUTABLE_PATH?.trim();
  if (fromEnv) return fromEnv;
  return LOCAL_FALLBACKS.find((p) => existsSync(p));
}

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({ headless: true, executablePath: executablePath(), args: LAUNCH_ARGS })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  const browser = await browserPromise;
  if (!browser.isConnected()) {
    browserPromise = null;
    return getBrowser();
  }
  return browser;
}

// Serialise renders through a promise chain — one page at a time keeps peak
// memory bounded (a Chromium page is ~50-150MB) on shared-cpu Fly machines.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const raceMs = (work: Promise<unknown>, ms: number) => Promise.race([work, new Promise((resolve) => setTimeout(resolve, ms))]);

/** Runs a render against a deadline. On a miss it kills the render's renderer and the shared browser, then throws RenderTimeoutError. */
export async function withHardDeadline<T>(ms: number, run: () => Promise<T>, kill: () => Promise<void>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RenderTimeoutError(ms)), ms);
  });
  const work = run();
  work.catch(() => {});
  try {
    return await Promise.race([work, deadline]);
  } catch (err) {
    if (err instanceof RenderTimeoutError) await kill().catch(() => {});
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function killRender(browser: Browser, context: { close(): Promise<void> }): Promise<void> {
  await raceMs(context.close().catch(() => {}), 2000);
  browserPromise = null;
  await raceMs(browser.close().catch(() => {}), 3000);
}

export const FONTS_WAIT_MS = 5000;

export interface FontsPage {
  evaluate(fn: (ms: number) => unknown, arg: number): Promise<unknown>;
}

/** Waits for the page's web fonts, giving up after ms so a slow font host cannot stall a print. */
export function waitForFonts(page: FontsPage, ms: number = FONTS_WAIT_MS): Promise<unknown> {
  return page.evaluate((limit) => Promise.race([(document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready, new Promise((resolve) => setTimeout(resolve, limit))]), ms);
}

export const HTML_FRAME_TIMEOUT_MS = 2000;
export const HTML_FRAME_SETTLE_MS = 500;

interface FrameLike {
  waitForLoadState(state: "load", options: { timeout: number }): Promise<void>;
}

interface FrameHandle {
  contentFrame(): Promise<FrameLike | null>;
  evaluate(fn: (el: Element) => void): Promise<unknown>;
}

export interface SettlePage {
  $$(selector: string): Promise<FrameHandle[]>;
  waitForTimeout(ms: number): Promise<void>;
}

/**
 * Waits for each custom HTML frame to load (up to timeoutMs each, all at once), then gives the survivors a short settle.
 * A frame that did not load is removed and the hidden placeholder card beside it is shown. Returns how many fell back.
 */
export async function settleHtmlFrames(page: SettlePage, opts: { timeoutMs?: number; settleMs?: number } = {}): Promise<number> {
  const timeout = opts.timeoutMs ?? HTML_FRAME_TIMEOUT_MS;
  const handles = await page.$$("iframe[data-html-print]");
  if (handles.length === 0) return 0;
  const loaded = await Promise.all(
    handles.map(async (handle) => {
      try {
        const frame = await handle.contentFrame();
        if (!frame) return false;
        await frame.waitForLoadState("load", { timeout });
        return true;
      } catch {
        return false;
      }
    }),
  );
  const failed = handles.filter((_, i) => !loaded[i]);
  await Promise.all(
    failed.map((handle) =>
      handle.evaluate((el) => {
        const box = el.parentElement;
        const fallback = box?.nextElementSibling as HTMLElement | null;
        if (fallback) fallback.style.display = "contents";
        box?.remove();
      }),
    ),
  );
  if (failed.length < handles.length) await page.waitForTimeout(opts.settleMs ?? HTML_FRAME_SETTLE_MS);
  return failed.length;
}

export interface RenderPdfOptions {
  // The document has sandboxed custom HTML frames: do not wait on their network, settle them one by one instead.
  settleHtmlFrames?: boolean;
  // Only let the page reach inline data, the script and font CDNs, and images on public hosts.
  guardNetwork?: boolean;
  // A hard deadline for the whole render. Past it the renderer is killed and RenderTimeoutError is thrown.
  hardTimeoutMs?: number;
  javaScriptEnabled?: boolean;
  // Overrides the CSS @page size when set; otherwise the document's own @page
  // rule (Letter, in print-html.server.ts) governs geometry.
  format?: "Letter" | "A4";
}

// Render a standalone HTML string to a PDF buffer. Throws if Chromium can't be
// launched or the render fails — callers that must never hard-fail (the signed
// -copy download, the receipt email) should catch and fall back.
export async function renderHtmlToPdf(html: string, opts: RenderPdfOptions = {}): Promise<Buffer> {
  return serialized(async () => {
    const browser = await getBrowser();
    const context = await browser.newContext(opts.javaScriptEnabled === false ? { javaScriptEnabled: false } : {});
    try {
      const render = async () => {
        if (opts.guardNetwork) await guardContext(context as unknown as RoutableContext);
        const page = await context.newPage();
        if (opts.settleHtmlFrames) {
          await page.setContent(html, { waitUntil: "domcontentloaded" });
          await page.evaluate(() =>
            Promise.all(Array.from(document.images).map((img) => (img.complete ? null : new Promise((resolve) => ((img.onload = img.onerror = resolve), setTimeout(resolve, 10_000)))))),
          );
          await settleHtmlFrames(page as unknown as SettlePage);
        } else {
          await page.setContent(html, { waitUntil: "load" });
        }
        await waitForFonts(page as unknown as FontsPage);
        const pdf = await page.pdf({
          format: opts.format ?? "Letter",
          printBackground: true,
          preferCSSPageSize: true,
        });
        return pdf as Buffer;
      };
      return opts.hardTimeoutMs ? await withHardDeadline(opts.hardTimeoutMs, render, () => killRender(browser, context)) : await render();
    } finally {
      await raceMs(context.close().catch(() => {}), 2000);
    }
  });
}

/** An SVG drawn on a transparent background and returned as `image/png;base64,...`, for places that cannot take SVG. */
export async function renderSvgToPng(svg: string, size: number): Promise<string | null> {
  return serialized(async () => {
    const browser = await getBrowser();
    const context = await browser.newContext({ viewport: { width: size, height: size } });
    try {
      const page = await context.newPage();
      await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`, { waitUntil: "load" });
      const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
      return `image/png;base64,${Buffer.from(png).toString("base64")}`;
    } catch {
      return null;
    } finally {
      await context.close();
    }
  });
}

/** A custom HTML element drawn at w by h as `image/png;base64,...`, or null when its frame did not load in time. */
export async function renderHtmlToPng(markup: string, size: { w: number; h: number }, opts: { hardTimeoutMs?: number } = {}): Promise<string | null> {
  return serialized(async () => {
    const browser = await getBrowser();
    const context = await browser.newContext({ viewport: { width: Math.round(size.w), height: Math.round(size.h) } });
    try {
      return await withHardDeadline(
        opts.hardTimeoutMs ?? PNG_HARD_TIMEOUT_MS,
        async () => {
          await guardContext(context as unknown as RoutableContext);
          const page = await context.newPage();
          await page.setContent(markup, { waitUntil: "domcontentloaded" });
          if ((await settleHtmlFrames(page as unknown as SettlePage)) > 0) return null;
          const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: Math.round(size.w), height: Math.round(size.h) } });
          return `image/png;base64,${Buffer.from(png).toString("base64")}`;
        },
        () => killRender(browser, context),
      );
    } catch {
      return null;
    } finally {
      await raceMs(context.close().catch(() => {}), 2000);
    }
  });
}
