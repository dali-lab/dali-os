// Validation and auth for POST /api/meeting-recordings/:id/chunks.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/meeting-recording.server", () => ({ ownRecording: vi.fn(), recordChunk: vi.fn() }));
vi.mock("~/lib/transcription/chunks.server", () => ({ putChunk: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { ownRecording, recordChunk } from "~/lib/meeting-recording.server";
import { putChunk } from "~/lib/transcription/chunks.server";
import { action } from "~/routes/api.meeting-recordings.$id.chunks";

const REC = {
  id: "r1",
  userId: "u1",
  status: "Recording",
  finalizedAt: null as Date | null,
};

function post(opts: {
  query?: string;
  contentLength?: number;
  contentType?: string;
  bodyBytes?: number;
} = {}): Request {
  const { query = "channel=mic&segment=0&seq=1", contentType = "audio/pcm;rate=16000;channels=1" } = opts;
  const bodyBytes = opts.bodyBytes ?? 1000;
  const contentLength = opts.contentLength ?? bodyBytes;
  const body = new Uint8Array(bodyBytes);
  return new Request(`http://localhost/api/meeting-recordings/r1/chunks?${query}`, {
    method: "POST",
    headers: { "Content-Type": contentType, "Content-Length": String(contentLength) },
    body,
  });
}

const run = (req: Request) =>
  action({ request: req, params: { id: "r1" }, context: {} } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "u1", email: "u@dali.edu", type: "member" },
    sessionId: "s1",
  } as never);
  vi.mocked(ownRecording).mockResolvedValue(REC as never);
  vi.mocked(recordChunk).mockResolvedValue({ stopRequested: false });
  vi.mocked(putChunk).mockResolvedValue(undefined);
});

describe("POST /api/meeting-recordings/:id/chunks", () => {
  it("stores the chunk and reports stopRequested", async () => {
    const res = await run(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stopRequested: false, behindSeconds: 0, lines: [] });
    expect(putChunk).toHaveBeenCalledWith("r1", "mic", 0, 1, expect.any(Buffer));
    expect(recordChunk).toHaveBeenCalledWith(REC, "mic", 0, 1);
  });

  it("rejects before reading the body when Content-Length is over the cap", async () => {
    const res = await run(post({ contentLength: 800_000 }));
    expect(res.status).toBe(413);
    expect(ownRecording).not.toHaveBeenCalled();
    expect(putChunk).not.toHaveBeenCalled();
  });

  it("rejects a non-audio/pcm content type", async () => {
    const res = await run(post({ contentType: "audio/webm" }));
    expect(res.status).toBe(415);
    expect(putChunk).not.toHaveBeenCalled();
  });

  it("rejects seq past the per-segment bound", async () => {
    const res = await run(post({ query: "channel=mic&segment=0&seq=721" }));
    expect(res.status).toBe(400);
  });

  it("rejects segment past the per-recording bound", async () => {
    const res = await run(post({ query: "channel=mic&segment=21&seq=0" }));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown channel", async () => {
    const res = await run(post({ query: "channel=speaker&segment=0&seq=0" }));
    expect(res.status).toBe(400);
  });

  it("404s a chunk for someone else's recording", async () => {
    vi.mocked(ownRecording).mockResolvedValue(null);
    const res = await run(post());
    expect(res.status).toBe(404);
  });

  it.each(["Processing", "Done", "Failed"])("409s once the recording is %s", async (status) => {
    vi.mocked(ownRecording).mockResolvedValue({ ...REC, status } as never);
    const res = await run(post());
    expect(res.status).toBe(409);
    expect(putChunk).not.toHaveBeenCalled();
  });

  it("409s a finalized recording regardless of status", async () => {
    vi.mocked(ownRecording).mockResolvedValue({ ...REC, finalizedAt: new Date() } as never);
    const res = await run(post());
    expect(res.status).toBe(409);
  });

  it("still allows a chunk while Stopped (final confirmation in flight)", async () => {
    vi.mocked(ownRecording).mockResolvedValue({ ...REC, status: "Stopped" } as never);
    const res = await run(post());
    expect(res.status).toBe(200);
  });
});
