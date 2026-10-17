import { describe, it, expect } from "vitest";
import { splitInterviewsByTime } from "../interview-status";

const now = new Date("2026-10-16T15:00:00.000Z");

function row(id: string, start: string, end: string, status: "Scheduled" | "Completed" = "Scheduled") {
  return { id, interview: { status, startTime: start, endTime: end } };
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("splitInterviewsByTime", () => {
  it("keeps a scheduled interview that hasn't ended as upcoming", () => {
    const { upcoming, past } = splitInterviewsByTime(
      [row("a", "2026-10-17T15:00:00.000Z", "2026-10-17T15:30:00.000Z")],
      now,
    );
    expect(ids(upcoming)).toEqual(["a"]);
    expect(past).toEqual([]);
  });

  it("treats an in-progress interview as upcoming", () => {
    const { upcoming } = splitInterviewsByTime(
      [row("a", "2026-10-16T14:45:00.000Z", "2026-10-16T15:15:00.000Z")],
      now,
    );
    expect(ids(upcoming)).toEqual(["a"]);
  });

  it("moves a scheduled interview whose slot has ended to past", () => {
    const { upcoming, past } = splitInterviewsByTime(
      [row("a", "2026-10-15T15:00:00.000Z", "2026-10-15T15:30:00.000Z")],
      now,
    );
    expect(upcoming).toEqual([]);
    expect(ids(past)).toEqual(["a"]);
  });

  it("counts an interview ending exactly now as past", () => {
    const { past } = splitInterviewsByTime(
      [row("a", "2026-10-16T14:30:00.000Z", "2026-10-16T15:00:00.000Z")],
      now,
    );
    expect(ids(past)).toEqual(["a"]);
  });

  it("moves a completed interview to past even before its slot ends", () => {
    const { upcoming, past } = splitInterviewsByTime(
      [row("a", "2026-10-16T14:45:00.000Z", "2026-10-16T15:15:00.000Z", "Completed")],
      now,
    );
    expect(upcoming).toEqual([]);
    expect(ids(past)).toEqual(["a"]);
  });

  it("orders upcoming soonest first and past most recent first", () => {
    const { upcoming, past } = splitInterviewsByTime(
      [
        row("later", "2026-10-20T15:00:00.000Z", "2026-10-20T15:30:00.000Z"),
        row("old", "2026-10-01T15:00:00.000Z", "2026-10-01T15:30:00.000Z"),
        row("soon", "2026-10-17T15:00:00.000Z", "2026-10-17T15:30:00.000Z"),
        row("recent", "2026-10-14T15:00:00.000Z", "2026-10-14T15:30:00.000Z", "Completed"),
      ],
      now,
    );
    expect(ids(upcoming)).toEqual(["soon", "later"]);
    expect(ids(past)).toEqual(["recent", "old"]);
  });

  it("accepts Date values as well as ISO strings", () => {
    const { past } = splitInterviewsByTime(
      [{ id: "a", interview: { status: "Scheduled" as const, startTime: new Date("2026-10-15T15:00:00.000Z"), endTime: new Date("2026-10-15T15:30:00.000Z") } }],
      now,
    );
    expect(ids(past)).toEqual(["a"]);
  });
});
