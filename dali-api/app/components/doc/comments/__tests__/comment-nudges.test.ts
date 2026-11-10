import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeCommentNudges } from "../comment-nudges";

class FakeEventSource {
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, () => void>();
  close = vi.fn();
  readyState = 1;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, cb: () => void) {
    this.listeners.set(name, cb);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("subscribeCommentNudges", () => {
  it("shares one stream per page between listeners and closes it with the last one", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeCommentNudges("p1", a);
    const offB = subscribeCommentNudges("p1", b);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/comments/p1/stream");
    FakeEventSource.instances[0].listeners.get("change")!();
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1]);
    offA();
    expect(FakeEventSource.instances[0].close).not.toHaveBeenCalled();
    offB();
    expect(FakeEventSource.instances[0].close).toHaveBeenCalled();
  });

  it("opens a separate stream for another page", () => {
    const off1 = subscribeCommentNudges("p1", vi.fn());
    const off2 = subscribeCommentNudges("p2", vi.fn());
    expect(FakeEventSource.instances.map((i) => i.url)).toEqual(["/api/comments/p1/stream", "/api/comments/p2/stream"]);
    off1();
    off2();
  });

  it("reopens a stream that closed for good while someone is listening", () => {
    const off = subscribeCommentNudges("p3", vi.fn());
    const first = FakeEventSource.instances[0];
    first.readyState = FakeEventSource.CLOSED;
    first.onerror!();
    vi.advanceTimersByTime(5000);
    expect(FakeEventSource.instances).toHaveLength(2);
    off();
  });
});
