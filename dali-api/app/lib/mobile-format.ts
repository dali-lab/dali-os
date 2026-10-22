import type { PresenceState } from "~/lib/presence";

export type MobilePresence = "active" | "away" | "offline";

export interface MemberSummary {
  id: string;
  name: string;
  handle: string | null;
  photoUrl: string | null;
  presence: MobilePresence;
  title: string;
  term: string;
  roles: string[];
}

export function mobilePresence(state: PresenceState, manualAway: boolean): MobilePresence {
  if (manualAway) return state === "away" ? "offline" : "away";
  if (state === "active") return "active";
  if (state === "recent") return "away";
  return "offline";
}

export function displayName(firstName: string | null, lastName: string | null, fallback = "Member"): string {
  const name = [firstName, lastName].filter((p) => p && p.trim()).join(" ").trim();
  return name || fallback;
}

export interface MemberTermFacts {
  isStaff: boolean;
  isCore: boolean;
  coreLeadTitle: string | null;
  domainLeadOf: string[];
  projectDomains: string[];
  currentTermCode: string | null;
  activeThisTerm: boolean;
}

export function memberRoles(f: MemberTermFacts): string[] {
  const roles: string[] = [];
  if (f.isCore) roles.push("Core");
  roles.push(...f.projectDomains);
  if (f.isStaff) roles.push("Staff");
  return [...new Set(roles)];
}

export function leadLabels(f: Pick<MemberTermFacts, "coreLeadTitle" | "domainLeadOf">): string[] {
  const labels: string[] = [];
  if (f.coreLeadTitle) labels.push(f.coreLeadTitle);
  for (const d of f.domainLeadOf) labels.push(`${d} Lead`);
  return [...new Set(labels)];
}

export function memberTitle(f: MemberTermFacts): string {
  const primary = f.projectDomains[0] ?? (f.isStaff ? "Staff" : f.isCore ? "Core" : null);
  const lead = leadLabels(f)[0] ?? null;
  return [primary, lead].filter((p): p is string => Boolean(p)).join(" · ");
}

export function memberTerm(f: MemberTermFacts): string {
  if (f.isStaff) return "Staff";
  return f.activeThisTerm && f.currentTermCode ? f.currentTermCode : "";
}

export function orderedEmails(u: {
  daliEmail: string | null;
  dartmouthEmail: string | null;
  personalEmail: string | null;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [u.daliEmail, u.dartmouthEmail, u.personalEmail]) {
    if (!e) continue;
    const key = e.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(e.trim());
  }
  return out;
}

export function parseStatusBody(body: unknown): "active" | "away" | null {
  if (!body || typeof body !== "object") return null;
  const status = (body as { status?: unknown }).status;
  return status === "active" || status === "away" ? status : null;
}

const EXPO_PUSH_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,128}\]$/;

export function parsePushTokenBody(
  body: unknown,
): { token: string; platform: "ios" | "android" | null } | null {
  if (!body || typeof body !== "object") return null;
  const { token, platform } = body as { token?: unknown; platform?: unknown };
  if (typeof token !== "string" || !EXPO_PUSH_TOKEN.test(token)) return null;
  if (platform !== undefined && platform !== "ios" && platform !== "android") return null;
  return { token, platform: platform ?? null };
}

export function sprintNumberFromLabel(label: string): number | null {
  const m = /Sprint\s+(\d+)/.exec(label);
  return m ? Number(m[1]) : null;
}

export function boardCounts(statuses: string[]): { doneCount: number; totalCount: number } {
  const counted = statuses.filter((s) => s !== "Cancelled");
  return { doneCount: counted.filter((s) => s === "Done").length, totalCount: counted.length };
}

export function githubRef(issueNumber: number | null): string | null {
  return issueNumber == null ? null : String(issueNumber);
}

export type MobileRsvp = "accepted" | "tentative" | "declined" | "needs_action";

export const MAX_CALENDAR_RANGE_DAYS = 62;

export function parseCalendarRange(
  fromRaw: string | null,
  toRaw: string | null,
): { ok: true; from: Date; to: Date } | { ok: false; error: string } {
  if (!fromRaw || !toRaw) return { ok: false, error: "from and to are required" };
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { ok: false, error: "from and to must be ISO dates" };
  }
  if (to <= from) return { ok: false, error: "to must be after from" };
  if (to.getTime() - from.getTime() > MAX_CALENDAR_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    return { ok: false, error: `range is limited to ${MAX_CALENDAR_RANGE_DAYS} days` };
  }
  return { ok: true, from, to };
}

export function inviteRsvp(rsvp: "Accepted" | "Declined" | "Tentative" | null): MobileRsvp {
  if (rsvp === "Accepted") return "accepted";
  if (rsvp === "Declined") return "declined";
  if (rsvp === "Tentative") return "tentative";
  return "needs_action";
}

export function googleRsvp(status: "accepted" | "declined" | "tentative" | "needsAction" | undefined): MobileRsvp {
  if (status === "needsAction") return "needs_action";
  return status ?? "accepted";
}

export interface InviteRow {
  id: string;
  scheduledMeetingId: string | null;
  occurrenceStart: Date | null;
  rsvp: "Accepted" | "Declined" | "Tentative" | null;
}

// A recurring series may carry one series-wide invite and per-occurrence ones;
// the occurrence's own invite wins.
export function inviteForOccurrence(invites: InviteRow[], meetingId: string, occurrenceStartIso: string): InviteRow | null {
  const forMeeting = invites.filter((i) => i.scheduledMeetingId === meetingId);
  const exact = forMeeting.find((i) => i.occurrenceStart?.toISOString() === occurrenceStartIso);
  return exact ?? forMeeting.find((i) => i.occurrenceStart === null) ?? null;
}

export function passDisplayId(userId: string, memberSinceTerm: string | null): string {
  const tail = userId.slice(-4).toUpperCase();
  return memberSinceTerm ? `DALI-${memberSinceTerm}-${tail}` : `DALI-${tail}`;
}

export function passAccessLevel(f: { isCore: boolean; domainCode: string | null }): string {
  return [f.isCore ? "Core" : "Member", f.domainCode].filter(Boolean).join(" · ");
}

export function formatPassDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

export function checkInLocation(m: { title: string; location: string | null; rooms: { name: string }[] }): string {
  return m.location || (m.rooms.length ? m.rooms.map((r) => r.name).join(", ") : m.title);
}
