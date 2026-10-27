import type { Crumb } from "~/components/Breadcrumbs";
import { driveScopeLabel, type ItemLocation } from "~/components/drive/location";
import { formatDateShort } from "~/lib/display";
import { termWeekNumber } from "~/lib/terms.shared";
import { getZonedYMD } from "~/lib/timezone";

/** An item's place in the Drive for a breadcrumb row: its space, the folders above it, then the item. */
export function itemTrail(location: ItemLocation, title: string): Crumb[] {
  const driveHref = (folderId: string | null) =>
    `/drive?scope=${location.scopeId}${folderId ? `&folder=${folderId}` : ""}`;
  return [
    { label: driveScopeLabel({ id: location.scopeId, label: location.scopeLabel }), to: driveHref(null) },
    ...location.folders.map((f) => ({ label: f.title, to: driveHref(f.id) })),
    { label: title },
  ];
}

/** A note's place for the shell's breadcrumb row: space, folders, notebook, then the tab. */
export function noteTrail(
  location: ItemLocation,
  notebook: { id: string; title: string },
  tabLabel: string,
): Crumb[] {
  return [
    ...itemTrail(location, notebook.title).slice(0, -1),
    { label: notebook.title, to: `/documents/${notebook.id}` },
    { label: tabLabel },
  ];
}

/** A tab's name in the rail and breadcrumb: its own title, or its meeting date until it has one. */
export function noteTabLabel(tab: { title: string; meetingOccurrenceStart: Date | null }): string {
  if (tab.title.trim() || !tab.meetingOccurrenceStart) return tab.title;
  return formatDateShort(tab.meetingOccurrenceStart);
}

type TermSpan = { code: string; startDate: Date; endDate: Date };

const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** The rail's week divider for each tab: "Week 3" of the term its meeting fell in, led by
 *  the term code once the notebook's notes cross terms. "Break" between terms, null when undated. */
export function tabWeekLabels(starts: Array<Date | null>, terms: TermSpan[], timeZone: string): Array<string | null> {
  const placed = starts.map((start) => {
    if (!start) return null;
    const ymd = getZonedYMD(start, timeZone);
    const day = Date.UTC(ymd.year, ymd.month - 1, ymd.day);
    const term = terms.find((t) => utcDay(t.startDate) <= day && day <= utcDay(t.endDate));
    return term ? { code: term.code, week: termWeekNumber(day, utcDay(term.startDate)) } : { code: null, week: 0 };
  });
  const codes = new Set(placed.flatMap((p) => (p?.code ? [p.code] : [])));
  return placed.map((p) => {
    if (!p) return null;
    if (!p.code) return "Break";
    return codes.size > 1 ? `${p.code} Week ${p.week}` : `Week ${p.week}`;
  });
}

export function withLeafEmoji(crumbs: Crumb[], emoji: string | null | undefined): Crumb[] {
  if (!emoji || crumbs.length === 0) return crumbs;
  return [...crumbs.slice(0, -1), { ...crumbs[crumbs.length - 1]!, emoji }];
}
