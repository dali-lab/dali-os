import { prisma } from "~/lib/db";

interface BusyEvent {
  start: string; // ISO
  end: string;   // ISO
}

/**
 * Refresh a user's Google access token using their stored refresh token.
 * Updates the DB with the new token + expiry.
 */
async function refreshGoogleToken(userId: string, refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${await res.text()}`);
  }

  const data = await res.json();
  const newAccessToken = data.access_token as string;
  const expiresIn = data.expires_in as number;
  const newExpiresAt = new Date(Date.now() + expiresIn * 1000);

  await prisma.user.update({
    where: { id: userId },
    data: {
      googleAccessToken: newAccessToken,
      googleTokenExpiresAt: newExpiresAt,
    },
  });

  return newAccessToken;
}

/**
 * Get a valid Google access token for a user, refreshing if expired.
 * Returns null if user has no Google tokens.
 */
async function getValidAccessToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      googleAccessToken: true,
      googleRefreshToken: true,
      googleTokenExpiresAt: true,
    },
  });

  if (!user?.googleAccessToken) return null;

  // If still valid (with 1min buffer), return as-is
  if (user.googleTokenExpiresAt && user.googleTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return user.googleAccessToken;
  }

  // Expired — refresh
  if (!user.googleRefreshToken) return user.googleAccessToken; // try anyway
  return refreshGoogleToken(userId, user.googleRefreshToken);
}

/**
 * Fetch all busy events from a user's primary Google Calendar within a date range.
 */
export async function fetchBusyEvents(
  userId: string,
  start: Date,
  end: Date,
): Promise<BusyEvent[]> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("No Google access token found for user");
  }

  // Use the freebusy API — returns busy intervals only
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: "primary" }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Google freebusy failed: ${await res.text()}`);
  }

  const data = await res.json();
  const busy = data.calendars?.primary?.busy ?? [];
  return busy.map((b: { start: string; end: string }) => ({
    start: b.start,
    end: b.end,
  }));
}
