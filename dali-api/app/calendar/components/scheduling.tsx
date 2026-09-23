import { useEffect, useRef, useState } from "react";
import { Link, useRevalidator, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight, Mail, RefreshCw, Search, UsersRound, X } from "lucide-react";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
  FloatingPortal,
} from "@floating-ui/react";
import { Tooltip, Combobox, type SelectOption } from "~/components/ui/floating";
import { usePanelClass } from "~/components/ui/floating/os-styles";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { fullName } from "~/lib/display";
import type { RsvpStatus } from "~/calendar/lib/types";
import { isGuestEmail } from "~/calendar/lib/guest-emails";
import {
  toDatetimeLocal, HOURS, HOUR_PX, SNAP_HOURS,
  availabilityTint, dayHourToLocal, shiftWeekParam,
} from "~/calendar/lib/event-block";
import {
  WeekGrid, BlockBlock, useRefreshOnFocus, workingHoursStripeLayer,
} from "~/calendar/components/WeekGrid";
import { findOptimalSlots, type RankedSlot } from "~/calendar/lib/optimal-times";
import {
  type GroupOption, type UserOption, type GroupAvailResponse, type ProjectOption,
  type CalendarLinkDTO, type WhDay, type EventBlock, type LoaderData,
} from "~/calendar/lib/types";
import { roleOptionKey, parseRoleOptionKey } from "~/calendar/components/role-fields";

export function userLabel(u: UserOption) {
  const name = fullName(u);
  return name || u.daliEmail || u.id;
}

export function WeekToolbar({
  legend,
  monthLabel,
  weekStartIso,
  onRefresh,
  refreshing,
  weekNav,
}: {
  // `color` is a Tailwind bg-* class; `swatch` is a raw CSS color for tints
  // that are computed at runtime (e.g. the availability gradient stops).
  // Unused today (not rendered in this component's JSX) — kept optional so
  // callers that don't have a color key to show (e.g. Timesheet, which uses
  // RoleFilterRow instead) don't need to pass a placeholder value.
  legend?: { color?: string; swatch?: string; label: string }[];
  monthLabel: string;
  weekStartIso: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  /**
   * Controlled week navigation. Callers that keep the week in their own state
   * rather than in `?weekStart=` (CreateEventModal) must pass this: the default
   * Link nav only moves the URL, so in a modal it would re-run the route loader
   * behind the overlay while the grid — which reads the week from a prop — sat
   * on the same seven days.
   */
  weekNav?: { onShift: (weeks: number) => void; onToday: () => void };
}) {
  const { iconBtn } = useOsChrome();
  // Use URL-relative resolution so "?weekStart=…" stays on /calendar instead of
  // bubbling up to the parent route (which would land on /).
  const prev = `?weekStart=${shiftWeekParam(weekStartIso, -1)}`;
  const next = `?weekStart=${shiftWeekParam(weekStartIso, 1)}`;
  const todayClass = cn(
    "text-xs font-semibold transition-colors",
    "os-edit-btn os-add-btn--sm",
  );
  return (
    <div className={cn("flex items-center justify-between", "mb-5")}>
      <div className="flex items-center gap-3">
        <h2
          className={cn(
            "font-heading text-foreground",
            "text-2xl font-medium",
          )}
        >
          {monthLabel}
        </h2>
        <div className="flex items-center gap-1">
          {weekNav ? (
            <>
              <button
                type="button"
                aria-label="Previous week"
                onClick={() => weekNav.onShift(-1)}
                className={iconBtn}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button type="button" onClick={weekNav.onToday} className={todayClass}>
                Today
              </button>
              <button
                type="button"
                aria-label="Next week"
                onClick={() => weekNav.onShift(1)}
                className={iconBtn}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <Link
                to={prev}
                relative="path"
                aria-label="Previous week"
                preventScrollReset
                className={iconBtn}
              >
                <ChevronLeft className="w-4 h-4" />
              </Link>
              <Link to="?" relative="path" preventScrollReset className={todayClass}>
                Today
              </Link>
              <Link
                to={next}
                relative="path"
                aria-label="Next week"
                preventScrollReset
                className={iconBtn}
              >
                <ChevronRight className="w-4 h-4" />
              </Link>
            </>
          )}
          {onRefresh && (
            <Tooltip content={refreshing ? "Refreshing…" : "Refresh availability"}>
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                aria-label="Refresh availability"
                className={cn(iconBtn, "disabled:opacity-50")}
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

export type AddingMode = null | "user" | "group";

export function ParticipantPicker({
  users,
  groups,
  selectedUserIds,
  selectedGroupIds,
  onChangeUsers,
  onChangeGroups,
  usersById,
  groupsById,
  resolvedCount,
  responsesByUserId,
  guestEmails = [],
  onChangeGuestEmails,
}: {
  users: UserOption[];
  groups: GroupOption[];
  selectedUserIds: string[];
  selectedGroupIds: string[];
  onChangeUsers: (ids: string[]) => void;
  onChangeGroups: (ids: string[]) => void;
  usersById: Map<string, UserOption>;
  groupsById: Map<string, GroupOption>;
  resolvedCount: number;
  // Per-guest RSVP (from the meeting's invite notifications), shown as a dot on
  // each chip when editing an existing meeting. Absent = no response yet.
  responsesByUserId?: Map<string, RsvpStatus>;
  // People with no DALI profile, invited by address. Omit the handler and the
  // picker stays members-only.
  guestEmails?: string[];
  onChangeGuestEmails?: (emails: string[]) => void;
}) {
  const { fieldRadius } = useOsChrome();
  const panelClass = usePanelClass();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<Array<HTMLElement | null>>([]);

  const q = query.trim().toLowerCase();
  const filteredGroups = groups
    .filter((g) => !selectedGroupIds.includes(g.id))
    .filter((g) => (q ? g.name.toLowerCase().includes(q) : true))
    .slice(0, 20);
  const filteredUsers = users
    .filter((u) => !selectedUserIds.includes(u.id))
    .filter((u) =>
      q ? userLabel(u).toLowerCase().includes(q) || (u.daliEmail ?? "").toLowerCase().includes(q) : true,
    )
    .slice(0, 40);

  // A typed address with no member behind it can be invited as-is.
  const inviteEmail =
    onChangeGuestEmails &&
    isGuestEmail(q) &&
    !guestEmails.includes(q) &&
    !users.some((u) => u.daliEmail?.toLowerCase() === q)
      ? q
      : null;

  // One flat list (groups, then users, then a typed email) so the arrow keys
  // walk all of them and Enter can commit whatever's highlighted.
  const items: Array<
    | { kind: "group"; g: GroupOption }
    | { kind: "user"; u: UserOption }
    | { kind: "email"; email: string }
  > = [
    ...filteredGroups.map((g) => ({ kind: "group" as const, g })),
    ...filteredUsers.map((u) => ({ kind: "user" as const, u })),
    ...(inviteEmail ? [{ kind: "email" as const, email: inviteEmail }] : []),
  ];
  const firstUserIndex = filteredGroups.length;

  function add(index: number) {
    const it = items[index];
    if (!it) return;
    if (it.kind === "group") onChangeGroups([...selectedGroupIds, it.g.id]);
    else if (it.kind === "user") onChangeUsers([...selectedUserIds, it.u.id]);
    else onChangeGuestEmails?.([...guestEmails, it.email]);
    setQuery("");
    setActiveIndex(0);
    inputRef.current?.focus();
  }

  // Backspace on an empty query peels the most recently added chip — the usual
  // token-field affordance. Chips come off in reverse render order.
  function removeLast() {
    if (guestEmails.length > 0 && onChangeGuestEmails) onChangeGuestEmails(guestEmails.slice(0, -1));
    else if (selectedUserIds.length > 0) onChangeUsers(selectedUserIds.slice(0, -1));
    else if (selectedGroupIds.length > 0) onChangeGroups(selectedGroupIds.slice(0, -1));
  }

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (o) => {
      setOpen(o);
      if (!o) setActiveIndex(null);
    },
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ rects, elements, availableHeight }) {
          Object.assign(elements.floating.style, {
            width: `${rects.reference.width}px`,
            maxHeight: `${Math.min(availableHeight, 288)}px`,
          });
        },
      }),
    ],
  });

  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "listbox" });
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    // The highlight moves without pulling focus off the input.
    virtual: true,
    loop: true,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    dismiss,
    role,
    listNav,
  ]);

  const chip =
    "inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground";
  // Google-style RSVP dot: green accepted, red declined, amber maybe.
  const RSVP_DOT: Record<RsvpStatus, string> = {
    Accepted: "text-green-600",
    Declined: "text-red-600",
    Tentative: "text-amber-500",
    Pending: "text-muted-foreground/40",
  };
  const listId = "participant-list";

  return (
    <>
      {/* One always-present field styled like the app's SearchInput — a leading
          glyph, hairline border, coral focus ring — with the chips living inside
          it, so adding a guest is just typing. The menu is portaled (the modal
          clips overflow) and positioned by floating-ui. */}
      <div
        ref={refs.setReference}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) e.preventDefault();
          setOpen(true);
          inputRef.current?.focus();
        }}
        className={cn(
          "flex min-h-11 cursor-text flex-wrap items-center gap-1.5 border border-border bg-background px-2.5 py-1.5 text-sm transition-shadow focus-within:ring-2 focus-within:ring-accent-coral/30",
          fieldRadius,
        )}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        {selectedGroupIds.map((gid) => {
          const g = groupsById.get(gid);
          if (!g) return null;
          return (
            <span key={`g:${gid}`} className={cn(chip, "bg-os-accent/15 text-os-accent")}>
              <UsersRound className="h-3 w-3" />
              {g.name}
              <button
                type="button"
                onClick={() => onChangeGroups(selectedGroupIds.filter((x) => x !== gid))}
                aria-label={`Remove ${g.name}`}
                className="opacity-60 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        {selectedUserIds.map((uid) => {
          const u = usersById.get(uid);
          if (!u) return null;
          const rsvp = responsesByUserId?.get(uid);
          return (
            <span key={`u:${uid}`} className={chip}>
              {rsvp && (
                <span
                  className={cn("text-[9px] leading-none", RSVP_DOT[rsvp])}
                  title={`RSVP: ${rsvp}`}
                  aria-label={`RSVP: ${rsvp}`}
                >
                  ●
                </span>
              )}
              {userLabel(u)}
              <button
                type="button"
                onClick={() => onChangeUsers(selectedUserIds.filter((x) => x !== uid))}
                aria-label={`Remove ${userLabel(u)}`}
                className="opacity-60 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        {guestEmails.map((email) => (
          <span key={`e:${email}`} className={chip}>
            <Mail className="h-3 w-3 text-muted-foreground" />
            {email}
            <button
              type="button"
              onClick={() => onChangeGuestEmails?.(guestEmails.filter((x) => x !== email))}
              aria-label={`Remove ${email}`}
              className="opacity-60 hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={
            open && activeIndex !== null ? `${listId}-${activeIndex}` : undefined
          }
          aria-autocomplete="list"
          value={query}
          placeholder={
            selectedUserIds.length + selectedGroupIds.length + guestEmails.length === 0
              ? onChangeGuestEmails
                ? "Add guests, a group, or an email"
                : "Add guests or a group"
              : ""
          }
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          {...getReferenceProps({
            onFocus: () => setOpen(true),
            onChange: (e) => {
              setQuery((e.target as HTMLInputElement).value);
              setOpen(true);
              setActiveIndex(0);
            },
            onKeyDown: (e) => {
              if (e.key === "Enter" && open && activeIndex !== null && items[activeIndex]) {
                e.preventDefault();
                add(activeIndex);
              } else if (e.key === "Backspace" && query === "") {
                removeLast();
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            },
          })}
        />
        {resolvedCount + guestEmails.length > 0 && (
          <span className="ml-auto shrink-0 pr-1 text-[11px] text-muted-foreground">
            {resolvedCount + guestEmails.length}{" "}
            {resolvedCount + guestEmails.length === 1 ? "person" : "people"}
          </span>
        )}
      </div>

      {open && (
        <FloatingPortal>
          <ul
            ref={refs.setFloating}
            id={listId}
            style={floatingStyles}
            className={panelClass}
            {...getFloatingProps()}
          >
            {items.length === 0 ? (
              <li className="px-2 py-2 text-xs text-muted-foreground">No matches.</li>
            ) : (
              items.map((it, i) => {
                const isActive = i === activeIndex;
                const startsUsers = it.kind === "user" && i === firstUserIndex && firstUserIndex > 0;
                const startsEmail = it.kind === "email" && i > 0;
                return (
                  <li
                    key={
                      it.kind === "group" ? `g:${it.g.id}` : it.kind === "user" ? `u:${it.u.id}` : `e:${it.email}`
                    }
                    role="none"
                    className={startsUsers || startsEmail ? "mt-1 border-t border-border pt-1" : undefined}
                  >
                    <button
                      type="button"
                      role="option"
                      id={`${listId}-${i}`}
                      aria-selected={isActive}
                      tabIndex={-1}
                      ref={(node) => {
                        listRef.current[i] = node;
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                        isActive ? "bg-os-container" : "hover:bg-os-container",
                      )}
                      {...getItemProps({
                        // The input's blur would otherwise close the panel before
                        // the click could land on the row.
                        onMouseDown: (e) => e.preventDefault(),
                        onClick: () => add(i),
                      })}
                    >
                      {it.kind === "group" ? (
                        <>
                          <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                            <UsersRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            {it.g.name}
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {it.g.memberIds.length} member{it.g.memberIds.length === 1 ? "" : "s"}
                          </span>
                        </>
                      ) : it.kind === "user" ? (
                        <span className="min-w-0 truncate">{userLabel(it.u)}</span>
                      ) : (
                        <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
                          <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          Invite {it.email}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </FloatingPortal>
      )}
    </>
  );
}

// "Find best times" search parameters: candidate starts every 15 min within an
// 8am–9pm band — wide enough for DALI's daytime and evening meetings, tight
// enough that a dead-of-night gap (everyone's calendar is empty at 3am) never
// ranks as "everyone free" — and the top 3 distinct suggestions.
const OPTIMAL_BAND_START_HOUR = 8;
const OPTIMAL_BAND_END_HOUR = 21;
const OPTIMAL_STEP_MINUTES = 15;
const OPTIMAL_MAX_RESULTS = 3;
const OPTIMAL_DURATIONS = [15, 30, 45, 60, 90];
// Bounds for a typed custom length (matches the MCP optimizer's duration range).
const OPTIMAL_MIN_MINUTES = 5;
const OPTIMAL_MAX_MINUTES = 480;

export type SlotSuggestions = { slots: RankedSlot[]; knownCount: number };

// Rank colors for suggestions, shared by the grid's dotted outlines and the
// form's buttons so each time reads as the same suggestion in both places.
// Picked to stay legible over the green availability gradient.
const SUGGESTION_COLORS = [
  { dot: "bg-violet-600 dark:bg-violet-400", border: "border-violet-600 dark:border-violet-400" },
  { dot: "bg-sky-600 dark:bg-sky-400", border: "border-sky-600 dark:border-sky-400" },
  { dot: "bg-amber-500 dark:bg-amber-400", border: "border-amber-500 dark:border-amber-400" },
];

function optimalSlotLabel(s: RankedSlot): string {
  const start = new Date(s.startMs);
  const end = new Date(s.endMs);
  const day = start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time(start)}–${time(end)}`;
}

// The ranked "best times" as clickable pills, colour-matched to the grid's
// dotted outlines (SUGGESTION_COLORS). Picking one fills the meeting's start +
// end. Rendered by whichever surface owns the create form (the create modal),
// fed the grid's suggestions via ScheduleWeekGrid's onSuggestionsChange.
export function OptimalTimePills({
  suggestions,
  selectedStartLocal,
  onPick,
  label = "Best times",
}: {
  suggestions: SlotSuggestions | null;
  selectedStartLocal?: string;
  onPick: (startLocal: string, endLocal: string) => void;
  label?: string;
}) {
  if (!suggestions || suggestions.slots.length === 0) return null;
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.slots.map((s, i) => {
          const active = selectedStartLocal === toDatetimeLocal(new Date(s.startMs));
          return (
            <button
              key={s.startMs}
              type="button"
              onClick={() =>
                onPick(toDatetimeLocal(new Date(s.startMs)), toDatetimeLocal(new Date(s.endMs)))
              }
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium text-foreground transition-colors",
                active ? "border-os-accent bg-os-accent/10" : "border-border bg-background hover:bg-muted/50",
              )}
            >
              <span className={cn("h-2 w-2 shrink-0 rounded-full", SUGGESTION_COLORS[i]?.dot)} />
              <span>{optimalSlotLabel(s)}</span>
              <span className="text-muted-foreground">
                {s.freeCount === suggestions.knownCount
                  ? "All free"
                  : `${s.freeCount}/${suggestions.knownCount} free`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ScheduleWeekGrid({
  participantIds,
  showingSelfOnly = false,
  users,
  workingHours,
  workingHoursEnabled,
  durationMinutes,
  timezone,
  weekStartIso,
  weekEndIso,
  onSelectRange,
  selectedStartLocal,
  selectedEndLocal,
  compact = false,
  hideAvailability = false,
  weekNav,
  enableOptimalTimes = false,
  onSuggestionsChange,
}: {
  participantIds: string[];
  // True when the caller is rendering the current user's own availability
  // (no participants picked yet) — used to relabel the header / legend.
  showingSelfOnly?: boolean;
  users: UserOption[];
  // The viewer's own working hours, used to stripe out non-working hours.
  workingHours: WhDay[];
  // False when the Working Hours feature is off — suppresses the stripes.
  workingHoursEnabled: boolean;
  durationMinutes: number;
  timezone: string;
  weekStartIso: string;
  weekEndIso: string;
  onSelectRange?: (startLocal: string, endLocal: string) => void;
  selectedStartLocal?: string;
  selectedEndLocal?: string;
  /**
   * Reduces per-hour row height substantially for use in space-constrained
   * contexts like the CreateEventModal left panel. Default false — the full
   * MeetingComposer grid is unchanged.
   */
  compact?: boolean;
  /**
   * When true, no availability tint is rendered and no fetch is issued — the
   * grid shows as a plain week skeleton. Used in CreateEventModal when there
   * are no guests (showing self-only availability is not useful). Default false
   * so MeetingComposer is unchanged.
   */
  hideAvailability?: boolean;
  /**
   * Controlled week arrows for the toolbar. Required when the caller owns the
   * week (CreateEventModal); omitted on /calendar, where the arrows navigate
   * `?weekStart=` and the loader supplies the new week.
   */
  weekNav?: { onShift: (weeks: number) => void; onToday: () => void };
  /**
   * Show a "Find best times" control above the grid that ranks the week's slots
   * by participant availability (gated by the `optimal-times` flag at the call
   * site). Off by default so the compact CreateEventModal grid is unchanged.
   */
  enableOptimalTimes?: boolean;
  /** Receives the ranked suggestions whenever they change (null when none apply). */
  onSuggestionsChange?: (s: SlotSuggestions | null) => void;
}) {
  const { panel } = useOsChrome();
  const [data, setData] = useState<GroupAvailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When set (via the participant list under the grid), the grid overlays just
  // this one participant's free intervals so you can read one person's
  // availability at a glance instead of the aggregate gradient.
  const [hoveredUserId, setHoveredUserId] = useState<string | null>(null);
  // Length the "best times" ranking targets; seeds from the meeting's implied
  // duration.
  const [slotMinutes, setSlotMinutes] = useState<number>(() =>
    Number.isInteger(durationMinutes) &&
    durationMinutes >= OPTIMAL_MIN_MINUTES &&
    durationMinutes <= OPTIMAL_MAX_MINUTES
      ? durationMinutes
      : 30,
  );
  // Bumped to force the fetch effect to re-run without changing inputs (manual
  // refresh button + tab-focus refresh).
  const [refreshKey, setRefreshKey] = useState(0);
  const revalidator = useRevalidator();
  const refresh = () => {
    setRefreshKey((k) => k + 1);
    revalidator.revalidate();
  };
  useRefreshOnFocus(refresh);

  // Stable key so the effect only re-fires on a real change. participantIds
  // itself is a fresh array each render — using it as a dep would make this
  // effect cancel+restart every render, leaving "Loading…" stuck on the screen.
  const participantKey = participantIds.slice().sort().join(",");

  useEffect(() => {
    // When hideAvailability is set there's nothing to fetch — clear any stale
    // data immediately so no tints are painted.
    if (hideAvailability) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const ids = participantKey ? participantKey.split(",") : [];
    if (ids.length === 0) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    // durationMinutes is intentionally omitted: it only affects the server's
    // ≥-duration match windows (data.days), which this grid never reads — the
    // gradient and slot breakdown are built from per-user free intervals. Re-
    // fetching on every drag would just flash "Loading availability…".
    fetch("/api/calendar/group-availability", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userIds: ids,
        weekStartIso,
        weekEndIso,
        durationMinutes,
        timezone,
      }),
    })
      .then(async (r) => {
        const json = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setError(json.error ?? "Failed to load availability");
          setData(null);
        } else {
          setData(json as GroupAvailResponse);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantKey, weekStartIso, weekEndIso, timezone, refreshKey, hideAvailability]);

  // Build the 7-day axis from the week window so empty days still render.
  const weekStart = new Date(weekStartIso);
  const days = Array.from({ length: 7 }).map((_, i) => {
    const dayDate = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000);
    return {
      dayOfWeek: dayDate.getUTCDay(),
      num: dayDate.getUTCDate(),
      dateUtc: dayDate,
    };
  });

  // When2Meet-style availability gradient: each 15-min cell is tinted by the
  // fraction of participants free at that time. We render the gradient as the
  // background layer, leaving the Busy blocks out entirely — free vs. busy is
  // already encoded in the cell's saturation.
  const eventsByDay: Record<number, EventBlock[]> = {};
  const CELL_HOURS = SNAP_HOURS; // 10-minute availability cells
  const GRID_START_H = HOURS[0];
  const GRID_END_H = HOURS[HOURS.length - 1] + 1;
  const CELLS_PER_DAY = Math.round((GRID_END_H - GRID_START_H) / CELL_HOURS);

  // Compact mode renders the full-size grid (legible text) inside a scroll
  // container rather than scaling it down; focus the initial scroll around the
  // user's working-hours start (fallback ~7am) so day hours are in view without
  // dropping the ability to scroll to early-morning / late-night slots.
  const compactScrollRef = useRef<HTMLDivElement | null>(null);
  const focusHour = (() => {
    const starts = (workingHours ?? [])
      .flatMap((d) => (d.segments ?? []).map((s) => s.startMinute / 60))
      .filter((h) => Number.isFinite(h));
    const earliest = starts.length ? Math.min(...starts) : 8;
    return Math.max(GRID_START_H, earliest - 1);
  })();
  useEffect(() => {
    if (compact && compactScrollRef.current) {
      compactScrollRef.current.scrollTop = Math.max(0, (focusHour - GRID_START_H) * HOUR_PX);
    }
  }, [compact, weekStartIso, focusHour, GRID_START_H]);

  // A participant is "known" only if we have a real busy source for them (a
  // linked calendar that synced). Without one, their computed `free` is just
  // working-hours-minus-nothing (or a 24/7 default) — NOT confirmed-free.
  // Counting that as free is exactly what made a slot read "11/11 free" when
  // some of those people were actually busy, so we keep unknown participants out
  // of every free count and surface them as their own group instead.
  const isKnown = (userId: string): boolean => {
    const u = data?.perUser.find((p) => p.userId === userId);
    return !!u && u.hasCalendar && !u.calendarError;
  };
  const unknownParticipantIds = participantIds.filter((id) => !isKnown(id));
  const knownCount = participantIds.length - unknownParticipantIds.length;

  // Pre-parse each KNOWN participant's free intervals into sorted (startMs,
  // endMs) tuples for fast containment checks below. Unknown participants are
  // excluded so they never tint a cell as "free".
  const perUserFree: { startMs: number; endMs: number }[][] = data
    ? data.perUser
        .filter((u) => isKnown(u.userId))
        .map((u) =>
          u.free
            .map((iv) => ({
              startMs: new Date(iv.startIso).getTime(),
              endMs: new Date(iv.endIso).getTime(),
            }))
            .sort((a, b) => a.startMs - b.startMs),
        )
    : [];

  // Epoch ms for a wall-clock hour on a grid column, built the same way
  // `dayHourToLocal` builds the selected slot (browser-local Y/M/D + hour).
  // Offsetting from `weekStart` instead only lines up when the week start is
  // exactly local midnight — after week navigation it's UTC midnight, which
  // shifted the tint by the zone offset so a green cell could read "0/N free".
  function cellMs(colIdx: number, hour: number): number {
    const d = days[colIdx].dateUtc;
    const h = Math.floor(hour);
    const mins = Math.round((hour - h) * 60);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, mins).getTime();
  }

  function freeCountAtCell(cellStartMs: number, cellEndMs: number): number {
    let n = 0;
    for (const intervals of perUserFree) {
      let covered = false;
      for (const iv of intervals) {
        if (iv.endMs <= cellStartMs) continue;
        if (iv.startMs > cellStartMs) break;
        if (iv.startMs <= cellStartMs && iv.endMs >= cellEndMs) {
          covered = true;
        }
        break;
      }
      if (covered) n += 1;
    }
    return n;
  }

  // Build per-day cell tints. Each entry is { startHour, durationHours, alpha }
  // ready to render as a colored absolute-positioned block.
  type CellTint = { startHour: number; alpha: number; all: boolean };
  const tintsByColIdx: CellTint[][] = data
    ? days.map((d, colIdx) => {
        const cells: CellTint[] = [];
        for (let i = 0; i < CELLS_PER_DAY; i++) {
          const hour = GRID_START_H + i * CELL_HOURS;
          const cellStartMs = cellMs(colIdx, hour);
          const cellEndMs = cellMs(colIdx, hour + CELL_HOURS);
          const k = freeCountAtCell(cellStartMs, cellEndMs);
          if (k === 0) continue;
          // Denominator is the number of participants we actually have data for,
          // so unknown members don't dilute (or inflate) the shade.
          const alpha = knownCount > 0 ? k / knownCount : 0;
          cells.push({ startHour: hour, alpha, all: knownCount > 0 && k === knownCount });
        }
        // Reference d so the linter doesn't complain (we may use it later).
        void d;
        return cells;
      })
    : [];

  // Per-day free blocks for the single hovered participant. When set, the grid
  // paints these (solid green) instead of the aggregate gradient so the user
  // can read one person's availability at a glance. Each interval is clamped to
  // the visible [GRID_START_H, GRID_END_H) window of its day column.
  const hoveredFreeByColIdx: { startHour: number; durationHours: number }[][] =
    data && hoveredUserId
      ? (() => {
          const free = data.perUser.find((u) => u.userId === hoveredUserId)?.free ?? [];
          const ivs = free
            .map((iv) => ({
              startMs: new Date(iv.startIso).getTime(),
              endMs: new Date(iv.endIso).getTime(),
            }))
            .sort((a, b) => a.startMs - b.startMs);
          return days.map((_, colIdx) => {
            const dayStartMs = cellMs(colIdx, 0);
            const winStartMs = cellMs(colIdx, GRID_START_H);
            const winEndMs = cellMs(colIdx, GRID_END_H);
            const blocks: { startHour: number; durationHours: number }[] = [];
            for (const iv of ivs) {
              const s = Math.max(iv.startMs, winStartMs);
              const e = Math.min(iv.endMs, winEndMs);
              if (e <= s) continue;
              blocks.push({
                startHour: (s - dayStartMs) / 3_600_000,
                durationHours: (e - s) / 3_600_000,
              });
            }
            return blocks;
          });
        })()
      : [];

  // Compute the selected-slot overlay (rendered separately so we can show a
  // hover popover with attending vs. unavailable participants).
  type SelectedSlot = {
    dow: number;
    startHour: number;
    duration: number;
    available: UserOption[];
    busy: UserOption[];
    unknown: UserOption[];
  };
  let selectedSlot: SelectedSlot | null = null;
  if (selectedStartLocal && selectedEndLocal && data && participantIds.length > 0) {
    const sd = new Date(selectedStartLocal);
    const ed = new Date(selectedEndLocal);
    if (!isNaN(sd.getTime()) && !isNaN(ed.getTime()) && ed.getTime() > sd.getTime()) {
      const sameDay = sd.toDateString() === ed.toDateString();
      const dow = sd.getDay();
      const startHour = sd.getHours() + sd.getMinutes() / 60;
      const endHour = ed.getHours() + ed.getMinutes() / 60;
      const duration = sameDay ? endHour - startHour : 24 - startHour;
      if (duration > 0) {
        // A user is "available" if their free intervals cover the entire
        // [sd, ed] window. We allow the union of multiple free intervals.
        const slotStartMs = sd.getTime();
        const slotEndMs = ed.getTime();
        const usersById = new Map(users.map((u) => [u.id, u]));
        const perUserById = new Map(data.perUser.map((p) => [p.userId, p]));
        const available: UserOption[] = [];
        const busy: UserOption[] = [];
        const unknown: UserOption[] = [];
        for (const uid of participantIds) {
          const user = usersById.get(uid) ?? {
            id: uid,
            firstName: uid,
            lastName: "",
            daliEmail: null,
          };
          // No busy source → availability unknown; never counted free or busy.
          if (!isKnown(uid)) {
            unknown.push(user);
            continue;
          }
          const free = perUserById.get(uid)?.free ?? [];
          // Build the contiguous free-coverage over [slotStartMs, slotEndMs].
          // Sort & merge first, then walk.
          const sortedFree = free
            .map((iv) => ({ s: new Date(iv.startIso).getTime(), e: new Date(iv.endIso).getTime() }))
            .sort((a, b) => a.s - b.s);
          let cursor = slotStartMs;
          for (const iv of sortedFree) {
            if (iv.e <= cursor) continue;
            if (iv.s > cursor) break;
            cursor = Math.max(cursor, iv.e);
            if (cursor >= slotEndMs) break;
          }
          if (cursor >= slotEndMs) available.push(user);
          else busy.push(user);
        }
        selectedSlot = { dow, startHour, duration, available, busy, unknown };
      }
    }
  }

  // Best times, ranked from the availability the grid already loaded (see
  // ~/calendar/lib/optimal-times). Recomputed every render so it always matches
  // the current participants / week / length; nothing is auto-applied.
  // perUserFree is already known-only and sorted, and the day anchors come from
  // the same cellMs the gradient uses, so each freeCount matches the "X/N free"
  // the slot shows once picked.
  const suggestions: RankedSlot[] =
    enableOptimalTimes && !hideAvailability && !showingSelfOnly && knownCount > 0
      ? findOptimalSlots({
          dayStartMs: days.map((_, i) => cellMs(i, 0)),
          perUserFree,
          bandStartHour: OPTIMAL_BAND_START_HOUR,
          bandEndHour: OPTIMAL_BAND_END_HOUR,
          stepMinutes: OPTIMAL_STEP_MINUTES,
          durationMinutes: slotMinutes,
          maxResults: OPTIMAL_MAX_RESULTS,
        })
      : [];
  const suggestionsKey = suggestions.map((x) => `${x.startMs}-${x.endMs}-${x.freeCount}`).join(",");
  useEffect(() => {
    onSuggestionsChange?.(suggestions.length > 0 ? { slots: suggestions, knownCount } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionsKey, knownCount]);

  // Length options for the Combobox: the presets, plus the current value when
  // it's a typed custom one so the trigger can still render its label.
  const durationOptions: SelectOption[] = (
    OPTIMAL_DURATIONS.includes(slotMinutes)
      ? OPTIMAL_DURATIONS
      : [...OPTIMAL_DURATIONS, slotMinutes].sort((a, b) => a - b)
  ).map((m) => ({ value: String(m), label: `${m} min` }));

  // Accept a typed whole-minute length within bounds as a custom Combobox row.
  const parseCustomMinutes = (q: string): SelectOption | null => {
    if (!/^\d+$/.test(q)) return null;
    const n = parseInt(q, 10);
    if (n < OPTIMAL_MIN_MINUTES || n > OPTIMAL_MAX_MINUTES) return null;
    return { value: String(n), label: `${n} min` };
  };

  const weekGrid = (
    <WeekGrid
      days={days}
      eventsByDay={eventsByDay}
      showSubHourGrid
      // The availability grid always lives inside a scrollport (the compact
      // preview's own box, or the /calendar composer's scroll section), so pin
      // the weekday header — otherwise it scrolls off and you lose which day
      // each column is.
      stickyHeader
      timezone={timezone}
      backgroundLayer={(dayIdx) => (
        <>
          {!hideAvailability && (
            hoveredUserId ? (
              // One participant's own free intervals (solid green), so the
              // user can read that person's availability at a glance.
              (hoveredFreeByColIdx[dayIdx] ?? []).map((b, i) => (
                <BlockBlock
                  key={`hover-${i}`}
                  topHour={GRID_START_H}
                  startHour={b.startHour}
                  duration={b.durationHours}
                  style={{ backgroundColor: availabilityTint(1) }}
                />
              ))
            ) : (
              /* Aggregate gradient. Drawn first so the stripes layer on top. */
              (tintsByColIdx[dayIdx] ?? []).map((t, i) => (
                <BlockBlock
                  key={`tint-${i}`}
                  topHour={GRID_START_H}
                  startHour={t.startHour}
                  duration={CELL_HOURS}
                  // Reserve the deep end of the ramp for "everyone's free" and
                  // compress partial coverage into the lighter end, so a fully-
                  // free stretch reads as a distinctly bolder band instead of
                  // just a slightly deeper shade of "almost everyone".
                  style={{ backgroundColor: availabilityTint(t.all ? 1 : t.alpha * 0.7) }}
                />
              ))
            )
          )}
          {workingHoursStripeLayer(workingHours, days[dayIdx].dayOfWeek, {
            enabled: workingHoursEnabled,
          })}
        </>
      )}
      overlayLayer={(dayIdx) => {
        const dayStartMs = cellMs(dayIdx, 0);
        const dayEndMs = cellMs(dayIdx, 24);
        return (
          <>
            {suggestions.map((s, i) =>
              s.startMs >= dayStartMs && s.startMs < dayEndMs ? (
                <div
                  key={s.startMs}
                  className={cn(
                    "pointer-events-none absolute left-0.5 right-0.5 z-20 rounded-sm border-2 border-dotted",
                    SUGGESTION_COLORS[i]?.border,
                  )}
                  style={{
                    top: ((s.startMs - dayStartMs) / 3_600_000 - GRID_START_H) * HOUR_PX,
                    height: ((s.endMs - s.startMs) / 3_600_000) * HOUR_PX,
                  }}
                >
                  <span
                    className={cn(
                      "absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold text-white",
                      SUGGESTION_COLORS[i]?.dot,
                    )}
                  >
                    {i + 1}
                  </span>
                </div>
              ) : null,
            )}
            {selectedSlot && days[dayIdx]?.dayOfWeek === selectedSlot.dow && (
              <SelectedSlotBlock
                startHour={selectedSlot.startHour}
                duration={selectedSlot.duration}
                available={selectedSlot.available}
                busy={selectedSlot.busy}
                unknown={selectedSlot.unknown}
              />
            )}
          </>
        );
      }}
      onDayPointerSelect={
        onSelectRange
          ? (dayIdx, startHour, endHour) => {
              const day = days[dayIdx];
              if (!day) return;
              onSelectRange(
                dayHourToLocal(day.dateUtc, startHour),
                dayHourToLocal(day.dateUtc, endHour),
              );
            }
          : undefined
      }
    />
  );

  return (
    <section className={cn(panel, "p-4 flex flex-col", compact && "min-h-0")}>
      <WeekToolbar
        monthLabel={"Schedule preview"}
        weekStartIso={weekStartIso}
        weekNav={weekNav}
        onRefresh={refresh}
        refreshing={loading || revalidator.state !== "idle"}
        legend={
          hideAvailability
            ? undefined
            : showingSelfOnly
              ? [{ swatch: availabilityTint(1), label: "Free" }]
              : [
                  { swatch: availabilityTint(0.33), label: "Few free" },
                  { swatch: availabilityTint(0.66), label: "Some free" },
                  { swatch: availabilityTint(1), label: "All free" },
                ]
        }
      />
      {participantIds.length === 0 ? null : (
        <>
          {!hideAvailability && loading && (
            <div className="px-4 py-1 text-xs text-muted-foreground">Loading availability…</div>
          )}
          {!hideAvailability && error && (
            <div className="px-4 py-2 text-xs text-red-700">{error}</div>
          )}
          {enableOptimalTimes && !hideAvailability && !showingSelfOnly && (
            <div className="mb-3 flex flex-wrap items-center gap-2 px-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Best times for
                <Combobox
                  value={String(slotMinutes)}
                  onChange={(v) => setSlotMinutes(Number(v))}
                  options={durationOptions}
                  allowCustom={parseCustomMinutes}
                  ariaLabel="Meeting length"
                  placeholder="e.g. 45"
                  emptyLabel={`Type ${OPTIMAL_MIN_MINUTES}–${OPTIMAL_MAX_MINUTES} min`}
                  className="w-28 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted/40"
                />
              </label>
              {knownCount === 0 && !loading && (
                <span className="text-xs text-muted-foreground">
                  Add people with a linked calendar to compare availability.
                </span>
              )}
              {data && knownCount > 0 && suggestions.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  No open slots this week for a {slotMinutes}-min meeting.
                </span>
              )}
            </div>
          )}
          {compact ? (
            // Full-size grid in a scroll container (legible text), pre-scrolled
            // to the user's day hours; scroll for early-morning / late slots.
            <div
              ref={compactScrollRef}
              className="w-full min-h-0 flex-1 overflow-y-auto"
              style={{ maxHeight: "26rem" }}
            >
              {weekGrid}
            </div>
          ) : (
            weekGrid
          )}
          {!hideAvailability && !showingSelfOnly && data && participantIds.length > 0 && (
            <ParticipantAvailabilityList
              participantIds={participantIds}
              users={users}
              availableIds={
                selectedSlot ? new Set(selectedSlot.available.map((u) => u.id)) : null
              }
              unknownIds={new Set(unknownParticipantIds)}
              hoveredUserId={hoveredUserId}
              onHover={setHoveredUserId}
            />
          )}
        </>
      )}
    </section>
  );
}

// Per-person availability for the picked slot, listed under the grid. The wide
// panel has room to state the whole answer, so this replaces both the invitee
// roster that used to sit above the grid and the hover popover on the selected
// block. Once a slot is picked the names split into Available / Busy groups;
// before that it's one flat roster. Participants with no linked calendar are
// always split into a separate "No calendar" group so they're never mistaken
// for free. Hovering a known name overlays that person's free intervals.
export function ParticipantAvailabilityList({
  participantIds,
  users,
  availableIds,
  unknownIds,
  hoveredUserId,
  onHover,
}: {
  participantIds: string[];
  users: UserOption[];
  /** Ids free for the whole selected slot, or null when no slot is picked. */
  availableIds: Set<string> | null;
  /** Ids whose availability is unknown (no linked calendar / failed sync).
   *  Slot-independent — surfaced even before a time is picked. */
  unknownIds: Set<string>;
  hoveredUserId: string | null;
  onHover: (userId: string | null) => void;
}) {
  const usersById = new Map(users.map((u) => [u.id, u]));
  const entries = participantIds.map(
    (uid) =>
      usersById.get(uid) ?? { id: uid, firstName: uid, lastName: "", daliEmail: null },
  );
  const unknown = entries.filter((u) => unknownIds.has(u.id));
  const known = entries.filter((u) => !unknownIds.has(u.id));
  const available = availableIds ? known.filter((u) => availableIds.has(u.id)) : [];
  const busy = availableIds ? known.filter((u) => !availableIds.has(u.id)) : [];

  const chip = (user: UserOption, free: boolean | null) => {
    const active = hoveredUserId === user.id;
    return (
      <button
        key={user.id}
        type="button"
        onMouseEnter={() => onHover(user.id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(user.id)}
        onBlur={() => onHover(null)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
          active
            ? "bg-accent-green text-[hsl(203_38%_18%)]"
            : "bg-muted text-muted-foreground hover:bg-muted/70",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            free === null
              ? "bg-muted-foreground/40"
              : free
                ? "bg-green-600 dark:bg-green-400"
                : "bg-red-600 dark:bg-red-400",
          )}
        />
        {userLabel(user)}
      </button>
    );
  };

  // Unknown participants can't be overlaid on the grid (their "free" is just
  // working hours, not real availability), so these are plain, non-hoverable
  // chips with a hollow gray dot.
  const unknownChip = (user: UserOption) => (
    <span
      key={user.id}
      title="No calendar connected — availability unknown"
      className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full border border-muted-foreground/50"
      />
      {userLabel(user)}
    </span>
  );

  const group = (label: string, members: UserOption[], free: boolean) =>
    members.length === 0 ? null : (
      <div>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label} · {members.length}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {members.map((u) => chip(u, free))}
        </div>
      </div>
    );

  const unknownGroup =
    unknown.length === 0 ? null : (
      <div>
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          No calendar · {unknown.length}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {unknown.map((u) => unknownChip(u))}
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground/80">
          Availability unknown — not counted as free.
        </div>
      </div>
    );

  return (
    <div className="mt-3 flex flex-col gap-2.5 border-t border-border px-2 pt-3">
      {availableIds ? (
        <>
          {group("Available", available, true)}
          {group("Busy", busy, false)}
          {unknownGroup}
        </>
      ) : (
        <>
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Pick a time to see who&apos;s free
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {known.map((u) => chip(u, null))}
            </div>
          </div>
          {unknownGroup}
        </>
      )}
    </div>
  );
}

export function SelectedSlotBlock({
  startHour,
  duration,
  available,
  busy,
  unknown,
}: {
  startHour: number;
  duration: number;
  available: UserOption[];
  busy: UserOption[];
  unknown: UserOption[];
}) {
  // "known" = participants we can actually judge. Everyone-free is only claimed
  // when every known participant is free AND no one is unaccounted-for.
  const known = available.length + busy.length;
  const everyoneFree = known > 0 && busy.length === 0 && unknown.length === 0;
  const top = (startHour - HOURS[0]) * HOUR_PX;
  const height = duration * HOUR_PX;
  return (
    <div
      className={cn(
        "absolute left-0 right-0 z-30 rounded-sm border-2",
        everyoneFree
          ? "border-green-600 bg-green-500/15 dark:border-green-400"
          : "border-os-accent bg-os-accent/10",
      )}
      style={{ top, height }}
    >
      <div
        className={cn(
          "m-1 inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold shadow-sm",
          everyoneFree ? "bg-green-600 text-white dark:bg-green-500" : "bg-os-accent text-os-bg",
        )}
      >
        {everyoneFree ? (
          <>
            <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden fill="none">
              <path
                d="M2.5 6.4l2.4 2.4 4.6-5.2"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Everyone&apos;s free
          </>
        ) : known === 0 ? (
          <span>{unknown.length} no calendar</span>
        ) : (
          <>
            <span>
              {available.length}/{known} free
            </span>
            {unknown.length > 0 && (
              <span className="font-normal opacity-80">· {unknown.length} no calendar</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
