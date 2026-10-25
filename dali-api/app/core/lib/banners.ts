import { z } from "zod";
import { ROLE_TARGETS } from "~/lib/feature-flags";
import type { PillTone } from "~/hiring/components/cycle-setup/SetupCard";

// Client-safe: the editor, the list and the overlay share these.

export type BannerKind = "Image" | "Poster" | "Video" | "Text";
export type BannerTone = "Accent" | "Amber" | "Card";
export type BannerTrigger = "AppOpen" | "Page";
export type BannerFrequency = "EveryOpen" | "Daily" | "Once";
export type BannerStatus = "draft" | "scheduled" | "live" | "ended";

/** Roles a banner can target: lab members plus the feature-flag role targets. */
export const BANNER_ROLES = ["isLabMember", ...ROLE_TARGETS] as const;
export type BannerRole = (typeof BANNER_ROLES)[number];

export const BANNER_ROLE_LABELS: Record<BannerRole, string> = {
  isLabMember: "Lab members",
  isCore: "Core",
  isAdmin: "Admins",
  isDomainLead: "Domain leads",
  isInstructor: "Instructors",
  isInterviewer: "Interviewers",
  isStaff: "Staff",
  isAlumni: "Alumni",
};

/** Pages a banner can open over. Each matches its path and everything below it. */
export const BANNER_PAGES = [
  { path: "/", label: "Home" },
  { path: "/calendar", label: "Calendar" },
  { path: "/projects", label: "Projects" },
  { path: "/email", label: "Email" },
  { path: "/members", label: "People" },
  { path: "/drive", label: "Drive" },
  { path: "/education", label: "Education" },
  { path: "/journeys", label: "Journeys" },
] as const;

export function pageLabel(path: string | null): string {
  return BANNER_PAGES.find((p) => p.path === path)?.label ?? path ?? "a page";
}

export function matchesPage(triggerPath: string | null, pathname: string): boolean {
  if (!triggerPath) return false;
  if (triggerPath === "/") return pathname === "/";
  return pathname === triggerPath || pathname.startsWith(`${triggerPath}/`);
}

export const FREQUENCY_LABEL: Record<BannerFrequency, string> = {
  EveryOpen: "Every time",
  Daily: "Once a day",
  Once: "Once per person",
};

export const FREQUENCY_HELP: Record<BannerFrequency, string> = {
  EveryOpen: "Shows every time until they hide it for the day or the banner ends.",
  Daily: "Shows the first time they see it each day.",
  Once: "Shows a single time per person, then never again.",
};

export const STATUS_LABEL: Record<BannerStatus, string> = {
  live: "Live",
  scheduled: "Scheduled",
  draft: "Draft",
  ended: "Ended",
};

export const STATUS_DOT: Record<BannerStatus, PillTone> = {
  live: "success",
  scheduled: "accent",
  draft: "warning",
  ended: "neutral",
};

export function bannerStatus(
  b: { published: boolean; startsAt: string | Date; endsAt: string | Date },
  now: Date = new Date(),
): BannerStatus {
  if (!b.published) return "draft";
  if (new Date(b.endsAt) <= now) return "ended";
  if (new Date(b.startsAt) > now) return "scheduled";
  return "live";
}

/** "Don't show again today" only makes sense for a banner that would otherwise repeat. */
export function snoozeOffered(b: { allowSnooze: boolean; frequency: BannerFrequency }): boolean {
  return b.allowSnooze && b.frequency === "EveryOpen";
}

/**
 * Whether one viewer should see this banner now, given what they've already
 * seen of it. `today` is the lab-calendar day the snooze and daily rules count in.
 */
export function shouldShow(
  b: { frequency: BannerFrequency; allowSnooze: boolean },
  seen: { views: number; lastSeenDay: string | null; snoozedDay: string | null } | null,
  today: string,
): boolean {
  if (!seen) return true;
  if (snoozeOffered(b) && seen.snoozedDay === today) return false;
  if (b.frequency === "Once" && seen.views > 0) return false;
  if (b.frequency === "Daily" && seen.lastSeenDay === today) return false;
  return true;
}

const CTA_URL = /^(\/(?!\/)|https:\/\/)/;

export const BannerInputSchema = z
  .object({
    name: z.string().trim().max(120),
    kind: z.enum(["Image", "Poster", "Video", "Text"]),
    mediaUrl: z.string().max(2000).nullable(),
    videoUrl: z.string().max(2000).nullable(),
    headline: z.string().trim().max(200),
    body: z.string().trim().max(2000),
    ctaLabel: z.string().trim().max(60),
    ctaUrl: z.string().trim().max(2000),
    tone: z.enum(["Accent", "Amber", "Card"]),
    everyone: z.boolean(),
    roles: z.array(z.enum(BANNER_ROLES)).max(BANNER_ROLES.length),
    groupIds: z.array(z.string().min(1)).max(100),
    trigger: z.enum(["AppOpen", "Page"]),
    triggerPath: z.string().max(200).nullable(),
    frequency: z.enum(["EveryOpen", "Daily", "Once"]),
    allowSnooze: z.boolean(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    published: z.boolean(),
  })
  .strict();
export type BannerInput = z.infer<typeof BannerInputSchema>;

export type BannerErrors = Partial<Record<"content" | "audience" | "schedule" | "trigger", string>>;

/** What has to be true before a banner can go out. Drafts skip these. */
export function validateForPublish(b: BannerInput): BannerErrors {
  const e: BannerErrors = {};
  const hasMedia =
    b.kind === "Video" ? Boolean(b.videoUrl) : b.kind !== "Text" && Boolean(b.mediaUrl);
  if (!hasMedia && !b.headline) e.content = b.kind === "Text" ? "Add a headline" : "Add media or a headline";
  else if ([b.mediaUrl, b.videoUrl].some((u) => u && !isSafeMediaUrl(u))) e.content = "Media links must start with https://";
  else if (b.ctaLabel && !CTA_URL.test(b.ctaUrl)) e.content = "Button link must start with / or https://";
  if (!b.everyone && b.roles.length === 0 && b.groupIds.length === 0) e.audience = "Pick an audience";
  if (new Date(b.endsAt) <= new Date(b.startsAt)) e.schedule = "End must be after start";
  if (b.trigger === "Page" && !BANNER_PAGES.some((p) => p.path === b.triggerPath)) e.trigger = "Pick a page";
  return e;
}

export const BANNER_UPLOAD_PREFIX = "banners";

export function isSafeMediaUrl(url: string): boolean {
  return /^https:\/\//.test(url) || url.startsWith("/api/upload/raw?key=uploads%2Fbanners%2F");
}
