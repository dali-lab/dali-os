import { MAX_POLL_OPTIONS } from "~/components/slides/deck/content";
import type { PollResult } from "~/components/slides/deck/content-render";

export const REACTIONS = ["👍", "👏", "❤️", "😂", "🎉", "🤔"] as const;
export type ReactionEmoji = (typeof REACTIONS)[number];
export const REACTION_INTERVAL_MS = 1000;
export const REACTION_LIFETIME_MS = 3200;

export interface PollsState {
  active: boolean;
  polls: Record<string, PollResult>;
}

export const NO_POLLS: PollsState = { active: false, polls: {} };
export const EMPTY_RESULT: PollResult = { counts: Array.from({ length: MAX_POLL_OPTIONS }, () => 0), total: 0, mine: [], closed: false };

export const pollsUrl = (pageId: string) => `/api/slides/${encodeURIComponent(pageId)}/polls`;
export const pollsStreamUrl = (pageId: string) => `${pollsUrl(pageId)}/stream`;
export const reactionsUrl = (pageId: string) => `/api/slides/${encodeURIComponent(pageId)}/reactions`;
export const reactionsStreamUrl = (pageId: string) => `${reactionsUrl(pageId)}/stream`;
