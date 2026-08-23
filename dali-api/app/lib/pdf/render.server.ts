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

export interface RenderPdfOptions {
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
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: "load" });
      // Let embedded fonts settle before printing.
      await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready);
      const pdf = await page.pdf({
        format: opts.format ?? "Letter",
        printBackground: true,
        preferCSSPageSize: true,
      });
      return pdf as Buffer;
    } finally {
      await context.close();
    }
  });
}
