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

/** The layer DocEditor renders at the top of `.dali-doc` for review overlays.
 *  It sits in the note's flow, so anything positioned inside it scrolls with
 *  the blocks and never needs a scroll listener. */
export function overlayHost(root: HTMLElement): HTMLElement | null {
  return root.closest(".dali-doc")?.querySelector<HTMLElement>(":scope > .dali-doc-overlay-host") ?? null;
}

export type HostBox = { top: number; bottom: number; left: number; right: number };

/** A viewport rect in the host's coordinates. */
export function toHost(r: DOMRect, host: DOMRect): HostBox {
  return { top: r.top - host.top, bottom: r.bottom - host.top, left: r.left - host.left, right: r.right - host.left };
}

/** The right edge, in host coordinates, of the editor's scroll container:
 *  how far right an overlay can sit beside a block before it clips. */
export function scrollEdge(root: HTMLElement, host: DOMRect): number {
  let right = Math.min(window.innerWidth, root.getBoundingClientRect().right);
  for (let el = root.parentElement; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") {
      right = Math.min(right, el.getBoundingClientRect().right);
      break;
    }
  }
  return right - host.left;
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
