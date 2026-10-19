import { describe, it, expect } from "vitest";
import {
  isTrackedMeeting,
  STOP_TRACKING_DESCRIPTION,
  STOP_TRACKING_LABEL,
} from "~/calendar/lib/stop-tracking";

describe("stop tracking", () => {
  it("applies only to a Tracked meeting", () => {
    expect(isTrackedMeeting({ googleEventOrigin: "Tracked" })).toBe(true);
    expect(isTrackedMeeting({ googleEventOrigin: "Created" })).toBe(false);
    expect(isTrackedMeeting({ googleEventOrigin: null })).toBe(false);
    expect(isTrackedMeeting(undefined)).toBe(false);
  });

  it("uses the agreed copy, with no em dashes", () => {
    expect(STOP_TRACKING_LABEL).toBe("Stop tracking");
    expect(STOP_TRACKING_DESCRIPTION).toBe(
      "Stop tracking this meeting in DALI? The Google event stays on everyone's calendar. Notes and attendance stay in Drive.",
    );
    expect(STOP_TRACKING_DESCRIPTION).not.toContain("—");
  });
});
