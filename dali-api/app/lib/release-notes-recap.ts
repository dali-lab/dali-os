import type { KnownBlock } from "@slack/web-api";
import {
  canViewReleaseNote,
  releaseNoteAreaLabel,
  RELEASE_NOTE_AREAS,
  type ReleaseNoteAudience,
  type ReleaseNoteViewer,
} from "~/lib/release-notes";
import { getZonedParts, zonedWallTimeUtc, APPLICATION_TZ } from "~/lib/timezone";

export const STALE_DRAFT_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const OTHER_AREA_LABEL = "Other";

export type RecapNote = ReleaseNoteAudience & {
  id: string;
  title: string;
  summary: string;
  area: string | null;
  highlight: boolean;
};

export type RecapDraft = ReleaseNoteAudience & { title: string };

export type Recap = {
  highlights: RecapNote[];
  byArea: { label: string; notes: RecapNote[] }[];
  alsoShipped: string[];
};

function etDate(now: Date): Date {
  const { year, month, day } = getZonedParts(now, APPLICATION_TZ);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDayOfWeek(d: Date): number {
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay();
}

export function isoWeekKey(now: Date): string {
  const d = etDate(now);
  d.setUTCDate(d.getUTCDate() + 4 - isoDayOfWeek(d));
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The instant this ISO week's recap is due: `weekday` (0=Sun) at `hour`, ET. */
export function recapSendMoment(now: Date, weekday: number, hour: number): Date {
  const today = etDate(now);
  const target = weekday === 0 ? 7 : weekday;
  today.setUTCDate(today.getUTCDate() + target - isoDayOfWeek(today));
  return zonedWallTimeUtc(
    today.getUTCFullYear(),
    today.getUTCMonth() + 1,
    today.getUTCDate(),
    hour,
    0,
    APPLICATION_TZ,
  );
}

export function shouldRunRecap(
  now: Date,
  lastSuccessAt: Date | null,
  schedule: { weekday: number; hour: number },
): boolean {
  const moment = recapSendMoment(now, schedule.weekday, schedule.hour);
  if (now < moment) return false;
  return lastSuccessAt === null || lastSuccessAt < moment;
}

export function isStaleDraft(draftedAt: Date, now: Date): boolean {
  return now.getTime() - draftedAt.getTime() > STALE_DRAFT_MS;
}

function areaRank(key: string | null): number {
  const i = RELEASE_NOTE_AREAS.findIndex((a) => a.key === key);
  return i === -1 ? RELEASE_NOTE_AREAS.length : i;
}

function groupByArea(notes: RecapNote[]): Recap["byArea"] {
  const groups = new Map<string, RecapNote[]>();
  for (const n of [...notes].sort((a, b) => areaRank(a.area) - areaRank(b.area))) {
    const label = releaseNoteAreaLabel(n.area) ?? OTHER_AREA_LABEL;
    groups.set(label, [...(groups.get(label) ?? []), n]);
  }
  return [...groups].map(([label, list]) => ({ label, notes: list }));
}

/**
 * Highlights first; the rest grouped by area. `canSee` decides which audience
 * the recap is for: the channel sees only all-member entries, a viewer sees
 * what canViewReleaseNote allows.
 */
export function buildRecap(
  notes: RecapNote[],
  drafts: RecapDraft[],
  canSee: (a: ReleaseNoteAudience) => boolean,
): Recap {
  const visible = notes.filter(canSee);
  return {
    highlights: visible.filter((n) => n.highlight),
    byArea: groupByArea(visible.filter((n) => !n.highlight)),
    alsoShipped: drafts.filter(canSee).map((d) => d.title),
  };
}

export const channelAudience = (a: ReleaseNoteAudience) => a.allMembers;

export const viewerAudience =
  (viewer: ReleaseNoteViewer) =>
  (a: ReleaseNoteAudience): boolean =>
    canViewReleaseNote(a, viewer);

export function recapIsEmpty(r: Recap): boolean {
  return r.highlights.length === 0 && r.byArea.length === 0 && r.alsoShipped.length === 0;
}

export type RecapWeek = { week: string; recap: Recap };

/** Recaps newest week first, each filtered to what the viewer can see. */
export function groupRecapsByWeek(
  notes: (RecapNote & { recapWeek: string | null })[],
  viewer: ReleaseNoteViewer,
): RecapWeek[] {
  const weeks = new Map<string, RecapNote[]>();
  for (const n of notes) {
    if (!n.recapWeek) continue;
    weeks.set(n.recapWeek, [...(weeks.get(n.recapWeek) ?? []), n]);
  }
  return [...weeks]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([week, list]) => ({ week, recap: buildRecap(list, [], viewerAudience(viewer)) }))
    .filter((w) => !recapIsEmpty(w.recap));
}

export function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const noteUrl = (baseUrl: string, id: string) => `${baseUrl}/release-notes/${id}`;

export type SlackPost = { blocks: KnownBlock[]; text: string };

export function releaseNotePost(
  note: Pick<RecapNote, "id" | "title" | "summary" | "area" | "highlight">,
  baseUrl: string,
): SlackPost {
  const blocks: KnownBlock[] = [];
  const area = releaseNoteAreaLabel(note.area);
  if (area) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: slackEscape(area) }] });
  const title = slackEscape(note.title);
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*${note.highlight ? "New: " : ""}${title}*\n${slackEscape(note.summary)}` },
  });
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Open" },
        url: noteUrl(baseUrl, note.id),
        action_id: "release_note_open",
      },
    ],
  });
  return { blocks, text: `${note.highlight ? "New: " : ""}${note.title}` };
}

export function recapPost(recap: Recap, week: string, baseUrl: string): SlackPost {
  const link = (n: RecapNote) => `<${noteUrl(baseUrl, n.id)}|${slackEscape(n.title)}>`;
  const blocks: KnownBlock[] = [
    { type: "header", text: { type: "plain_text", text: "What shipped this week" } },
  ];
  for (const n of recap.highlights) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${link(n)}*\n${slackEscape(n.summary)}` },
    });
  }
  for (const group of recap.byArea) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [`*${slackEscape(group.label)}*`, ...group.notes.map((n) => `• ${link(n)}`)].join("\n"),
      },
    });
  }
  if (recap.alsoShipped.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: ["*Also shipped*", ...recap.alsoShipped.map((t) => `• ${slackEscape(t)}`)].join("\n"),
      },
    });
  }
  return { blocks, text: `What shipped this week (${week})` };
}
