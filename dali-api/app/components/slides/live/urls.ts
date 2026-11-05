const base = (pageId: string) => `/slides/${encodeURIComponent(pageId)}`;
const withSlide = (path: string, slideId?: string | null) => (slideId ? `${path}?slide=${encodeURIComponent(slideId)}` : path);

export const deckUrl = base;
export const presentUrl = (pageId: string, slideId?: string | null) => withSlide(`${base(pageId)}/present`, slideId);
export const presenterUrl = (pageId: string, slideId?: string | null) => withSlide(`${base(pageId)}/presenter`, slideId);
