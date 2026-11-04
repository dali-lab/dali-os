import { describe, expect, it } from "vitest";
import { validateInput } from "~/lib/mcp-input";
import {
  keysetPage,
  keysetWindow,
  offsetPage,
  offsetWindow,
  pageArray,
  pageProps,
  pageText,
} from "../pagination";

const LIMITS = { defaultLimit: 2, maxLimit: 3 };

describe("pageProps", () => {
  it("declares limit and cursor that the input validator accepts", () => {
    const schema = {
      type: "object",
      properties: pageProps(LIMITS),
      additionalProperties: false,
    };
    expect(validateInput({ limit: 3, cursor: "abc" }, schema).ok).toBe(true);
    expect(validateInput({ limit: 4 }, schema).ok).toBe(false);
    expect(validateInput({ limit: 0 }, schema).ok).toBe(false);
  });
});

describe("offset paging", () => {
  it("overfetches one row and reports the next page", () => {
    const window = offsetWindow({}, LIMITS);
    expect(window).toEqual({ limit: 2, skip: 0, take: 3 });
    const { rows, page } = offsetPage(["a", "b", "c"], window, 5);
    expect(rows).toEqual(["a", "b"]);
    expect(page).toMatchObject({ hasMore: true, limit: 2, total: 5 });
    expect(offsetWindow({ cursor: page.nextCursor! }, LIMITS).skip).toBe(2);
  });

  it("ends with a null cursor and omits an unknown total", () => {
    const { page } = offsetPage(["a"], offsetWindow({}, LIMITS));
    expect(page).toEqual({ nextCursor: null, hasMore: false, limit: 2 });
  });

  it("clamps the limit for callers that bypass schema validation", () => {
    expect(offsetWindow({ limit: 99 }, LIMITS).limit).toBe(3);
    expect(offsetWindow({ limit: 0 }, LIMITS).limit).toBe(2);
    expect(offsetWindow({ limit: -1 }, LIMITS).limit).toBe(2);
    expect(offsetWindow({ limit: 1.9 }, LIMITS).limit).toBe(1);
  });

  it.each(["garbage", "e30", Buffer.from('{"o":-1}').toString("base64url")])(
    "rejects the malformed cursor %j",
    (cursor) => {
      expect(() => offsetWindow({ cursor }, LIMITS)).toThrow(/Invalid cursor/);
    },
  );

  it("rejects a keyset cursor", () => {
    const window = keysetWindow({ limit: 1 }, LIMITS, []);
    const { page } = keysetPage([{ id: "a" }, { id: "b" }], window);
    expect(() => offsetWindow({ cursor: page.nextCursor! }, LIMITS)).toThrow(/Invalid cursor/);
  });
});

describe("pageArray", () => {
  it("walks a computed list exactly once and reports its full length", () => {
    const all = [1, 2, 3, 4, 5];
    const seen: number[] = [];
    let cursor: string | undefined;
    for (;;) {
      const { rows, page } = pageArray(all, { cursor }, LIMITS);
      expect(page.total).toBe(5);
      seen.push(...rows);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(all);
  });
});

describe("keyset paging", () => {
  const sort = [{ field: "createdAt", direction: "desc" as const, type: "date" as const }];
  const at = new Date("2026-10-01T00:00:00.000Z");

  it("always tiebreaks on id", () => {
    const window = keysetWindow({}, LIMITS, sort);
    expect(window.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(window.where).toEqual({});
    expect(window.take).toBe(3);
  });

  it("builds a seek predicate that handles sort-key ties", () => {
    const first = keysetWindow({}, LIMITS, sort);
    const { page } = keysetPage(
      [
        { id: "c", createdAt: at },
        { id: "b", createdAt: at },
        { id: "a", createdAt: at },
      ],
      first,
    );
    const next = keysetWindow({ cursor: page.nextCursor! }, LIMITS, sort);
    expect(next.where).toEqual({
      OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: "b" } }],
    });
  });

  it("uses gt for ascending fields and honors the tiebreak direction", () => {
    const window = keysetWindow({}, LIMITS, [{ field: "position", direction: "asc" }], "asc");
    const { page } = keysetPage(
      [
        { id: "a", position: 1 },
        { id: "b", position: 1 },
        { id: "c", position: 2 },
      ],
      window,
    );
    const next = keysetWindow(
      { cursor: page.nextCursor! },
      LIMITS,
      [{ field: "position", direction: "asc" }],
      "asc",
    );
    expect(next.where).toEqual({
      OR: [{ position: { gt: 1 } }, { position: 1, id: { gt: "b" } }],
    });
  });

  it("ends with a null cursor when no extra row came back", () => {
    const window = keysetWindow({}, LIMITS, sort);
    const { rows, page } = keysetPage([{ id: "a", createdAt: at }], window, 1);
    expect(rows).toHaveLength(1);
    expect(page).toEqual({ nextCursor: null, hasMore: false, limit: 2, total: 1 });
  });

  it("fails loudly when a sort field was left out of the select", () => {
    const window = keysetWindow({}, LIMITS, sort);
    expect(() => keysetPage([{ id: "a" }, { id: "b" }, { id: "c" }], window)).toThrow(/createdAt/);
  });

  it("rejects cursors from a different sort or with a bad date", () => {
    const window = keysetWindow({ limit: 1 }, LIMITS, sort);
    const { page } = keysetPage(
      [
        { id: "a", createdAt: at },
        { id: "b", createdAt: at },
      ],
      window,
    );
    expect(() => keysetWindow({ cursor: page.nextCursor! }, LIMITS, [])).toThrow(/Invalid cursor/);
    const offsetCursor = offsetPage([1, 2, 3], offsetWindow({}, LIMITS)).page.nextCursor!;
    expect(() => keysetWindow({ cursor: offsetCursor }, LIMITS, sort)).toThrow(/Invalid cursor/);
    const badDate = Buffer.from(JSON.stringify({ k: ["nope", "a"] })).toString("base64url");
    expect(() => keysetWindow({ cursor: badDate }, LIMITS, sort)).toThrow(/Invalid cursor/);
  });
});

describe("pageText", () => {
  const limits = { defaultLimit: 4, maxLimit: 10 };

  it("rebuilds the original text from its chunks", () => {
    const text = "abcdefghij";
    let out = "";
    let cursor: string | undefined;
    for (;;) {
      const chunk = pageText(text, { cursor }, limits);
      expect(chunk.page.total).toBe(10);
      out += chunk.text;
      if (!chunk.page.nextCursor) break;
      cursor = chunk.page.nextCursor;
    }
    expect(out).toBe(text);
  });

  it("returns a short value whole", () => {
    const chunk = pageText("abc", {}, limits);
    expect(chunk).toEqual({
      text: "abc",
      page: { nextCursor: null, hasMore: false, limit: 4, total: 3 },
    });
  });

  it("handles empty text", () => {
    expect(pageText("", {}, limits).page).toMatchObject({ hasMore: false, total: 0 });
  });

  it("never splits a surrogate pair across chunks", () => {
    const text = "abc😀def";
    const first = pageText(text, {}, limits);
    expect(first.text).toBe("abc");
    const second = pageText(text, { cursor: first.page.nextCursor! }, limits);
    expect(second.text.startsWith("😀")).toBe(true);
  });

  it("still advances when the limit is smaller than one surrogate pair", () => {
    const first = pageText("😀b", { limit: 1 }, limits);
    expect(first.page.nextCursor).not.toBeNull();
  });
});
