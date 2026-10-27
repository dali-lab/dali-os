import { publish } from "~/lib/realtime-bus.server";

// Delibs boards change when a lead moves a card, a session opens or closes, or
// a review is submitted or pulled back (which changes who qualifies). Each of
// those publishes for its cycle; every open board in the cycle revalidates.

export const delibsTopic = (cycleId: string) => `delibs:${cycleId}`;

export function publishDelibsChange(cycleId: string): void {
  publish(delibsTopic(cycleId));
}
