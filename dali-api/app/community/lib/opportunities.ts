// Client-safe limits and rules for the /community/opportunities feed.
import { ASK_ME_ABOUT_SUGGESTIONS } from "~/alumni/lib/alumni-onboarding";

export const OPPORTUNITY_REACTION_EMOJI = ["🙌", "❤️", "🔥", "🎉", "👀", "😂"] as const;

export const OPPORTUNITY_BODY_MAX = 2000;
export const OPPORTUNITY_COMMENT_MAX = 1000;
export const OPPORTUNITY_NOTE_MAX = 500;
export const OPPORTUNITY_FIELD_MAX = 200;
export const OPPORTUNITY_TOPIC_MAX = 80;
export const OPPORTUNITY_IDS_MAX = 50;

export const RESUME_REVIEW_TOPIC = "Resume review";
export const PORTFOLIO_REVIEW_TOPIC = "Portfolio review";

export const CHAT_TOPIC_SUGGESTIONS = [...ASK_ME_ABOUT_SUGGESTIONS, RESUME_REVIEW_TOPIC, PORTFOLIO_REVIEW_TOPIC] as const;

export type ChatMatchProfile = {
  askMeAbout: readonly string[];
  openToCoffeeChats: boolean;
  openToResumeReviews: boolean;
  openToPortfolioReviews: boolean;
};

export type ChatMatchReason = "askMeAbout" | "resumeReviews" | "portfolioReviews";

const normalizeTopic = (topic: string) => topic.trim().replace(/\s+/g, " ").toLowerCase();

export function chatAskMatch(topic: string | null | undefined, profile: ChatMatchProfile): ChatMatchReason | null {
  if (!topic) return null;
  const wanted = normalizeTopic(topic);
  if (!wanted) return null;
  if (wanted === normalizeTopic(RESUME_REVIEW_TOPIC) && profile.openToResumeReviews) return "resumeReviews";
  if (wanted === normalizeTopic(PORTFOLIO_REVIEW_TOPIC) && profile.openToPortfolioReviews) return "portfolioReviews";
  if (profile.openToCoffeeChats && profile.askMeAbout.some((entry) => normalizeTopic(entry) === wanted)) {
    return "askMeAbout";
  }
  return null;
}

export const CHAT_MATCH_REASON_COPY: Record<ChatMatchReason, string> = {
  askMeAbout: "It's on your Ask me about list",
  resumeReviews: "You're open to resume reviews",
  portfolioReviews: "You're open to portfolio reviews",
};

// Matches the "#RRGGBB" the composer reads off the logo.
export function isBlockColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}
