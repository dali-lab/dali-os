export const PAGE_SCROLLER_ATTR = "data-side-panel-page";

function pageScroller(): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[${PAGE_SCROLLER_ATTR}]`);
  return el && getComputedStyle(el).overflowY === "auto" ? el : null;
}

export function pageScrollY(): number {
  if (typeof window === "undefined") return 0;
  const el = pageScroller();
  return Math.round(el ? el.scrollTop : window.scrollY);
}

export function scrollPageTo(y: number) {
  const el = pageScroller();
  if (el) el.scrollTop = y;
  else window.scrollTo(0, y);
}

export function isPageScroll(event: Event): boolean {
  return event.target === document || (event.target instanceof HTMLElement && event.target === pageScroller());
}
