import { z } from "zod";
import { getZonedYMD, APPLICATION_TZ } from "~/lib/timezone";
import type { PillTone } from "~/hiring/components/cycle-setup/SetupCard";

// Client-safe: the listserv page and its server module share these.

export type ListservStatus = "Submitted" | "ChangesRequested" | "Approved" | "Sent";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ListservBlockSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1).max(64), type: z.literal("text"), text: z.string().max(20_000) }),
  z.object({
    id: z.string().min(1).max(64),
    type: z.literal("image"),
    url: z.string().min(1).max(2000),
    caption: z.string().max(500),
  }),
]);
export type ListservBlock = z.infer<typeof ListservBlockSchema>;

export const ListservAttachmentSchema = z.object({
  key: z.string().min(1).max(500),
  name: z.string().min(1).max(300),
  size: z.number().int().min(0).max(MAX_ATTACHMENT_BYTES),
});
export type ListservAttachment = z.infer<typeof ListservAttachmentSchema>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const ListservDraftSchema = z.object({
  subject: z.string().trim().min(1, "Add a subject line").max(300),
  content: z.array(ListservBlockSchema).min(1).max(60),
  attachments: z.array(ListservAttachmentSchema).max(20),
  sendBy: z.union([z.literal(""), z.string().regex(DAY)]),
  note: z.string().max(2000),
});
export type ListservDraft = z.infer<typeof ListservDraftSchema>;

export function hasContent(content: ListservBlock[]): boolean {
  return content.some((b) => (b.type === "text" ? b.text.trim().length > 0 : Boolean(b.url)));
}

export function imageCount(content: ListservBlock[]): number {
  return content.filter((b) => b.type === "image").length;
}

/** Today's date in the lab's timezone, "yyyy-MM-dd". */
export function labToday(now: Date = new Date()): string {
  const { year, month, day } = getZonedYMD(now, APPLICATION_TZ);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
}

/** "yyyy-MM-dd" → "Tue, Oct 20". Read as a calendar day, never shifted by timezone. */
export function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function daysAgo(iso: string, today: string): string {
  const d = dayNumber(today) - dayNumber(iso);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

export type Urgency = "overdue" | "soon" | "later";

export function urgency(sendBy: string, today: string): Urgency {
  const d = dayNumber(sendBy) - dayNumber(today);
  if (d < 0) return "overdue";
  return d <= 2 ? "soon" : "later";
}

export const URGENCY_TEXT: Record<Urgency, string> = {
  overdue: "text-destructive",
  soon: "text-os-amber",
  later: "text-os-grey",
};

export function sendByLabel(sendBy: string, today: string): string {
  return urgency(sendBy, today) === "overdue"
    ? `Past send-by date (${formatDay(sendBy)})`
    : `Send by ${formatDay(sendBy)}`;
}

/** Earliest send-by first; emails with no deadline after. */
export function bySendBy(a: { sendBy: string | null }, b: { sendBy: string | null }): number {
  return (a.sendBy ?? "9999").localeCompare(b.sendBy ?? "9999");
}

export const STATUS_DOT: Record<ListservStatus, PillTone> = {
  Submitted: "accent",
  ChangesRequested: "warning",
  Approved: "success",
  Sent: "neutral",
};

export function statusLabel(status: ListservStatus, isLead: boolean): string {
  switch (status) {
    case "Submitted":
      return isLead ? "Needs review" : "In review";
    case "ChangesRequested":
      return "Changes requested";
    case "Approved":
      return isLead ? "Ready to send" : "Approved";
    default:
      return "Sent";
  }
}

/** Plain text for pasting into Gmail. Images and files are listed so nothing gets left out. */
export function toPlainText(s: {
  subject: string;
  content: ListservBlock[];
  attachments: { name: string }[];
}): string {
  const body = s.content
    .map((b) => (b.type === "text" ? b.text : `[Image: ${b.caption || b.url}]`))
    .filter((t) => t.trim().length > 0)
    .join("\n\n");
  const files = s.attachments.length
    ? `\n\nAttachments: ${s.attachments.map((a) => a.name).join(", ")}`
    : "";
  return `Subject: ${s.subject}\n\n${body}${files}`;
}

export type ListservAction =
  | "approve"
  | "unapprove"
  | "request-changes"
  | "mark-sent"
  | "unmark-sent"
  | "edit"
  | "withdraw";

/** Which statuses each action may start from, and who may take it. */
export const TRANSITIONS: Record<
  ListservAction,
  { from: readonly ListservStatus[]; by: "lead" | "owner" }
> = {
  approve: { from: ["Submitted", "ChangesRequested"], by: "lead" },
  unapprove: { from: ["Approved"], by: "lead" },
  "request-changes": { from: ["Submitted", "Approved"], by: "lead" },
  "mark-sent": { from: ["Approved"], by: "lead" },
  "unmark-sent": { from: ["Sent"], by: "lead" },
  edit: { from: ["Submitted", "ChangesRequested", "Approved"], by: "owner" },
  withdraw: { from: ["Submitted", "ChangesRequested", "Approved"], by: "owner" },
};

export function canTake(
  action: ListservAction,
  status: ListservStatus,
  viewer: { isLead: boolean; isOwner: boolean },
): boolean {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(status)) return false;
  return rule.by === "lead" ? viewer.isLead : viewer.isOwner;
}
