import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isDomainLead } from "~/lib/roles";
import { action, validateReviewPatch } from "~/hiring/routes/api.reviews.$id";

const mockPrisma = prisma as unknown as {
  applicationReview: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  dALIMember: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

const USER_ID = "user-1";
const MEMBER_ID = "member-1";
const REVIEW_ID = "review-1";

function makeRequest(body: unknown) {
  return new Request(`http://localhost/api/reviews/${REVIEW_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).applicationReview = {
    findUnique: vi.fn().mockResolvedValue({
      id: REVIEW_ID,
      submittedAt: null,
      cycleReviewer: { userId: USER_ID },
    }),
    update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: REVIEW_ID, ...data })),
    delete: vi.fn(),
  };
  (mockPrisma as any).dALIMember = { findUnique: vi.fn().mockResolvedValue({ id: MEMBER_ID, userId: USER_ID }),
  };
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "user" },
  } as any);
  vi.mocked(isDomainLead).mockResolvedValue(false);
  vi.mocked(isCore).mockResolvedValue(false);
});

describe("validateReviewPatch", () => {
  it("rejects non-object bodies", () => {
    expect(validateReviewPatch(null)).toMatchObject({ ok: false });
    expect(validateReviewPatch("hello")).toMatchObject({ ok: false });
    expect(validateReviewPatch([])).toMatchObject({ ok: false });
  });

  it("accepts an empty object (no fields to update)", () => {
    expect(validateReviewPatch({})).toEqual({ ok: true, data: {} });
  });

  it("accepts a fully valid payload", () => {
    const result = validateReviewPatch({
      scores: { technical: 8, communication: 7.5 },
      feedback: "Great applicant",
      rejectionRationale: "",
      overallRecommendation: "Hire",
      annotations: [
        { id: "a1", fieldKey: "essay1", start: 0, end: 10, comment: "nice", color: "#ff0000" },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects scores that are not a plain object", () => {
    expect(validateReviewPatch({ scores: [1, 2] })).toMatchObject({ ok: false });
    expect(validateReviewPatch({ scores: "high" })).toMatchObject({ ok: false });
  });

  it("rejects non-numeric, NaN, or out-of-range score values", () => {
    expect(validateReviewPatch({ scores: { a: "10" } })).toMatchObject({ ok: false });
    expect(validateReviewPatch({ scores: { a: NaN } })).toMatchObject({ ok: false });
    expect(validateReviewPatch({ scores: { a: Infinity } })).toMatchObject({ ok: false });
    expect(validateReviewPatch({ scores: { a: -1 } })).toMatchObject({ ok: false });
    expect(validateReviewPatch({ scores: { a: 11 } })).toMatchObject({ ok: false });
  });

  it("rejects scores object with too many keys", () => {
    const scores: Record<string, number> = {};
    for (let i = 0; i < 51; i++) scores[`k${i}`] = 1;
    expect(validateReviewPatch({ scores })).toMatchObject({ ok: false });
  });

  it("rejects oversized feedback strings", () => {
    expect(validateReviewPatch({ feedback: "x".repeat(10_001) })).toMatchObject({ ok: false });
    expect(validateReviewPatch({ feedback: 123 })).toMatchObject({ ok: false });
  });

  it("rejects oversized rejectionRationale strings", () => {
    expect(validateReviewPatch({ rejectionRationale: "x".repeat(5_001) })).toMatchObject({ ok: false });
  });

  it("accepts null overallRecommendation and rejects unknown values", () => {
    expect(validateReviewPatch({ overallRecommendation: null })).toEqual({
      ok: true,
      data: { overallRecommendation: null },
    });
    expect(validateReviewPatch({ overallRecommendation: "Maybe" })).toMatchObject({ ok: false });
    expect(validateReviewPatch({ overallRecommendation: 5 })).toMatchObject({ ok: false });
  });

  it("rejects malformed annotation entries", () => {
    expect(validateReviewPatch({ annotations: "nope" })).toMatchObject({ ok: false });
    expect(validateReviewPatch({ annotations: [null] })).toMatchObject({ ok: false });
    expect(
      validateReviewPatch({
        annotations: [{ id: "a", fieldKey: "f", start: -1, end: 1, comment: "", color: "" }],
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateReviewPatch({
        annotations: [{ id: "", fieldKey: "f", start: 0, end: 1, comment: "", color: "" }],
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateReviewPatch({
        annotations: [{ id: "a", fieldKey: "f", start: 0, end: 1, comment: "x".repeat(2_001), color: "" }],
      }),
    ).toMatchObject({ ok: false });
  });

  it("rejects annotations arrays that exceed the cap", () => {
    const annotations = Array.from({ length: 501 }, (_, i) => ({
      id: `a${i}`,
      fieldKey: "f",
      start: 0,
      end: 1,
      comment: "",
      color: "",
    }));
    expect(validateReviewPatch({ annotations })).toMatchObject({ ok: false });
  });
});

describe("PATCH /api/hiring/reviews/:id", () => {
  it("returns 400 when body is not an object", async () => {
    const res = await action({ request: makeRequest("[]"), params: { id: REVIEW_ID }, context: {} } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.applicationReview.update).not.toHaveBeenCalled();
  });

  it("returns 400 when feedback exceeds the cap", async () => {
    const res = await action({
      request: makeRequest({ feedback: "x".repeat(10_001) }),
      params: { id: REVIEW_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.applicationReview.update).not.toHaveBeenCalled();
  });

  it("returns 400 when overallRecommendation is unknown", async () => {
    const res = await action({
      request: makeRequest({ overallRecommendation: "Maybe" }),
      params: { id: REVIEW_ID },
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.applicationReview.update).not.toHaveBeenCalled();
  });

  it("persists a valid payload", async () => {
    const res = await action({
      request: makeRequest({
        scores: { technical: 9 },
        feedback: "Solid",
        overallRecommendation: "Hire",
      }),
      params: { id: REVIEW_ID },
      context: {},
    } as any);
    expect(res.status).toBe(200);
    expect(mockPrisma.applicationReview.update).toHaveBeenCalledTimes(1);
    const call = mockPrisma.applicationReview.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: REVIEW_ID });
    expect(call.data).toEqual({
      scores: { technical: 9 },
      feedback: "Solid",
      overallRecommendation: "Hire",
    });
  });

  it("ignores unknown body keys (does not forward them to Prisma)", async () => {
    const res = await action({
      request: makeRequest({ feedback: "ok", evil: "<script>" } as any),
      params: { id: REVIEW_ID },
      context: {},
    } as any);
    expect(res.status).toBe(200);
    const call = mockPrisma.applicationReview.update.mock.calls[0][0];
    expect(call.data).toEqual({ feedback: "ok" });
  });

  it("returns 409 when the review is already submitted", async () => {
    mockPrisma.applicationReview.findUnique.mockResolvedValueOnce({
      id: REVIEW_ID,
      submittedAt: new Date(),
      cycleReviewer: { userId: USER_ID },
    });
    const res = await action({
      request: makeRequest({ feedback: "later edit" }),
      params: { id: REVIEW_ID },
      context: {},
    } as any);
    expect(res.status).toBe(409);
    expect(mockPrisma.applicationReview.update).not.toHaveBeenCalled();
  });
});
