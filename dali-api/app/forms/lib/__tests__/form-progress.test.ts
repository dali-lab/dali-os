import { describe, expect, it, vi } from "vitest";
import {
  PROGRESS_MAX_AGE_MS,
  clearProgress,
  hasAnswers,
  loadProgress,
  progressKey,
  saveProgress,
  type ProgressStorage,
} from "~/forms/lib/form-progress";

function memoryStorage(): ProgressStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const V = "2026-10-01T00:00:00.000Z";
const NOW = Date.parse("2026-11-01T00:00:00.000Z");
const key = progressKey("tok", "v1", "u1");

describe("progressKey", () => {
  it("separates people, versions and tokens, and uses anon when signed out", () => {
    expect(progressKey("tok", "v1", "u1")).toBe("form-progress:tok:v1:u1");
    expect(progressKey("tok", "v1", null)).toBe("form-progress:tok:v1:anon");
    expect(progressKey("tok", "v1", "u1")).not.toBe(progressKey("tok", "v1", "u2"));
    expect(progressKey("tok", "v1", "u1")).not.toBe(progressKey("tok", "v2", "u1"));
  });
});

describe("hasAnswers", () => {
  it.each([
    [{}, false],
    [{ a: "" }, false],
    [{ a: "  " }, false],
    [{ a: "[]" }, false],
    [{ a: "", b: "x" }, true],
    [{ a: '["x"]' }, true],
  ])("%j -> %s", (answers, expected) => {
    expect(hasAnswers(answers)).toBe(expected);
  });
});

describe("save and load", () => {
  it("round-trips answers, including checkbox JSON strings, and the page index", () => {
    const s = memoryStorage();
    const answers = { a: "hello", b: '["x","y"]' };
    saveProgress(s, key, { answers, pageIndex: 2, versionUpdatedAt: V }, NOW);
    expect(loadProgress(s, key, V, NOW + 1000)).toEqual({
      answers,
      pageIndex: 2,
      versionUpdatedAt: V,
      savedAt: NOW,
    });
  });

  it("does not save empty answers", () => {
    const s = memoryStorage();
    saveProgress(s, key, { answers: { a: "" }, pageIndex: 1, versionUpdatedAt: V }, NOW);
    expect(s.data.size).toBe(0);
  });

  it("returns null when nothing is saved", () => {
    expect(loadProgress(memoryStorage(), key, V, NOW)).toBeNull();
  });

  it("discards and removes a copy saved for a different version", () => {
    const s = memoryStorage();
    saveProgress(s, key, { answers: { a: "x" }, pageIndex: 0, versionUpdatedAt: V }, NOW);
    expect(loadProgress(s, key, "2026-10-02T00:00:00.000Z", NOW)).toBeNull();
    expect(s.data.has(key)).toBe(false);
  });

  it("keeps a copy at 30 days and discards and removes one older", () => {
    const s = memoryStorage();
    saveProgress(s, key, { answers: { a: "x" }, pageIndex: 0, versionUpdatedAt: V }, NOW);
    expect(loadProgress(s, key, V, NOW + PROGRESS_MAX_AGE_MS)).not.toBeNull();
    expect(loadProgress(s, key, V, NOW + PROGRESS_MAX_AGE_MS + 1)).toBeNull();
    expect(s.data.has(key)).toBe(false);
  });

  it.each([
    ["not json", "{"],
    ["a string", '"x"'],
    ["answers not strings", JSON.stringify({ answers: { a: 1 }, versionUpdatedAt: V, savedAt: NOW })],
    ["answers an array", JSON.stringify({ answers: [], versionUpdatedAt: V, savedAt: NOW })],
    ["no savedAt", JSON.stringify({ answers: { a: "x" }, versionUpdatedAt: V })],
  ])("discards and removes a malformed copy: %s", (_n, raw) => {
    const s = memoryStorage();
    s.setItem(key, raw);
    expect(loadProgress(s, key, V, NOW)).toBeNull();
    expect(s.data.has(key)).toBe(false);
  });

  it.each([[-1], [1.5], ["2"], [null]])("treats page index %j as the first page", (pageIndex) => {
    const s = memoryStorage();
    s.setItem(key, JSON.stringify({ answers: { a: "x" }, pageIndex, versionUpdatedAt: V, savedAt: NOW }));
    expect(loadProgress(s, key, V, NOW)?.pageIndex).toBe(0);
  });

  it("clears", () => {
    const s = memoryStorage();
    saveProgress(s, key, { answers: { a: "x" }, pageIndex: 0, versionUpdatedAt: V }, NOW);
    clearProgress(s, key);
    expect(s.data.size).toBe(0);
  });

  it("does nothing without storage", () => {
    expect(loadProgress(null, key, V, NOW)).toBeNull();
    expect(() => saveProgress(null, key, { answers: { a: "x" }, pageIndex: 0, versionUpdatedAt: V })).not.toThrow();
    expect(() => clearProgress(null, key)).not.toThrow();
  });

  it("swallows storage that throws", () => {
    const boom = vi.fn(() => {
      throw new Error("blocked");
    });
    const s: ProgressStorage = { getItem: boom, setItem: boom, removeItem: boom };
    expect(loadProgress(s, key, V, NOW)).toBeNull();
    expect(() => saveProgress(s, key, { answers: { a: "x" }, pageIndex: 0, versionUpdatedAt: V })).not.toThrow();
    expect(() => clearProgress(s, key)).not.toThrow();
  });
});
