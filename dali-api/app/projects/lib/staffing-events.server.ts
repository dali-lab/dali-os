import { publish } from "~/lib/realtime-bus.server";

// A staffing-board mutation (assign / finalize / board-member) publishes;
// every open board for that cycle revalidates its loader.

export const staffingTopic = (cycleId: string) => `staffing:${cycleId}`;

export function publishCycleChange(cycleId: string): void {
  publish(staffingTopic(cycleId));
}
