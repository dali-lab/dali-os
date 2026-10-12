import { describe, it, expect } from "vitest";
import { mergeFeed, parseFeedCursor, pushedOff } from "~/email/lib/feed";
import type { FeedThread } from "~/email/lib/email.server";

const thread = (accountId: string, id: string, day: number, unread = false): FeedThread => ({
  accountId,
  id,
  subject: id,
  from: "",
  to: "",
  snippet: "",
  date: new Date(Date.UTC(2026, 0, day)).toISOString(),
  unread,
  messageCount: 1,
});

const ids = (threads: FeedThread[]) => threads.map((t) => `${t.accountId}~${t.id}`);

describe("mergeFeed", () => {
  it("interleaves older pages from several inboxes newest first", () => {
    const first = [thread("a", "a1", 20), thread("b", "b1", 10)];
    const older = [thread("a", "a2", 15), thread("b", "b2", 5)];
    expect(ids(mergeFeed(first, older))).toEqual(["a~a1", "a~a2", "b~b1", "b~b2"]);
  });

  it("keeps the first page's copy of a thread that is in both", () => {
    const merged = mergeFeed([thread("a", "a1", 20, false)], [thread("a", "a1", 20, true), thread("a", "a2", 15)]);
    expect(ids(merged)).toEqual(["a~a1", "a~a2"]);
    expect(merged[0].unread).toBe(false);
  });

  it("does not confuse the same thread id in two inboxes", () => {
    expect(ids(mergeFeed([thread("a", "x", 20)], [thread("b", "x", 15)]))).toEqual(["a~x", "b~x"]);
  });
});

describe("pushedOff", () => {
  it("returns the thread new mail pushed past the first page", () => {
    const prev = [thread("a", "a1", 20), thread("a", "a2", 15)];
    const next = [thread("a", "a0", 25), thread("a", "a1", 20)];
    expect(ids(pushedOff(prev, next))).toEqual(["a~a2"]);
  });

  it("leaves out a thread that was archived off the first page", () => {
    const prev = [thread("a", "a1", 20), thread("a", "a2", 15)];
    const next = [thread("a", "a2", 15), thread("a", "a3", 10)];
    expect(pushedOff(prev, next)).toEqual([]);
  });

  it("leaves an inbox alone when its first page failed to reload", () => {
    const prev = [thread("a", "a1", 20), thread("b", "b1", 15)];
    expect(pushedOff(prev, [thread("a", "a1", 20)])).toEqual([]);
  });
});

describe("parseFeedCursor", () => {
  it("reads one page token per inbox", () => {
    expect(parseFeedCursor('{"a":"tok-a","b":"tok-b"}')).toEqual({ a: "tok-a", b: "tok-b" });
  });

  it("drops entries that are not tokens", () => {
    expect(parseFeedCursor('{"a":"tok-a","b":7,"c":""}')).toEqual({ a: "tok-a" });
  });

  it("is null when there is no page to ask for", () => {
    for (const raw of [null, "", "nope", "[]", "{}", '"tok"']) expect(parseFeedCursor(raw)).toBeNull();
  });
});
