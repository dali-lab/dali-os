// HMAC auth and dispatch for POST /api/meeting-recordings/:id/result.

import { describe, it, expect, beforeEach, vi, afterAll } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/meeting-recording.server", () => ({ applyResult: vi.fn() }));

import { prisma } from "~/lib/db";
import { applyResult } from "~/lib/meeting-recording.server";
import { signHmac } from "~/lib/transcription/hmac";
import { action } from "~/routes/api.meeting-recordings.$id.result";

const SECRET = "test-callback-secret";

function callback(bodyObj: unknown, opts: { timestamp?: string; signature?: string } = {}): Request {
  const rawBody = JSON.stringify(bodyObj);
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = opts.signature ?? signHmac(SECRET, timestamp, rawBody);
  return new Request("http://localhost/api/meeting-recordings/r1/result", {
    method: "POST",
    headers: { "X-Dali-Timestamp": timestamp, "X-Dali-Signature": signature },
    body: rawBody,
  });
}

const run = (req: Request) =>
  action({ request: req, params: { id: "r1" }, context: {} } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DIARIZE_SECRET", SECRET);
  vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue({ id: "r1", status: "Processing" } as never);
});

afterAll(() => vi.unstubAllEnvs());

describe("POST /api/meeting-recordings/:id/result", () => {
  it("applies a correctly signed callback", async () => {
    const res = await run(callback({ recordingId: "r1", channels: {}, error: null }));
    expect(res.status).toBe(200);
    expect(applyResult).toHaveBeenCalledWith(
      { id: "r1", status: "Processing" },
      { channels: {}, error: null },
    );
  });

  it("rejects a bad signature", async () => {
    const res = await run(callback({ recordingId: "r1", channels: {}, error: null }, { signature: "sha256=bad" }));
    expect(res.status).toBe(401);
    expect(applyResult).not.toHaveBeenCalled();
  });

  it("rejects a recordingId that doesn't match the route param", async () => {
    const res = await run(callback({ recordingId: "other", channels: {}, error: null }));
    expect(res.status).toBe(400);
    expect(applyResult).not.toHaveBeenCalled();
  });

  it("503s when no DIARIZE_SECRET is configured", async () => {
    vi.stubEnv("DIARIZE_SECRET", "");
    const res = await run(callback({ recordingId: "r1", channels: {}, error: null }));
    expect(res.status).toBe(503);
  });

  it("404s an unknown recording", async () => {
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(null);
    const res = await run(callback({ recordingId: "r1", channels: {}, error: null }));
    expect(res.status).toBe(404);
  });

  it("is idempotent on repeat delivery of the same callback", async () => {
    const req1 = callback({ recordingId: "r1", channels: {}, error: null });
    await run(req1);
    const req2 = callback({ recordingId: "r1", channels: {}, error: null });
    const res2 = await run(req2);
    expect(res2.status).toBe(200);
    expect(applyResult).toHaveBeenCalledTimes(2); // route dispatches each time; applyResult itself no-ops once Done
  });
});
