import { describe, it, expect, vi } from "vitest";
import {
  applyAskEvent,
  askHistory,
  createAskThread,
  looksLikeQuestion,
  newTurn,
  parseSseBuffer,
  type AskTurn,
} from "../thread";
import type { AskEvent } from "../events";

const SOURCE = { kind: "document" as const, title: "Plan", url: "/documents/p1", ref: "s1", n: 1 };

function sse(events: AskEvent[], headers: Record<string, string> = { "X-Ask-Remaining": "12" }) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream", ...headers } });
}

function chunked(parts: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const p of parts) c.enqueue(encoder.encode(p));
        c.close();
      },
    }),
    { status: 200 },
  );
}

const done = (answer: string, sources = [SOURCE]): AskEvent => ({ type: "done", answer, sources });

describe("applyAskEvent", () => {
  const start = newTurn(1, "When is the launch?");

  it("adds a running step and finishes the ones before it", () => {
    const a = applyAskEvent(start, { type: "status", label: "Searching" });
    const b = applyAskEvent(a, { type: "status", label: "Reading a document" });
    expect(b.steps).toEqual([
      { label: "Searching", done: true },
      { label: "Reading a document", done: false },
    ]);
  });

  it("streams text and finishes the steps once the answer starts", () => {
    const a = applyAskEvent(applyAskEvent(start, { type: "status", label: "Searching" }), { type: "text", delta: "May" });
    const b = applyAskEvent(a, { type: "text", delta: " 4" });
    expect(b.text).toBe("May 4");
    expect(b.steps.every((s) => s.done)).toBe(true);
  });

  it("clears text written before a lookup", () => {
    expect(applyAskEvent({ ...start, text: "Let me check" }, { type: "retract" }).text).toBe("");
  });

  it("replaces streamed text with the checked answer and its sources", () => {
    const t = applyAskEvent({ ...start, text: "May 4 [s1]" }, done("May 4 [1]."));
    expect(t).toMatchObject({ text: "May 4 [1].", answer: "May 4 [1].", sources: [SOURCE], status: "done" });
  });

  it("marks an error with the server's message", () => {
    expect(applyAskEvent(start, { type: "error", message: "Something went wrong. Try again." })).toMatchObject({
      status: "error",
      error: "Something went wrong. Try again.",
    });
  });
});

describe("askHistory", () => {
  const turn = (id: number, status: AskTurn["status"], answer: string | null): AskTurn => ({
    ...newTurn(id, `q${id}`),
    status,
    answer,
  });

  it("sends answered turns only, as alternating question and answer", () => {
    expect(askHistory([turn(1, "done", "a1"), turn(2, "error", null), turn(3, "stopped", null), turn(4, "done", "a4")])).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q4" },
      { role: "assistant", content: "a4" },
    ]);
  });

  it("keeps the last six turns, which fits the server's twelve-entry cap", () => {
    const history = askHistory(Array.from({ length: 9 }, (_, i) => turn(i + 1, "done", `a${i + 1}`)));
    expect(history).toHaveLength(12);
    expect(history[0]).toEqual({ role: "user", content: "q4" });
  });
});

describe("parseSseBuffer", () => {
  it("returns complete events and keeps the unfinished tail", () => {
    const { events, rest } = parseSseBuffer('data: {"type":"retract"}\n\ndata: {"type":"text","de');
    expect(events).toEqual([{ type: "retract" }]);
    expect(rest).toBe('data: {"type":"text","de');
  });

  it("skips malformed and empty events", () => {
    expect(parseSseBuffer('data: nope\n\n: comment\n\ndata: {"type":"retract"}\n\n').events).toEqual([{ type: "retract" }]);
  });
});

describe("looksLikeQuestion", () => {
  it.each([
    "When is the Northwind launch?",
    "what did we decide about the launch date",
    "Who worked on mobile onboarding last term",
    "how do I book a room",
    "launch date?",
  ])("treats %p as a question", (q) => expect(looksLikeQuestion(q)).toBe(true));

  it.each(["Kickoff notes", "Northwind", "what", "is it", "Ada Lovelace", "  "])("treats %p as a search", (q) =>
    expect(looksLikeQuestion(q)).toBe(false),
  );
});

describe("createAskThread", () => {
  it("posts the question with earlier answers and streams the reply into a turn", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(sse([{ type: "status", label: "Searching" }, done("First [1].")]))
      .mockResolvedValueOnce(sse([done("Second.", [])], { "X-Ask-Remaining": "4" }));
    const thread = createAskThread({ fetch });
    await thread.ask("  When is the launch?  ");
    await thread.ask("And after that?");

    const body = (call: number) => JSON.parse(fetch.mock.calls[call][1].body);
    expect(fetch.mock.calls[0][0]).toBe("/api/ask");
    expect(body(0)).toEqual({ question: "When is the launch?", history: [] });
    expect(body(1)).toEqual({
      question: "And after that?",
      history: [
        { role: "user", content: "When is the launch?" },
        { role: "assistant", content: "First [1]." },
      ],
    });
    const { turns, remaining } = thread.getState();
    expect(turns.map((t) => [t.question, t.status, t.answer])).toEqual([
      ["When is the launch?", "done", "First [1]."],
      ["And after that?", "done", "Second."],
    ]);
    expect(turns[0].steps).toEqual([{ label: "Searching", done: true }]);
    expect(remaining).toBe(4);
  });

  it("reassembles events split across network chunks", async () => {
    const fetch = vi.fn().mockResolvedValue(chunked(['data: {"type":"te', 'xt","delta":"Hi"}\n\ndata: {"type":"done","answer":"Hi","sources":[]}\n\n']));
    const thread = createAskThread({ fetch });
    await thread.ask("q?");
    expect(thread.getState().turns[0]).toMatchObject({ status: "done", answer: "Hi" });
  });

  it("ignores a blank question and a second question while one is running", async () => {
    let release!: (r: Response) => void;
    const fetch = vi.fn().mockReturnValue(new Promise<Response>((r) => (release = r)));
    const thread = createAskThread({ fetch });
    await thread.ask("   ");
    const first = thread.ask("first?");
    await thread.ask("second?");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(thread.busy).toBe(true);
    release(sse([done("ok", [])]));
    await first;
    expect(thread.busy).toBe(false);
  });

  it("records the daily limit with the reset time and no questions left", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({ error: "You've used today's questions." }, { status: 429, headers: { "Retry-After": "3600" } }),
    );
    const thread = createAskThread({ fetch, now: () => 1_000_000 });
    await thread.ask("q?");
    expect(thread.getState().turns[0]).toMatchObject({ status: "limited", retryAt: 1_000_000 + 3_600_000 });
    expect(thread.getState().remaining).toBe(0);
  });

  it("treats a burst limit as a retryable error, not the daily limit", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({ error: "You're asking too quickly. Try again in 20s." }, { status: 429, headers: { "Retry-After": "20" } }),
    );
    const thread = createAskThread({ fetch });
    await thread.ask("q?");
    expect(thread.getState().turns[0]).toMatchObject({
      status: "error",
      error: "You're asking too quickly. Try again in 20s.",
      retryAt: null,
    });
    expect(thread.getState().remaining).toBeNull();
  });

  it.each([
    ["a refusal with a message", () => Response.json({ error: "Not available" }, { status: 403 }), "Not available"],
    ["a failure without one", () => new Response("oops", { status: 502 }), "Something went wrong."],
    ["a stream that ends without an answer", () => sse([{ type: "status", label: "Searching" }]), "Something went wrong."],
    ["a network failure", () => Promise.reject(new TypeError("offline")), "Something went wrong."],
  ])("shows %s as an error", async (_label, response, error) => {
    const thread = createAskThread({ fetch: vi.fn().mockImplementation(response) });
    await thread.ask("q?");
    expect(thread.getState().turns[0]).toMatchObject({ status: "error", error });
  });

  it("stops a running turn", async () => {
    const fetch = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    const thread = createAskThread({ fetch: fetch as unknown as typeof globalThis.fetch });
    const running = thread.ask("q?");
    thread.stop();
    await running;
    expect(thread.getState().turns[0].status).toBe("stopped");
    expect(thread.busy).toBe(false);
  });

  it("retries a failed turn in place", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("x", { status: 500 }))
      .mockResolvedValueOnce(sse([done("Now it works.", [])]));
    const thread = createAskThread({ fetch });
    await thread.ask("q?");
    const failed = thread.getState().turns[0];
    await thread.retry(failed.id);
    const { turns } = thread.getState();
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ question: "q?", status: "done", answer: "Now it works." });
  });

  it("starts over, keeping what it knows about questions left", async () => {
    const thread = createAskThread({ fetch: vi.fn().mockResolvedValue(sse([done("ok", [])], { "X-Ask-Remaining": "3" })) });
    const seen = vi.fn();
    thread.subscribe(seen);
    await thread.ask("q?");
    thread.reset();
    expect(thread.getState()).toEqual({ turns: [], remaining: 3 });
    expect(seen).toHaveBeenCalled();
  });
});
