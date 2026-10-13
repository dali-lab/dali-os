import { describe, it, expect } from "vitest";
import { projectWorkMeta } from "../project-work";
import { STALE_DAYS } from "~/projects/lib/project-status";

const now = new Date("2026-10-12T15:00:00Z");
const base = {
  status: "Todo" as const,
  sprint: null,
  carryoverCount: 0,
  activityAt: now.toISOString(),
};
const sprint = { label: "Sprint 4", endsOn: "2026-10-13T00:00:00.000Z" };

describe("projectWorkMeta", () => {
  it("flags carried-over work first, counting the rolls", () => {
    expect(projectWorkMeta({ ...base, sprint, carryoverCount: 1 }, now)).toEqual({
      kind: "carried",
      warn: true,
      text: "Carried over once",
    });
    expect(projectWorkMeta({ ...base, carryoverCount: 3, status: "InReview" }, now).text).toBe(
      "Carried over 3×",
    );
  });

  it("flags stale InProgress work after the status bar's threshold", () => {
    const old = new Date(now.getTime() - STALE_DAYS * 86_400_000).toISOString();
    expect(projectWorkMeta({ ...base, status: "InProgress", activityAt: old }, now)).toMatchObject({
      kind: "stale",
      warn: true,
    });
    const recent = new Date(now.getTime() - (STALE_DAYS - 1) * 86_400_000).toISOString();
    expect(projectWorkMeta({ ...base, status: "InProgress", activityAt: recent, sprint }, now).kind).toBe(
      "sprint",
    );
  });

  it("reports review before the sprint line", () => {
    expect(projectWorkMeta({ ...base, status: "InReview", sprint }, now)).toEqual({
      kind: "review",
      warn: false,
      text: "In review",
    });
  });

  it("names the sprint and its last day in UTC", () => {
    expect(projectWorkMeta({ ...base, sprint }, now)).toEqual({
      kind: "sprint",
      warn: false,
      text: "Sprint 4 · ends Tue, Oct 13",
    });
  });

  it("falls back to Backlog", () => {
    expect(projectWorkMeta(base, now)).toEqual({ kind: "backlog", warn: false, text: "Backlog" });
  });
});
