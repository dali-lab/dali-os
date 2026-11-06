export interface LivePresenter {
  id: string;
  name: string;
}

export interface LiveState {
  active: boolean;
  slideId: string | null;
  build: number;
  presenter: LivePresenter | null;
  startedAt: string | null;
  reactionsOff: boolean;
}

export const INACTIVE_LIVE: LiveState = { active: false, slideId: null, build: 0, presenter: null, startedAt: null, reactionsOff: false };

export type RenderSlide = (slideId: string, opts: { width: number; step?: number; enterStep?: number; thumb?: boolean }) => import("react").ReactNode;

export const liveUrl = (pageId: string) => `/api/slides/${encodeURIComponent(pageId)}/live`;
export const liveStreamUrl = (pageId: string) => `${liveUrl(pageId)}/stream`;
export const liveChannelName = (pageId: string) => `deck:${pageId}`;
