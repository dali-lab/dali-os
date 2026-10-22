import { writeFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { test as base } from '../../e2e/fixtures';
import { DEMO_NAME_FILE, demoBaseName } from './encode';

export { expect } from '../../e2e/fixtures';
export { setFeatureFlag } from '../../e2e/helpers';

const CURSOR_SCRIPT = () => {
  const POS_KEY = '__demo_cursor';
  const install = () => {
    if (document.getElementById('__demo_cursor')) return;
    const style = document.createElement('style');
    style.textContent = `
      #__demo_cursor, .__demo_ripple { position: fixed; inset: auto; padding: 0; border: 0; background: none;
        overflow: visible; pointer-events: none; left: 0; top: 0; }
      #__demo_cursor { width: 22px; height: 22px; margin: -3px 0 0 -3px; }
      .__demo_ripple { width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
        border: 2px solid #0a8f6a; background: rgba(10,143,106,.25); animation: __demo_ripple .55s ease-out forwards; }
      @keyframes __demo_ripple { to { transform: scale(3.6); opacity: 0; } }`;
    const cursor = document.createElement('div');
    cursor.id = '__demo_cursor';
    cursor.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 8-6 1.5L8.5 18z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    let last = { x: 640, y: 360 };
    try {
      last = JSON.parse(sessionStorage.getItem(POS_KEY) || '') || last;
    } catch {
      /* no saved position */
    }
    cursor.style.transform = `translate(${last.x}px, ${last.y}px)`;
    // Popovers render in the top layer: above modals, and untouched by the zoom transform on <html>.
    cursor.popover = 'manual';
    document.documentElement.append(style, cursor);
    cursor.showPopover();
    document.addEventListener(
      'mousemove',
      (e) => {
        cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        try {
          sessionStorage.setItem(POS_KEY, JSON.stringify({ x: e.clientX, y: e.clientY }));
        } catch {
          /* ignore */
        }
      },
      true,
    );
    document.addEventListener(
      'mousedown',
      (e) => {
        const ripple = document.createElement('div');
        ripple.className = '__demo_ripple';
        ripple.style.left = `${e.clientX}px`;
        ripple.style.top = `${e.clientY}px`;
        ripple.popover = 'manual';
        document.documentElement.append(ripple);
        ripple.showPopover();
        setTimeout(() => ripple.remove(), 600);
      },
      true,
    );
  };
  if (document.documentElement) install();
  document.addEventListener('DOMContentLoaded', install);
};

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class Stage {
  private pos = { x: 640, y: 360 };

  constructor(readonly page: Page) {}

  pause(ms: number) {
    return this.page.waitForTimeout(ms);
  }

  /** Glide the real mouse (and so the injected cursor) to the center of the element. */
  async moveTo(target: Locator, duration = 700) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error('moveTo: element has no bounding box');
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const from = this.pos;
    const steps = Math.max(12, Math.round(duration / 16));
    for (let i = 1; i <= steps; i++) {
      const k = easeInOut(i / steps);
      await this.page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
      await this.page.waitForTimeout(duration / steps);
    }
    this.pos = to;
  }

  /** moveTo, a beat, then a real click (the cursor script draws the ripple on mousedown). */
  async click(target: Locator) {
    await this.moveTo(target);
    await this.pause(150);
    await this.page.mouse.click(this.pos.x, this.pos.y);
  }

  /** Click the field, then type with a per-character delay. */
  async type(target: Locator, text: string, delayMs = 55) {
    await this.click(target);
    await this.page.keyboard.type(text, { delay: delayMs });
  }

  /** Zoom the page so the element fills more of the frame. */
  async zoomTo(target: Locator, scale = 1.6, ms = 700) {
    await this.resetZoom(0);
    const box = await target.boundingBox();
    if (!box) throw new Error('zoomTo: element has no bounding box');
    await this.page.evaluate(
      ({ box, scale, ms }) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
        const tx = clamp(vw / 2 - scale * (box.x + box.width / 2), vw - scale * vw, 0);
        const ty = clamp(vh / 2 - scale * (box.y + box.height / 2), vh - scale * vh, 0);
        const s = document.documentElement.style;
        s.transformOrigin = '0 0';
        s.transition = `transform ${ms}ms cubic-bezier(.4,0,.2,1)`;
        void document.documentElement.offsetWidth;
        s.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      },
      { box, scale, ms },
    );
    await this.pause(ms + 100);
  }

  async resetZoom(ms = 600) {
    await this.page.evaluate((ms) => {
      const s = document.documentElement.style;
      s.transition = ms ? `transform ${ms}ms cubic-bezier(.4,0,.2,1)` : 'none';
      s.transform = 'none';
    }, ms);
    if (ms) await this.pause(ms + 100);
  }
}

export const test = base.extend<{ stage: Stage }>({
  page: async ({ page, baseURL }, use, testInfo) => {
    await writeFile(testInfo.outputPath(DEMO_NAME_FILE), demoBaseName(testInfo.file));
    await page.addInitScript(CURSOR_SCRIPT);
    // Keep in sync with DISMISS_KEY in app/components/DesktopBanner.tsx.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('dali:desktop-banner:dismissed', '1');
      } catch {
        /* localStorage unavailable */
      }
    });
    // e2e fixtures pin the tabbed shell; real users get the plain page.
    if (baseURL) await page.context().addCookies([{ name: 'dali_tabless', value: '1', url: baseURL }]);
    await use(page);
  },
  stage: async ({ page }, use) => {
    await use(new Stage(page));
  },
});
