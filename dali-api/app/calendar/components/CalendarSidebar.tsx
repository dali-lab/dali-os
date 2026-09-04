import { useState } from "react";
import { useRevalidator } from "react-router";
import { Check, ChevronDown, ChevronRight, Clock3, Search, Settings2, X } from "lucide-react";
import { cn } from "~/lib/cn";
import { MiniMonth } from "~/calendar/components/MiniMonth";
import { roleColor } from "~/calendar/lib/event-block";
import { CustomHiresManager, archiveCustomHire } from "~/calendar/components/CustomHiresManager";
import { userLabel } from "~/calendar/components/scheduling";
import type { CalendarLinkDTO, LoaderData } from "~/calendar/lib/types";
import type { LayerVisibility } from "~/calendar/lib/layers";
import type { RoleInstance } from "~/lib/roles";

// The Events page's left rail, Google-Calendar shaped: the month navigator on
// top, then one foldable group per linked account listing its calendars.
//
// These checkboxes only control what the grid *draws* (the `hiddenCals` set,
// persisted to localStorage). Which calendars count toward availability, and
// which one is the main write target, stay on the Availability tab — this rail
// is for looking, not configuring.

/** One checkbox row: colour swatch + name. Shared by real sub-calendars and the
 *  built-in overlays below them, so a toggle reads the same wherever it came
 *  from. */
function CalendarRow({
  label,
  color,
  checked,
  onToggle,
}: {
  label: string;
  color: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/50"
    >
      <span
        className={cn(
          "flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border-2 transition-colors",
          checked ? "text-white" : "bg-transparent",
        )}
        style={{ borderColor: color, backgroundColor: checked ? color : undefined }}
      >
        {checked && <Check className="h-3 w-3 stroke-[3]" />}
      </span>
      <span className={cn("min-w-0 flex-1 truncate text-sm", checked ? "text-foreground" : "text-muted-foreground")}>
        {label}
      </span>
    </button>
  );
}

function AccountGroup({
  link,
  hiddenCals,
  toggleHiddenCal,
}: {
  link: CalendarLinkDTO;
  hiddenCals: Set<string>;
  toggleHiddenCal: (id: string) => void;
}) {
  // Folded by default: with several linked accounts the rail is otherwise a
  // wall of sub-calendars, and the checkboxes are a rarely-touched control.
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  const subs = link.subCalendars ?? [];

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-sm font-semibold text-foreground hover:bg-muted/50"
      >
        <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{link.displayName || link.externalEmail}</span>
      </button>

      {open && (
        <ul className="flex flex-col gap-0.5 pl-2">
          {subs.length === 0 && (
            <li className="px-2 py-1 text-xs italic text-muted-foreground">No calendars.</li>
          )}
          {subs.map((sub) => (
            <li key={sub.id}>
              <CalendarRow
                label={sub.primary ? "Primary" : sub.summary}
                color={sub.color ?? "#9ca3af"}
                checked={!hiddenCals.has(sub.id)}
                onToggle={() => toggleHiddenCal(sub.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Google's "Meet with…" box. Picking someone opens the create modal with them
 *  invited rather than filtering the grid, so the next step is scheduling. */
function MeetWith({
  users,
  onPick,
}: {
  users: LoaderData["users"];
  onPick: (userId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = q
    ? users
        .filter(
          (u) =>
            `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
            (u.daliEmail ?? "").toLowerCase().includes(q),
        )
        .slice(0, 8)
    : [];

  return (
    <div className="flex flex-col gap-1">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Meet with
      </h2>
      <div className="relative">
        {/* Same field dress as the rest of the app — a filled slab read as a
            separate surface against the rail's bare ground. */}
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 transition-colors focus-within:border-os-accent">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for people"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        {matches.length > 0 && (
          <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-56 overflow-y-auto rounded-lg cal-surface p-1">
            {matches.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  onPick(u.id);
                  setQuery("");
                }}
                className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60"
              >
                {userLabel(u)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The colours a role can be assigned. A fixed set keeps the grid legible —
 *  free-form hex would let someone pick something unreadable on either theme. */
const ROLE_SWATCHES = [
  "#7fb3e0", "#a68cf0", "#7fcfc3", "#f2b84b",
  "#fd9999", "#9fe0a8", "#e08ac0", "#8a8a94",
];

/** One role: a swatch that opens the palette, the role's name, its hours this
 *  pay period, and — for a self-added job only — a remove button. */
function RoleRow({
  label,
  color,
  hours,
  onPick,
  onDelete,
}: {
  label: string;
  color: string;
  hours: number;
  onPick: (hex: string) => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="group relative flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Change colour for ${label}`}
        className="h-[15px] w-[15px] shrink-0 rounded-[4px] ring-1 ring-inset ring-black/15"
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{label}</span>
      {/* Fixed width + right alignment so the totals read as a column, and a
          reserved slot for the remove button so a deletable row doesn't shove
          its hours left of the rows above it. */}
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {hours.toFixed(1)}h
      </span>
      <span className="flex w-4 shrink-0 justify-end">
        {onDelete && (
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
            aria-label={`Remove ${label}`}
            title="Remove this job"
            className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
      {open && (
        <div className="absolute left-0 top-[calc(100%+2px)] z-40 grid grid-cols-4 gap-1.5 rounded-lg cal-surface p-2">
          {ROLE_SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              aria-label={hex}
              onClick={() => {
                onPick(hex);
                setOpen(false);
              }}
              className="h-5 w-5 rounded-[4px] ring-1 ring-inset ring-black/15"
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function CalendarSidebar({
  data,
  focusDate,
  onPickDate,
  hiddenCals,
  toggleHiddenCal,
  layers,
  onToggleTimesheet,
  myRoles,
  roleColors,
  roleHours,
  setRoleColor,
  onManage,
  onMeetWith,
}: {
  data: LoaderData;
  focusDate: Date;
  onPickDate: (dateUtc: Date) => void;
  hiddenCals: Set<string>;
  toggleHiddenCal: (id: string) => void;
  layers: LayerVisibility;
  /** Flips the grid between events and logged time. */
  onToggleTimesheet: () => void;
  myRoles: RoleInstance[];
  roleColors: Record<string, string>;
  /** Hours logged against each role this pay period, keyed like the colours. */
  roleHours: Record<string, number>;
  setRoleColor: (roleKey: string, hex: string) => void;
  /** Opens the create modal with this person already invited, on the current
   *  week, so their availability is on screen immediately. */
  onMeetWith: (userId: string) => void;
  /** Opens the full calendars panel — connecting accounts, the main calendar,
   *  and what counts toward availability all live there, not in this rail. */
  onManage: () => void;
}) {
  const revalidator = useRevalidator();
  const links = data.calendarLinks.filter((l) => l.enabled);

  return (
    <aside className="hidden w-60 min-w-0 shrink-0 flex-col gap-5 overflow-x-hidden overflow-y-auto lg:flex">
      <MiniMonth focusDate={focusDate} timezone={data.timezone} onPick={onPickDate} />

      <MeetWith users={data.users} onPick={onMeetWith} />

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1 px-1 pb-1">
          <h2 className="flex-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            My calendars
          </h2>
          <button
            type="button"
            onClick={onManage}
            aria-label="Manage calendars"
            title="Connect and manage calendars"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
        {links.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">
            No calendars linked yet.
          </p>
        ) : (
          links.map((link) => (
            <AccountGroup
              key={link.id}
              link={link}
              hiddenCals={hiddenCals}
              toggleHiddenCal={toggleHiddenCal}
            />
          ))
        )}

      </div>

      {/* Timesheet is a way of *looking* at the grid, not a calendar to overlay,
          so it's a mode button rather than another checkbox. */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onToggleTimesheet}
          aria-pressed={layers.logged}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
            layers.logged
              ? "border-os-accent/40 bg-os-accent/10 text-os-accent"
              : "border-border text-foreground hover:bg-muted",
          )}
        >
          <Clock3 className="h-4 w-4" />
          {layers.logged ? "Viewing timesheet" : "View timesheet"}
        </button>

        {layers.logged && (
          <>
            <ul className="flex flex-col gap-0.5">
              {myRoles.map((r) => {
                const key = `${r.assignmentType}:${r.roleRefId}`;
                return (
                  <li key={key}>
                    <RoleRow
                      label={r.label}
                      color={roleColors[key] ?? roleColor(key).dot}
                      hours={roleHours[key] ?? 0}
                      onPick={(hex) => setRoleColor(key, hex)}
                      // Only a job you added yourself can be removed — a DALI
                      // assignment comes from staffing, not from this list.
                      onDelete={
                        r.assignmentType === "Custom"
                          ? async () => {
                              await archiveCustomHire(r.roleRefId);
                              revalidator.revalidate();
                            }
                          : undefined
                      }
                    />
                  </li>
                );
              })}
            </ul>
            <CustomHiresManager
              hires={myRoles
                .filter((r) => r.assignmentType === "Custom")
                .map((r) => ({ id: r.roleRefId, label: r.label }))}
            />
          </>
        )}
      </div>
    </aside>
  );
}
