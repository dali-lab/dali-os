import { describe, expect, it } from "vitest";
import { chatAskMatch, CHAT_TOPIC_SUGGESTIONS, isBlockColor, type ChatMatchProfile } from "~/community/lib/opportunities";

const profile = (over: Partial<ChatMatchProfile> = {}): ChatMatchProfile => ({
  askMeAbout: [],
  openToCoffeeChats: true,
  openToResumeReviews: false,
  openToPortfolioReviews: false,
  ...over,
});

describe("chatAskMatch", () => {
  it("matches a chip topic listed under Ask me about", () => {
    expect(chatAskMatch("Startups", profile({ askMeAbout: ["Startups"] }))).toBe("askMeAbout");
  });

  it("matches a typed topic the alum also typed", () => {
    expect(chatAskMatch("Climate tech", profile({ askMeAbout: ["Climate tech"] }))).toBe("askMeAbout");
  });

  it("ignores case and extra spaces", () => {
    expect(chatAskMatch("  breaking   INTO tech ", profile({ askMeAbout: ["Breaking into tech"] }))).toBe("askMeAbout");
  });

  it("needs coffee chats switched on for an Ask me about match", () => {
    expect(chatAskMatch("Startups", profile({ askMeAbout: ["Startups"], openToCoffeeChats: false }))).toBeNull();
  });

  it("matches review topics by their switches, not Ask me about", () => {
    expect(chatAskMatch("Resume review", profile({ openToResumeReviews: true, openToCoffeeChats: false }))).toBe(
      "resumeReviews",
    );
    expect(chatAskMatch("Portfolio review", profile({ openToPortfolioReviews: true }))).toBe("portfolioReviews");
    expect(chatAskMatch("Resume review", profile())).toBeNull();
  });

  it("does not match a topic nobody listed, or no topic", () => {
    expect(chatAskMatch("Underwater basket weaving", profile({ askMeAbout: ["Startups"] }))).toBeNull();
    expect(chatAskMatch(null, profile({ askMeAbout: ["Startups"] }))).toBeNull();
    expect(chatAskMatch("   ", profile({ askMeAbout: [""] }))).toBeNull();
  });

  it("offers the onboarding chips plus the two review topics", () => {
    expect(CHAT_TOPIC_SUGGESTIONS).toContain("Breaking into tech");
    expect(CHAT_TOPIC_SUGGESTIONS.slice(-2)).toEqual(["Resume review", "Portfolio review"]);
  });
});

describe("isBlockColor", () => {
  it("accepts six-digit hex only", () => {
    expect(isBlockColor("#F2B94E")).toBe(true);
    expect(isBlockColor("F2B94E")).toBe(false);
    expect(isBlockColor("#fff")).toBe(false);
    expect(isBlockColor("red")).toBe(false);
  });
});
