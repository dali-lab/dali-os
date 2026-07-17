import { redirect } from "react-router";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { listCalendarsForLink } from "~/lib/google-calendar";
import { loadProfilePage } from "~/members/lib/profile-page.server";

export type CalendarLinkDTO = {
  id: string;
  provider: "Google" | "Outlook";
  externalEmail: string;
  displayName: string | null;
  syncError: string | null;
  subCalendars: Array<{
    id: string;
    summary: string;
    primary: boolean;
    color: string | null;
    enabled: boolean;
  }> | null;
};

export type SessionRowDTO = {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  device: string;
  userAgent: string | null;
  isDesktop: boolean;
  ip: string | null;
  kind: { type: "oauth"; clientName: string } | { type: "browser" };
};

export type GrantRowDTO = {
  id: string;
  clientName: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

function describeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  if (/DALI OS Desktop/i.test(ua)) return "DALI OS Desktop";
  if (/claude code/i.test(ua)) return "Claude Code";
  if (/^codex\b|codex\//i.test(ua)) return "Codex CLI";
  if (/claude/i.test(ua) && /node\.js|electron/i.test(ua)) return "Claude Desktop";

  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua) && !/Chromium/.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua) && !/Chrome/.test(ua)
          ? "Safari"
          : null;

  const os = /Mac OS X/.test(ua)
    ? "macOS"
    : /Windows NT/.test(ua)
      ? "Windows"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad|iOS/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;
  return "Unknown device";
}

export async function loadSettingsPageData(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  const userId = auth.user.sub;

  const [profile, links, user, sessionRows, grants] = await Promise.all([
    loadProfilePage({ request, targetId: userId }),
    prisma.userCalendarLink.findMany({
      where: { userId },
      orderBy: { linkedAt: "asc" },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        slackUserId: true,
        daliEmail: true,
        dartmouthEmail: true,
        personalEmail: true,
      },
    }),
    prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        userAgent: true,
        ip: true,
        grantId: true,
        grant: { select: { client: { select: { name: true } } } },
      },
      orderBy: { lastUsedAt: "desc" },
    }),
    prisma.oAuthGrant.findMany({
      where: { userId, revokedAt: null },
      include: { client: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const calendarLinks: CalendarLinkDTO[] = await Promise.all(
    links.map(async (l) => {
      const base = {
        id: l.id,
        provider: l.provider,
        externalEmail: l.externalEmail,
        displayName: l.displayName,
        syncError: l.syncError,
      };
      if (l.provider !== "Google") return { ...base, subCalendars: null };
      try {
        const items = await listCalendarsForLink(l.id);
        const enabledSet = new Set(l.subCalendarIds);
        const subCalendars = items.map((it) => ({
          id: it.id,
          summary: it.summary,
          primary: it.primary === true,
          color: it.backgroundColor ?? null,
          enabled:
            l.subCalendarIds.length === 0 ? it.primary === true : enabledSet.has(it.id),
        }));
        return { ...base, subCalendars };
      } catch {
        return { ...base, subCalendars: null };
      }
    }),
  );

  const slackEmails = [user?.daliEmail, user?.dartmouthEmail, user?.personalEmail].filter(
    (e): e is string => !!e,
  );

  const sessions: SessionRowDTO[] = sessionRows.map((s) => ({
    id: s.id,
    createdAt: s.createdAt.toISOString(),
    lastUsedAt: s.lastUsedAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    device: describeUserAgent(s.userAgent),
    userAgent: s.userAgent,
    isDesktop: /DALI OS Desktop/i.test(s.userAgent ?? ""),
    ip: s.ip,
    kind: s.grantId
      ? { type: "oauth" as const, clientName: s.grant?.client.name ?? "App" }
      : { type: "browser" as const },
  }));

  const grantRows: GrantRowDTO[] = grants.map((g) => ({
    id: g.id,
    clientName: g.client.name,
    scopes: g.scopes,
    createdAt: g.createdAt.toISOString(),
    lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
  }));

  return {
    profile,
    calendarLinks,
    slack: {
      slackUserId: user?.slackUserId ?? null,
      configured: !!process.env.SLACK_BOT_TOKEN,
      emails: slackEmails,
    },
    currentSessionId: auth.sessionId,
    sessions,
    grants: grantRows,
  };
}
