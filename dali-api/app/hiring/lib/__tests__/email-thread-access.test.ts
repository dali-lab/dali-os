import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    application: { findUnique: vi.fn() },
    mailMessageIndex: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ hasCycleAccess: vi.fn() }));
vi.mock("~/hiring/lib/confidentiality", () => ({ requirePageSignedOrRedirect: vi.fn() }));
vi.mock("~/hiring/lib/anonymization.server", () => ({
  reviewerBlindLabel: vi.fn(),
  applicationBlindLabel: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { hasCycleAccess } from "~/lib/roles";
import { requirePageSignedOrRedirect } from "~/hiring/lib/confidentiality";
import { applicationBlindLabel, reviewerBlindLabel } from "~/hiring/lib/anonymization.server";
import { canViewApplicantThread } from "~/hiring/lib/email-thread-access.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const request = new Request("http://localhost/");

const APPLICATION = {
  id: "app-1",
  userId: "applicant-1",
  applicationCycleId: "cycle-1",
  applicationCycle: { anonymizeReview: true },
};
const INDEX = {
  accountId: "account-1",
  threadId: "thread-1",
  linkedUserId: "applicant-1",
  account: { address: "applications@dali.dartmouth.edu" },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.application.findUnique.mockResolvedValue(APPLICATION);
  db.mailMessageIndex.findUnique.mockResolvedValue(INDEX);
  vi.mocked(hasCycleAccess).mockResolvedValue(true);
  vi.mocked(requirePageSignedOrRedirect).mockResolvedValue(null as never);
  // Unblinded by default — most tests override one or both to test gating.
  vi.mocked(reviewerBlindLabel).mockResolvedValue(null);
  vi.mocked(applicationBlindLabel).mockResolvedValue(null);
});

function call(args: Partial<{ viewerId: string; applicationId: string; indexId: string }> = {}) {
  return canViewApplicantThread({
    viewerId: args.viewerId ?? "viewer-1",
    applicationId: args.applicationId ?? "app-1",
    indexId: args.indexId ?? "index-1",
    request,
  });
}

describe("canViewApplicantThread", () => {
  it("404s when the application doesn't exist", async () => {
    db.application.findUnique.mockResolvedValue(null);
    expect(await call()).toEqual({ ok: false, status: 404 });
  });

  it("404s when the index row doesn't exist", async () => {
    db.mailMessageIndex.findUnique.mockResolvedValue(null);
    expect(await call()).toEqual({ ok: false, status: 404 });
  });

  it("403s when the thread is linked to a different applicant", async () => {
    db.mailMessageIndex.findUnique.mockResolvedValue({ ...INDEX, linkedUserId: "someone-else" });
    expect(await call()).toEqual({ ok: false, status: 403 });
  });

  it("403s without cycle access", async () => {
    vi.mocked(hasCycleAccess).mockResolvedValue(false);
    expect(await call()).toEqual({ ok: false, status: 403 });
  });

  it("403s when the confidentiality agreement isn't signed", async () => {
    vi.mocked(requirePageSignedOrRedirect).mockResolvedValue(new Response(null, { status: 302 }) as never);
    expect(await call()).toEqual({ ok: false, status: 403 });
  });

  it("403s a blinded reviewer (blinded on both the reviewer and application predicates)", async () => {
    vi.mocked(reviewerBlindLabel).mockResolvedValue("Applicant 1");
    vi.mocked(applicationBlindLabel).mockResolvedValue("Applicant 1");
    expect(await call()).toEqual({ ok: false, status: 403 });
  });

  it("403s Core on a blinded cycle with no released decision", async () => {
    // Core has no CycleReviewer assignment, so reviewerBlindLabel reads as
    // blinded too (daIds.length === 0) — same as a plain reviewer here.
    vi.mocked(reviewerBlindLabel).mockResolvedValue("Applicant 1");
    vi.mocked(applicationBlindLabel).mockResolvedValue("Applicant 1");
    expect(await call()).toEqual({ ok: false, status: 403 });
  });

  it("is ok for Core once the application's decision is released", async () => {
    vi.mocked(reviewerBlindLabel).mockResolvedValue("Applicant 1");
    vi.mocked(applicationBlindLabel).mockResolvedValue(null);
    expect(await call()).toEqual({
      ok: true,
      accountId: "account-1",
      threadId: "thread-1",
      address: "applications@dali.dartmouth.edu",
    });
  });

  it("is ok when unblinded via the reviewer-specific predicate alone", async () => {
    vi.mocked(reviewerBlindLabel).mockResolvedValue(null);
    vi.mocked(applicationBlindLabel).mockResolvedValue("Applicant 1");
    const result = await call();
    expect(result.ok).toBe(true);
  });
});
