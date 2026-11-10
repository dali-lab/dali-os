import { afterEach, describe, expect, it, vi } from "vitest";
import { mentionUserCache } from "~/lib/mention-search";

const ADA = { id: "u1", name: "Ada Lovelace", handle: "alovelace" };
const GRACE = { id: "u2", name: "Grace Hopper", handle: "ghopper" };

afterEach(() => {
  mentionUserCache.clear();
  vi.unstubAllGlobals();
});

describe("mentionUserCache", () => {
  it("serves a full name typed in any order and case from a cached prefix", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ members: [ADA, GRACE] })));
    await mentionUserCache.load("lo");

    expect(mentionUserCache.peek("Lovelace Ada")?.items).toEqual([ADA]);
    expect(mentionUserCache.peek("LOVELACE Byron")?.items).toEqual([]);
  });
});
