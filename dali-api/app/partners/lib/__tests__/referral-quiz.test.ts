import { describe, expect, it } from "vitest";
import {
  REFERRAL_QUIZ,
  REFERRAL_TIER_LABEL,
  REFERRAL_TIER_PAYOUT_USD,
  gradeReferralQuiz,
} from "../referral-quiz";

describe("gradeReferralQuiz", () => {
  it("passes only when every answer is correct", () => {
    const perfect = Object.fromEntries(
      REFERRAL_QUIZ.map((q) => [q.id, q.correctChoiceId]),
    );
    const result = gradeReferralQuiz(perfect);
    expect(result).toEqual({ passed: true, wrongQuestionIds: [] });
  });

  it("names the wrong questions so the retry UI can highlight them", () => {
    const answers = Object.fromEntries(
      REFERRAL_QUIZ.map((q) => [q.id, q.correctChoiceId]),
    );
    // Flip the first question to a wrong choice.
    const first = REFERRAL_QUIZ[0];
    answers[first.id] = first.choices.find((c) => c.id !== first.correctChoiceId)!.id;
    const result = gradeReferralQuiz(answers);
    expect(result.passed).toBe(false);
    expect(result.wrongQuestionIds).toEqual([first.id]);
  });

  it("treats missing answers as wrong", () => {
    const result = gradeReferralQuiz({});
    expect(result.passed).toBe(false);
    expect(result.wrongQuestionIds).toEqual(REFERRAL_QUIZ.map((q) => q.id));
  });
});

describe("referral tier constants", () => {
  it("labels and payouts cover every tier", () => {
    const tiers = ["Cold", "Warm", "FullPitch"] as const;
    for (const t of tiers) {
      expect(REFERRAL_TIER_LABEL[t]).toBeTruthy();
      expect(REFERRAL_TIER_PAYOUT_USD[t]).toBeGreaterThan(0);
    }
  });

  it("pays out more for higher-tier referrals", () => {
    expect(REFERRAL_TIER_PAYOUT_USD.Cold).toBeLessThan(REFERRAL_TIER_PAYOUT_USD.Warm);
    expect(REFERRAL_TIER_PAYOUT_USD.Warm).toBeLessThan(REFERRAL_TIER_PAYOUT_USD.FullPitch);
  });
});
