import { prisma } from "~/lib/db";
import { decrypt, encrypt } from "~/lib/calendar-crypto";

interface BusyEvent {
  start: string; // ISO
  end: string; // ISO
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null; // ISO
}

interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
}

const REFRESH_BUFFER_MS = 60_000;

// ─── Token management ──────────────────────────────────────────────────────

function parseStoredTokens(cipher: string): StoredTokens {
  const raw = decrypt(cipher);
  const parsed = JSON.parse(raw) as StoredTokens;
  if (typeof parsed.refreshToken !== "string") {
    throw new Error("UserCalendarLink oauthTokens missing refreshToken");
  }
  return parsed;
}

function serializeStoredTokens(t: StoredTokens): string {
  return encrypt(JSON.stringify(t));
}

async function refreshAndPersist(linkId: string, refreshToken: string): Promise<string> {
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
    throw new Error(`Google token refresh failed (${res.status})`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  const stored: StoredTokens = {
    accessToken: data.access_token,
    refreshToken,
    expiresAt,
  };
  await prisma.userCalendarLink.update({
    where: { id: linkId },
    data: { oauthTokens: serializeStoredTokens(stored) },
  });
  return data.access_token;
}

export async function getValidAccessTokenForLink(linkId: string): Promise<string> {
  const link = await prisma.userCalendarLink.findUnique({
    where: { id: linkId },
    select: { oauthTokens: true },
  });
  if (!link) throw new Error(`UserCalendarLink ${linkId} not found`);
  const t = parseStoredTokens(link.oauthTokens);
  if (t.expiresAt && new Date(t.expiresAt).getTime() > Date.now() + REFRESH_BUFFER_MS) {
    return t.accessToken;
  }
  return refreshAndPersist(linkId, t.refreshToken);
}

// Convenience for the OAuth callback that has just received tokens from Google.
export function buildEncryptedTokens(opts: {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number | null;
}): string {
  return serializeStoredTokens({
    accessToken: opts.accessToken,
    refreshToken: opts.refreshToken,
    expiresAt: opts.expiresInSec ? new Date(Date.now() + opts.expiresInSec * 1000).toISOString() : null,
  });
}

// ─── API calls ─────────────────────────────────────────────────────────────

export async function listCalendarsForLink(linkId: string): Promise<GoogleCalendarListEntry[]> {
  const token = await getValidAccessTokenForLink(linkId);
  const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await extractGoogleErrorDetail(res);
    throw new Error(`Google calendarList failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { items?: GoogleCalendarListEntry[] };
  return data.items ?? [];
}

async function extractGoogleErrorDetail(res: Response): Promise<string> {
  try {
    const data = (await res.clone().json()) as { error?: { message?: string; errors?: { reason?: string }[] } };
    const msg = data.error?.message;
    const reason = data.error?.errors?.[0]?.reason;
    if (msg && reason) return `${reason}: ${msg}`;
    if (msg) return msg;
    if (reason) return reason;
  } catch {
    // fall through to text
  }
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "no detail";
  }
}

async function fetchBusyForLink(
  linkId: string,
  subCalendarIds: string[],
  start: Date,
  end: Date,
): Promise<BusyEvent[]> {
  const token = await getValidAccessTokenForLink(linkId);
  const items = subCalendarIds.length > 0
    ? subCalendarIds.map((id) => ({ id }))
    : [{ id: "primary" }];
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      items,
    }),
  });
  if (!res.ok) {
    const detail = await extractGoogleErrorDetail(res);
    throw new Error(`Google freebusy failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as {
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
  };
  const out: BusyEvent[] = [];
  for (const cal of Object.values(data.calendars ?? {})) {
    for (const b of cal.busy ?? []) out.push({ start: b.start, end: b.end });
  }
  return out;
}

/**
 * Fetch busy events for a user across all enabled Google calendar links.
 * Falls back to legacy User.google* tokens if no link exists yet (preserves
 * the existing /api/google-calendar/busy contract used by the hiring reviewer
 * flow).
 */
export async function fetchBusyEvents(
  userId: string,
  start: Date,
  end: Date,
): Promise<BusyEvent[]> {
  const links = await prisma.userCalendarLink.findMany({
    where: { userId, provider: "Google", enabled: true },
    select: { id: true, subCalendarIds: true },
  });
  if (links.length > 0) {
    const results = await Promise.all(
      links.map(async (l) => {
        try {
          const events = await fetchBusyForLink(l.id, l.subCalendarIds, start, end);
          await prisma.userCalendarLink.update({
            where: { id: l.id },
            data: { lastSyncedAt: new Date(), syncError: null },
          });
          return events;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          await prisma.userCalendarLink
            .update({ where: { id: l.id }, data: { syncError: message } })
            .catch(() => {});
          return [];
        }
      }),
    );
    return results.flat();
  }

  // Legacy fallback — uses tokens from User.google* (login-OAuth scope).
  return fetchBusyFromLegacyUserTokens(userId, start, end);
}

async function fetchBusyFromLegacyUserTokens(
  userId: string,
  start: Date,
  end: Date,
): Promise<BusyEvent[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      googleAccessToken: true,
      googleRefreshToken: true,
      googleTokenExpiresAt: true,
    },
  });
  if (!user?.googleAccessToken) return [];

  let token = user.googleAccessToken;
  if (
    user.googleTokenExpiresAt &&
    user.googleTokenExpiresAt.getTime() <= Date.now() + REFRESH_BUFFER_MS &&
    user.googleRefreshToken
  ) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: user.googleRefreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { access_token: string; expires_in: number };
      token = data.access_token;
      await prisma.user.update({
        where: { id: userId },
        data: {
          googleAccessToken: data.access_token,
          googleTokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
        },
      });
    }
  }

  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: "primary" }],
    }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    calendars?: { primary?: { busy?: { start: string; end: string }[] } };
  };
  return (data.calendars?.primary?.busy ?? []).map((b) => ({ start: b.start, end: b.end }));
}
