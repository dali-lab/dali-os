import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { changeReviewSubmission } from "../review-submission";

let fetchMock: ReturnType<typeof vi.fn>;
const reload = vi.fn();

function setup() {
  return { flushSave: vi.fn().mockResolvedValue(undefined), revalidate: vi.fn(), onError: vi.fn() };
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { reload });
});
afterEach(() => {
  vi.unstubAllGlobals();
  reload.mockClear();
});

describe("changeReviewSubmission", () => {
  it("flushes the pending save, posts to /submit and revalidates without reloading", async () => {
    const s = setup();
    await changeReviewSubmission({ reviewId: "r1", action: "submit", ...s });
    expect(s.flushSave).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/hiring/reviews/r1/submit", expect.objectContaining({ method: "POST" }));
    expect(s.flushSave.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
    expect(s.revalidate).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("posts to /unsubmit without flushing", async () => {
    const s = setup();
    await changeReviewSubmission({ reviewId: "r1", action: "unsubmit", ...s });
    expect(s.flushSave).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/hiring/reviews/r1/unsubmit", expect.anything());
    expect(s.revalidate).toHaveBeenCalledTimes(1);
  });

  it("shows the server error and does not revalidate on a 4xx", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Score every criterion first" }) });
    const s = setup();
    await changeReviewSubmission({ reviewId: "r1", action: "submit", ...s });
    expect(s.onError).toHaveBeenCalledWith("Score every criterion first");
    expect(s.revalidate).not.toHaveBeenCalled();
  });

  it("falls back to a plain message when the body is not JSON", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => { throw new Error("x"); } });
    const s = setup();
    await changeReviewSubmission({ reviewId: "r1", action: "unsubmit", ...s });
    expect(s.onError).toHaveBeenCalledWith("Could not unsubmit the review");
  });
});
