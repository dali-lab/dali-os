export function findBlock(root: HTMLElement, id: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>("[data-id]")) {
    if (el.getAttribute("data-id") === id) return el;
  }
  return null;
}

export function contentOf(block: HTMLElement): HTMLElement {
  return block.querySelector<HTMLElement>(":scope > .bn-block > .bn-block-content") ?? block;
}

export const BAR_ATTR = "data-enhance-bar";

export type Bounds = { top: number; bottom: number; right: number };

/** The part of the editor's scroll container not covered by the sticky bar.
 *  Read-only: overlays outside it are hidden rather than drawn over the bars. */
export function overlayBounds(root: HTMLElement): Bounds {
  let top = 0;
  let bottom = window.innerHeight;
  let right = window.innerWidth;
  for (let el = root.parentElement; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") {
      const r = el.getBoundingClientRect();
      top = Math.max(top, r.top);
      bottom = Math.min(bottom, r.bottom);
      right = Math.min(right, r.right);
      break;
    }
  }
  const bar = document.querySelector(`[${BAR_ATTR}]`);
  if (bar) top = Math.max(top, bar.getBoundingClientRect().bottom);
  return { top, bottom, right };
}

export function inBounds(box: { top: number; bottom: number }, bounds: Pick<Bounds, "top" | "bottom">): boolean {
  return box.bottom >= bounds.top && box.top <= bounds.bottom;
}

/** Coalesces bursts (mutation, scroll, resize) into one call per frame. */
export function frameThrottle(fn: () => void): { run: () => void; cancel: () => void } {
  let handle: number | null = null;
  const hasRaf = typeof requestAnimationFrame === "function";
  return {
    run() {
      if (handle !== null) return;
      handle = hasRaf ? requestAnimationFrame(tick) : (setTimeout(tick, 16) as unknown as number);
    },
    cancel() {
      if (handle === null) return;
      if (hasRaf) cancelAnimationFrame(handle);
      else clearTimeout(handle);
      handle = null;
    },
  };
  function tick() {
    handle = null;
    fn();
  }
}
