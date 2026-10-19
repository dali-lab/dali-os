import type { EventMeetingDTO } from "~/calendar/lib/types";

export const STOP_TRACKING_LABEL = "Stop tracking";
export const STOP_TRACKING_DESCRIPTION =
  "Stop tracking this meeting in DALI? The Google event stays on everyone's calendar. Notes and attendance stay in Drive.";

export const isTrackedMeeting = (meeting: Pick<EventMeetingDTO, "googleEventOrigin"> | undefined): boolean =>
  meeting?.googleEventOrigin === "Tracked";
