import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  redirectNonMemberToPortal: vi.fn().mockResolvedValue(null),
  isNonMember: vi.fn().mockResolvedValue(false),
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/partners/lib/referrals.server", () => ({
  hasPassedReferralQuiz: vi.fn(),
  recordReferralQuizPass: vi.fn(),
  requireReferralsEnabled: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import {
  hasPassedReferralQuiz,
  recordReferralQuizPass,
  requireReferralsEnabled,
} from "~/partners/lib/referrals.server";
import { action } from "~/partners/routes/refer";
import { REFERRAL_QUIZ } from "~/partners/lib/referral-quiz";

function post(body: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(body)) form.set(k, v);
  const request = new Request("http://localhost/refer", {
    method: "POST",
    body: form,
  });
  return action({ request, params: {}, context: {} } as any);
}

function allCorrectAnswers(): Record<string, string> {
  const out: Record<string, string> = { intent: "submit-quiz" };
  for (const q of REFERRAL_QUIZ) out[`q:${q.id}`] = q.correctChoiceId;
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as any).mockResolvedValue({
    ok: true,
    user: { sub: "u1" },
    sessionId: "s1",
  });
  (hasPassedReferralQuiz as any).mockResolvedValue(false);
  (requireReferralsEnabled as any).mockResolvedValue(undefined);
});

describe("refer action — quiz submission", () => {
  it("404s without recording a pass when the refer-a-partner flag is off", async () => {
    (requireReferralsEnabled as any).mockRejectedValue(new Response("Not found", { status: 404 }));
    await expect(post(allCorrectAnswers())).rejects.toMatchObject({ status: 404 });
    expect(requireReferralsEnabled).toHaveBeenCalledWith("u1", expect.any(Request));
    expect(recordReferralQuizPass).not.toHaveBeenCalled();
  });

  it("records a pass and redirects to /refer when every answer is right", async () => {
    const res = (await post(allCorrectAnswers())) as Response;
    expect(recordReferralQuizPass).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1" }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/refer");
  });

  it("returns the wrong question ids without recording a pass when the quiz fails", async () => {
    const answers = allCorrectAnswers();
    const first = REFERRAL_QUIZ[0];
    answers[`q:${first.id}`] = first.choices.find(
      (c) => c.id !== first.correctChoiceId,
    )!.id;

    const result = await post(answers);
    expect(recordReferralQuizPass).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        wrong: [first.id],
      }),
    );
  });

  it("rejects an unknown intent", async () => {
    const result = await post({ intent: "something-else" });
    expect(recordReferralQuizPass).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });

  it("increments attempts across retries so recordReferralQuizPass can bank the real count", async () => {
    const answers = allCorrectAnswers();
    answers.attempts = "3";
    await post(answers);
    expect(recordReferralQuizPass).toHaveBeenCalledWith(
      expect.objectContaining({ attempts: 3 }),
    );
  });
});
