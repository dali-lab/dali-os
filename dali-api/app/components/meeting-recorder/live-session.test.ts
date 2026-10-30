// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./worklet-processor.js?url", () => ({ default: "worklet.js" }));

type FrameHandler = (buffer: ArrayBuffer, seq: number) => void;
const captureInstances = vi.hoisted(() => [] as Array<{ stopped: boolean; flushed: boolean; onFrame: FrameHandler | null }>);
vi.mock("./capture", () => ({
  WorkletCapture: class {
    state = { stopped: false, flushed: false, onFrame: null as FrameHandler | null };
    constructor() {
      captureInstances.push(this.state);
    }
    start = vi.fn(async (_stream: unknown, _url: string, onFrame: FrameHandler) => {
      this.state.onFrame = onFrame;
    });
    flush = vi.fn(async () => {
      this.state.flushed = true;
    });
    stop = vi.fn(() => {
      this.state.stopped = true;
    });
  },
}));

import {
  POLL_MS,
  adoptDesktopSession,
  clearLiveSession,
  getLiveSession,
  liveSessionBlocker,
  refreshLiveSession,
  resetLiveSession,
  startBrowserSession,
  stopLiveSession,
} from "./live-session";

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeStream() {
  const handlers: Record<string, () => void> = {};
  const track = { addEventListener: (ev: string, cb: () => void) => void (handlers[ev] = cb), stop: vi.fn() };
  return {
    stream: { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream,
    track,
    end: () => handlers.ended?.(),
  };
}

type Call = { url: string; method: string; body: unknown; keepalive?: boolean };
let calls: Call[];
let respond: (url: string, init?: RequestInit) => Response | Promise<Response>;

const posts = (suffix = "") => calls.filter((c) => c.method === "POST" && c.url.endsWith(suffix || "r1"));
const idle = () => ({ recording: null });

async function start(over: Partial<Parameters<typeof startBrowserSession>[0]> = {}) {
  const mic = fakeStream();
  await startBrowserSession({ recordingId: "r1", documentName: "doc:a:body", micStream: mic.stream, segment: 0, ...over });
  await refreshLiveSession();
  return mic;
}

beforeEach(() => {
  calls = [];
  respond = (url) => (url.endsWith("/active") ? jsonRes(idle()) : jsonRes({ stopRequested: false, behindSeconds: 0, lines: [] }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined,
        keepalive: init?.keepalive,
      });
      return respond(url, init);
    }),
  );
  captureInstances.length = 0;
});

afterEach(() => {
  resetLiveSession();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("starting a browser session", () => {
  it("is recording once the mic is armed, with the mic channel active", async () => {
    await start();
    expect(getLiveSession()).toMatchObject({
      recordingId: "r1",
      documentName: "doc:a:body",
      captureMode: "browser",
      status: "recording",
      channelsActive: ["mic"],
      conflicted: false,
    });
  });

  it("arms the call channel too when a call stream is given", async () => {
    await start({ callStream: fakeStream().stream });
    expect(getLiveSession()?.channelsActive).toEqual(["mic", "call"]);
  });

  it("uploads each frame to the chunk route on the current segment", async () => {
    await start({ segment: 2 });
    captureInstances[0]!.onFrame!(new ArrayBuffer(4), 7);
    await vi.waitFor(() => expect(calls.some((c) => c.url.includes("/r1/chunks?channel=mic&segment=2&seq=7"))).toBe(true));
  });
});

describe("stopping", () => {
  it("drains the upload queue before posting finish with the session length", async () => {
    const t0 = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(t0);
    await start();
    let release: (r: Response) => void = () => {};
    respond = (url) =>
      url.includes("/chunks") ? new Promise<Response>((r) => (release = r)) : jsonRes({ ok: true });
    captureInstances[0]!.onFrame!(new ArrayBuffer(4), 0);

    vi.spyOn(Date, "now").mockReturnValue(t0 + 95_000);
    const stopping = stopLiveSession();
    await vi.waitFor(() => expect(getLiveSession()?.status).toBe("stopping"));
    expect(captureInstances[0]!.flushed).toBe(true);
    expect(posts()).toEqual([]);

    release(jsonRes({ stopRequested: false, behindSeconds: 0, lines: [] }));
    await stopping;

    expect(posts().map((c) => c.body)).toEqual([{ action: "finish", seconds: 95 }]);
    expect(getLiveSession()).toMatchObject({ status: "stopped", stoppedSeconds: 95, channelsActive: [] });
    expect(captureInstances[0]!.stopped).toBe(true);
  });

  it("stops when a chunk response says another device asked it to", async () => {
    await start();
    respond = (url) =>
      jsonRes(url.includes("/chunks") ? { stopRequested: true, behindSeconds: 0, lines: [] } : { ok: true });
    captureInstances[0]!.onFrame!(new ArrayBuffer(4), 0);
    await vi.waitFor(() => expect(getLiveSession()?.status).toBe("stopped"));
    expect(posts().map((c) => (c.body as { action: string }).action)).toEqual(["finish"]);
  });

  it("does nothing a second time", async () => {
    await start();
    await stopLiveSession();
    await stopLiveSession();
    expect(posts()).toHaveLength(1);
  });

  it("stops when the mic track ends", async () => {
    const mic = await start();
    mic.end();
    await vi.waitFor(() => expect(getLiveSession()?.status).toBe("stopped"));
  });

  it("keeps recording the mic when the call track ends, and says so", async () => {
    const onCallAudioEnded = vi.fn();
    const call = fakeStream();
    await start({ callStream: call.stream, onCallAudioEnded });
    call.end();
    expect(getLiveSession()).toMatchObject({ status: "recording", channelsActive: ["mic"] });
    expect(captureInstances[1]!.stopped).toBe(true);
    expect(captureInstances[0]!.stopped).toBe(false);
    expect(onCallAudioEnded).toHaveBeenCalledTimes(1);
  });

  it("marks a 409 as conflicted, tears capture down and posts no finish", async () => {
    await start();
    respond = () => jsonRes({ error: "conflict" }, 409);
    captureInstances[0]!.onFrame!(new ArrayBuffer(4), 0);
    await vi.waitFor(() => expect(getLiveSession()?.conflicted).toBe(true));
    expect(getLiveSession()?.status).toBe("stopped");
    expect(captureInstances[0]!.stopped).toBe(true);
    expect(posts()).toEqual([]);
  });

  it("asks the server to stop a desktop session and leaves the rest to the poll", async () => {
    adoptDesktopSession({ recordingId: "r1", documentName: "doc:a:body", status: "recording", startedAt: 1 });
    await stopLiveSession();
    expect(getLiveSession()?.status).toBe("stopping");
    expect(posts().map((c) => c.body)).toEqual([{ action: "stop" }]);
  });
});

describe("guards", () => {
  it("blocks a second live recording on another note, pointing at the first", async () => {
    await start();
    expect(liveSessionBlocker("doc:b:body")).toMatchObject({ message: expect.stringMatching(/^Stop the recording in .+ first\.$/) });
  });

  it("does not block the same note, a stopped session, or no session", async () => {
    expect(liveSessionBlocker("doc:b:body")).toBeNull();
    await start();
    expect(liveSessionBlocker("doc:a:body")).toBeNull();
    await stopLiveSession();
    expect(liveSessionBlocker("doc:b:body")).toBeNull();
  });

  it("prevents unloading while browser capture is live, and not after", async () => {
    const prevented = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(prevented()).toBe(false);
    await start();
    expect(prevented()).toBe(true);
    await stopLiveSession();
    expect(prevented()).toBe(false);
  });

  it("does not prevent unloading for a desktop recording", () => {
    adoptDesktopSession({ recordingId: "r1", documentName: "doc:a:body", status: "recording", startedAt: 1 });
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it("finishes the recording with a keepalive request when the page is hidden", async () => {
    const t0 = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(t0);
    await start();
    vi.spyOn(Date, "now").mockReturnValue(t0 + 30_000);
    window.dispatchEvent(new Event("pagehide"));
    const finish = posts()[0]!;
    expect(finish.keepalive).toBe(true);
    expect(finish.body).toEqual({ action: "finish", seconds: 30 });
  });

  it("sends nothing on pagehide once the session has stopped", async () => {
    await start();
    await stopLiveSession();
    calls.length = 0;
    window.dispatchEvent(new Event("pagehide"));
    expect(calls).toEqual([]);
  });
});

describe("clearing", () => {
  it("clears only the matching recording", async () => {
    await start();
    clearLiveSession("other");
    expect(getLiveSession()).not.toBeNull();
    clearLiveSession("r1");
    expect(getLiveSession()).toBeNull();
    expect(captureInstances[0]!.stopped).toBe(true);
  });
});

describe("polling the server", () => {
  const activeCalls = () => calls.filter((c) => c.url === "/api/meeting-recordings/active");

  it("does not poll while there is no session", async () => {
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(activeCalls()).toEqual([]);
  });

  it("polls every interval while a session exists and stops once it is gone", async () => {
    vi.useFakeTimers();
    respond = () =>
      jsonRes({ recording: { id: "r1", documentName: "doc:a:body", status: "Recording", title: "Sync", href: "/documents/a", sessionSeconds: 5 } });
    adoptDesktopSession({ recordingId: "r1", documentName: "doc:a:body", status: "recording", startedAt: 1 });
    await vi.advanceTimersByTimeAsync(0);
    const afterAdopt = activeCalls().length;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(activeCalls().length).toBe(afterAdopt + 2);

    clearLiveSession("r1");
    const afterClear = activeCalls().length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(activeCalls().length).toBe(afterClear);
  });
});

describe("reconciling with the server", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    recording: { id: "r9", documentName: "doc:z:body", status: "Recording", title: "Z", href: "/documents/z", sessionSeconds: 12, ...over },
  });

  it("adopts the user's live recording from another device as a tracked session", async () => {
    respond = () => jsonRes(row());
    await refreshLiveSession();
    expect(getLiveSession()).toMatchObject({
      recordingId: "r9",
      captureMode: "desktop",
      status: "recording",
      title: "Z",
      href: "/documents/z",
    });
  });

  it("maps Pending to starting and Stopped to stopped", async () => {
    respond = () => jsonRes(row({ status: "Pending", sessionSeconds: null }));
    await refreshLiveSession();
    expect(getLiveSession()?.status).toBe("starting");
    respond = () => jsonRes(row({ status: "Stopped", sessionSeconds: null }));
    await refreshLiveSession();
    expect(getLiveSession()?.status).toBe("stopped");
  });

  it("drops a tracked session once the server no longer has it", async () => {
    respond = () => jsonRes(row());
    await refreshLiveSession();
    respond = () => jsonRes({ recording: null });
    await refreshLiveSession();
    expect(getLiveSession()).toBeNull();
  });

  it("never lets the server overwrite or drop a live browser capture", async () => {
    await start();
    respond = () => jsonRes({ recording: null });
    await refreshLiveSession();
    expect(getLiveSession()?.status).toBe("recording");
    respond = () => jsonRes(row({ status: "Stopped" }));
    await refreshLiveSession();
    expect(getLiveSession()).toMatchObject({ recordingId: "r1", status: "recording" });
  });

  it("fills in the title and link of a browser capture from the server", async () => {
    await start();
    respond = () => jsonRes(row({ id: "r1", title: "Weekly", href: "/documents/a" }));
    await refreshLiveSession();
    expect(getLiveSession()).toMatchObject({ title: "Weekly", href: "/documents/a", status: "recording" });
  });

  it("keeps a desktop session in stopping until the server reports Stopped", async () => {
    respond = () => jsonRes(row());
    adoptDesktopSession({ recordingId: "r9", documentName: "doc:z:body", status: "recording", startedAt: 1 });
    await stopLiveSession();
    respond = () => jsonRes(row());
    await refreshLiveSession();
    expect(getLiveSession()?.status).toBe("stopping");
    respond = () => jsonRes(row({ status: "Stopped", sessionSeconds: null }));
    await refreshLiveSession();
    expect(getLiveSession()?.status).toBe("stopped");
  });

  it("ignores a failed request", async () => {
    respond = () => jsonRes(row());
    adoptDesktopSession({ recordingId: "r9", documentName: "doc:z:body", status: "recording", startedAt: 1 });
    respond = () => jsonRes({ error: "boom" }, 500);
    await refreshLiveSession();
    expect(getLiveSession()?.recordingId).toBe("r9");
  });
});
