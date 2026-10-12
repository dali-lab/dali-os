import { describe, expect, it } from "vitest";
import { isRecordPromptWindow } from "./record-prompt-window";

const START = new Date("2026-10-09T15:00:00Z").getTime();
const END = START + 30 * 60_000; // 30-minute meeting

describe("isRecordPromptWindow", () => {
  it("is false well before the window", () => {
    expect(isRecordPromptWindow(START - 10 * 60_000, START, END)).toBe(false);
  });

  it("is true exactly 5 minutes before start", () => {
    expect(isRecordPromptWindow(START - 5 * 60_000, START, END)).toBe(true);
  });

  it("is true during the meeting", () => {
    expect(isRecordPromptWindow(START + 10 * 60_000, START, END)).toBe(true);
  });

  it("is true exactly at end", () => {
    expect(isRecordPromptWindow(END, START, END)).toBe(true);
  });

  it("is false after end", () => {
    expect(isRecordPromptWindow(END + 1000, START, END)).toBe(false);
  });
});
