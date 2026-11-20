import type { AuthTile } from "~/components/auth/auth-tiles";

export type OpenToChoices = {
  coffeeChats: boolean;
  resumeReviews: boolean;
  partnerReferrals: boolean;
  mentoring: boolean;
  speaking: boolean;
};

export const OPEN_TO_CHOICES = [
  { key: "coffeeChats", title: "Coffee chats", subtitle: "A 20 minute call with a student", bg: "#E68FBE", fg: "#FFF3B5", motif: "dot" },
  { key: "resumeReviews", title: "Resume reviews", subtitle: "Comments on a resume or portfolio", bg: "#FFCF88", fg: "#0C4876", motif: "ring" },
  { key: "partnerReferrals", title: "Partner referrals", subtitle: "Point a company or nonprofit our way", bg: "#8CE0D6", fg: "#0C4876", motif: "dot" },
  { key: "mentoring", title: "Mentor a project", subtitle: "An hour every other week for a term", bg: "#24B1B1", fg: "#FFFFFF", motif: "flower" },
  { key: "speaking", title: "Speak at a lab event", subtitle: "A talk or a panel, in person or remote", bg: "#0C4876", fg: "#FFF3B5", motif: "quarter" },
] as const satisfies readonly {
  key: keyof OpenToChoices;
  title: string;
  subtitle: string;
  bg: string;
  fg: string;
  motif: AuthTile["motif"];
}[];

export function parseJsonList(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function openToPatch(choices: OpenToChoices) {
  return {
    coffeeChats: choices.coffeeChats,
    resumeReviews: choices.resumeReviews,
    portfolioReviews: choices.resumeReviews,
    partnerReferrals: choices.partnerReferrals,
    mentoring: choices.mentoring,
    speaking: choices.speaking,
  };
}
