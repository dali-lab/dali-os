import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THROTTLE_MS,
  loadEmailUnread,
  navigatedFromEmail,
  resetEmailUnreadCache,
} from "../use-email-unread";

const ok = (total: number) => new Response(JSON.stringify({ total }));

describe("loadEmailUnread", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetEmailUnreadCache();
    fetchMock = vi.fn(async () => ok(3));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetches once, then serves the last total inside the throttle window", async () => {
    expect(await loadEmailUnread({})).toBe(3);
    fetchMock.mockImplementation(async () => ok(9));
    vi.advanceTimersByTime(THROTTLE_MS - 1);
    expect(await loadEmailUnread({})).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches again after the window", async () => {
    await loadEmailUnread({});
    fetchMock.mockImplementation(async () => ok(9));
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(await loadEmailUnread({})).toBe(9);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("force bypasses the throttle", async () => {
    await loadEmailUnread({});
    fetchMock.mockImplementation(async () => ok(0));
    expect(await loadEmailUnread({ force: true })).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("an aborted fetch keeps the last total and does not start the window", async () => {
    await loadEmailUnread({});
    vi.advanceTimersByTime(THROTTLE_MS);
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => {
      controller.abort();
      return ok(0);
    });
    expect(await loadEmailUnread({ signal: controller.signal })).toBe(3);
    fetchMock.mockImplementation(async () => ok(7));
    expect(await loadEmailUnread({})).toBe(7);
  });

  it("a failed request keeps the last total and retries next call", async () => {
    await loadEmailUnread({});
    vi.advanceTimersByTime(THROTTLE_MS);
    fetchMock.mockImplementation(async () => {
      throw new Error("offline");
    });
    expect(await loadEmailUnread({})).toBe(3);
    fetchMock.mockImplementation(async () => ok(4));
    expect(await loadEmailUnread({})).toBe(4);
  });

  it("a non-ok response does not zero the count", async () => {
    await loadEmailUnread({});
    vi.advanceTimersByTime(THROTTLE_MS);
    fetchMock.mockImplementation(async () => new Response("no", { status: 500 }));
    expect(await loadEmailUnread({})).toBe(3);
  });
});

describe("navigatedFromEmail", () => {
  it.each([
    [null, "/email", false],
    ["/home", "/email", false],
    ["/email", "/home", true],
    ["/email/thread/1", "/email", true],
    ["/email", "/email", false],
  ])("%s -> %s is %s", (prev, next, expected) => {
    expect(navigatedFromEmail(prev, next)).toBe(expected);
  });
});
