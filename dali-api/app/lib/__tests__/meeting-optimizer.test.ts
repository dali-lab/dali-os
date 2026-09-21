import { describe, it, expect } from "vitest";
import {
  optimizeMeetingSchedule,
  type OptimizerMeeting,
} from "~/lib/meeting-optimizer";

const HOUR = 3_600_000;
const slot = (startMs: number, endMs: number, freeIds: string[]) => ({ startMs, endMs, freeIds });

describe("optimizeMeetingSchedule", () => {
  it("places overlapping-membership meetings at different times so shared members attend both", () => {
    // u2 is in both meetings; each meeting can run at t0 or t2. Scheduling both
    // at the same time double-books u2 (total 3); staggering them lets u2 attend
    // both (total 4). The optimizer must pick the stagger.
    const meetings: OptimizerMeeting[] = [
      {
        key: "A",
        memberIds: ["u1", "u2"],
        candidates: [slot(0, HOUR, ["u1", "u2"]), slot(2 * HOUR, 3 * HOUR, ["u1", "u2"])],
      },
      {
        key: "B",
        memberIds: ["u2", "u3"],
        candidates: [slot(0, HOUR, ["u2", "u3"]), slot(2 * HOUR, 3 * HOUR, ["u2", "u3"])],
      },
    ];
    const r = optimizeMeetingSchedule(meetings);
    expect(r.totalAttendance).toBe(4);
    expect(r.maxPossibleAttendance).toBe(4);
    const a = r.meetings.find((m) => m.key === "A")!;
    const b = r.meetings.find((m) => m.key === "B")!;
    expect(a.slot!.startMs).not.toBe(b.slot!.startMs);
    expect(a.conflicts).toHaveLength(0);
    expect(b.conflicts).toHaveLength(0);
  });

  it("counts a double-booked member once and blames the winning meeting", () => {
    // Both meetings can only run at the same slot; u2 can attend just one.
    const meetings: OptimizerMeeting[] = [
      { key: "A", memberIds: ["u1", "u2"], candidates: [slot(0, HOUR, ["u1", "u2"])] },
      { key: "B", memberIds: ["u2", "u3"], candidates: [slot(0, HOUR, ["u2", "u3"])] },
    ];
    const r = optimizeMeetingSchedule(meetings);
    expect(r.totalAttendance).toBe(3); // u1 + u3 + u2-once
    const allConflicts = r.meetings.flatMap((m) =>
      m.conflicts.map((c) => ({ from: m.key, ...c })),
    );
    expect(allConflicts).toHaveLength(1);
    const conflict = allConflicts[0];
    expect(conflict.userId).toBe("u2");
    // The blamed meeting is the other one, and u2 attends there.
    expect(conflict.withKey).not.toBe(conflict.from);
    const winner = r.meetings.find((m) => m.key === conflict.withKey)!;
    expect(winner.attendeeIds).toContain("u2");
  });

  it("picks the fuller slot for a lone meeting and lists the rest as alternatives", () => {
    const meetings: OptimizerMeeting[] = [
      {
        key: "M",
        memberIds: ["u1", "u2", "u3"],
        candidates: [slot(0, HOUR, ["u1"]), slot(2 * HOUR, 3 * HOUR, ["u1", "u2", "u3"])],
      },
    ];
    const r = optimizeMeetingSchedule(meetings);
    const m = r.meetings[0];
    expect(m.slot!.startMs).toBe(2 * HOUR);
    expect(m.attendeeIds.sort()).toEqual(["u1", "u2", "u3"]);
    expect(r.totalAttendance).toBe(3);
    expect(m.alternatives).toEqual([{ startMs: 0, endMs: HOUR, freeCount: 1 }]);
  });

  it("reports a meeting with no viable slot as unscheduled", () => {
    const meetings: OptimizerMeeting[] = [{ key: "M", memberIds: ["u1"], candidates: [] }];
    const r = optimizeMeetingSchedule(meetings);
    expect(r.meetings[0].slot).toBeNull();
    expect(r.meetings[0].attendeeIds).toHaveLength(0);
    expect(r.meetings[0].unavailableIds).toEqual(["u1"]);
    expect(r.totalAttendance).toBe(0);
    expect(r.maxPossibleAttendance).toBe(1);
  });

  it("splits three overlapping meetings across distinct times for a member in all of them", () => {
    // u0 is in all three; three disjoint slots exist. Optimal staggers them so
    // u0 attends all three (a greedy per-meeting pick would collide).
    const slots = [slot(0, HOUR, []), slot(2 * HOUR, 3 * HOUR, []), slot(4 * HOUR, 5 * HOUR, [])];
    const withU0 = (extra: string) =>
      slots.map((s) => ({ ...s, freeIds: ["u0", extra] }));
    const meetings: OptimizerMeeting[] = [
      { key: "A", memberIds: ["u0", "a"], candidates: withU0("a") },
      { key: "B", memberIds: ["u0", "b"], candidates: withU0("b") },
      { key: "C", memberIds: ["u0", "c"], candidates: withU0("c") },
    ];
    const r = optimizeMeetingSchedule(meetings);
    expect(r.totalAttendance).toBe(6); // u0 attends 3, a/b/c attend 1 each
    const starts = r.meetings.map((m) => m.slot!.startMs);
    expect(new Set(starts).size).toBe(3);
    expect(r.meetings.every((m) => m.conflicts.length === 0)).toBe(true);
  });
});
