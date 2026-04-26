import { prisma } from "~/lib/db";

const ZOOM_ACCOUNT_ID = process.env.ZOOM_ACCOUNT_ID;
const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;

// In-memory token cache — Server-to-Server tokens last 1 hour.
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

export function isZoomConfigured(): boolean {
  return !!(ZOOM_ACCOUNT_ID && ZOOM_CLIENT_ID && ZOOM_CLIENT_SECRET);
}

async function getAccessToken(): Promise<string> {
  // Reuse cached token if still valid (1-min buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const credentials = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "account_credentials",
      account_id: ZOOM_ACCOUNT_ID!,
    }),
  });

  if (!res.ok) {
    throw new Error(`Zoom token refresh failed: ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = data.access_token as string;
  tokenExpiresAt = Date.now() + (data.expires_in as number) * 1000;
  return cachedToken;
}

async function createMeeting(
  topic: string,
  startTime: Date,
  durationMinutes: number,
): Promise<{ meetingId: string; joinUrl: string }> {
  const token = await getAccessToken();
  const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic,
      type: 2, // scheduled meeting
      start_time: startTime.toISOString(),
      duration: durationMinutes,
      settings: {
        join_before_host: true,
        waiting_room: false,
        auto_recording: "none",
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Zoom meeting creation failed: ${await res.text()}`);
  }

  const data = await res.json();
  return {
    meetingId: String(data.id),
    joinUrl: data.join_url as string,
  };
}

async function deleteMeeting(meetingId: string): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  // 204 = deleted, 404 = already gone — both are fine
  if (!res.ok && res.status !== 404) {
    throw new Error(`Zoom meeting deletion failed: ${await res.text()}`);
  }
}

/**
 * Create a Zoom meeting and store the link on the interview row.
 * No-ops if Zoom is not configured (dev environments).
 */
export async function provisionZoomMeeting(
  interviewId: string,
  topic: string,
  startTime: Date,
  durationMinutes: number,
): Promise<void> {
  if (!isZoomConfigured()) return;

  const { meetingId, joinUrl } = await createMeeting(topic, startTime, durationMinutes);
  await prisma.interview.update({
    where: { id: interviewId },
    data: { zoomMeetingId: meetingId, zoomJoinUrl: joinUrl },
  });
}

/**
 * Delete the Zoom meeting associated with an interview.
 * No-ops if Zoom is not configured or the interview has no meeting.
 */
export async function deprovisionZoomMeeting(
  interview: { zoomMeetingId: string | null },
): Promise<void> {
  if (!isZoomConfigured() || !interview.zoomMeetingId) return;
  await deleteMeeting(interview.zoomMeetingId);
}
