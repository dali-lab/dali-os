import { redirect, useLoaderData } from "react-router";
import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Calendar as CalendarIcon,
  Clock,
  Shield,
  CalendarDays,
  Building2,
  Wifi,
  Copy,
  ChevronDown,
} from "lucide-react";
import { requireAuth, withAuth } from "~/lib/auth";
import type { Route } from "./+types/calendar";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));
  if (auth.user.type === "applicant") return withAuth(auth, redirect("/portal"));
  return withAuth(auth, { user: auth.user });
}

type Tab = "availability" | "schedule";

export default function CalendarPage() {
  useLoaderData<typeof loader>();
  const [tab, setTab] = useState<Tab>("availability");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <PillButton active={tab === "availability"} onClick={() => setTab("availability")}>
          My Availability
        </PillButton>
        <PillButton active={tab === "schedule"} onClick={() => setTab("schedule")}>
          Schedule Meeting
        </PillButton>
      </div>

      {tab === "availability" ? <AvailabilityView /> : <ScheduleView />}
    </div>
  );
}

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${
        active
          ? "bg-accent-coral text-white"
          : "text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Availability view                                                   */
/* ------------------------------------------------------------------ */

function AvailabilityView() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
      <aside className="flex flex-col gap-6">
        <header>
          <h1 className="font-heading text-2xl font-bold text-foreground">Availability</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure when you're available for meetings and pairing.
          </p>
        </header>
        <CalendarIntegrationsCard />
        <WorkingHoursCard />
        <EventBuffersCard />
        <ManualBlocksCard />
      </aside>
      <AvailabilityWeekGrid />
    </div>
  );
}

function CalendarIntegrationsCard() {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <CalendarDays className="w-4 h-4 text-accent-coral" />
          Calendar Integrations
        </h2>
        <button
          type="button"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-border hover:bg-muted transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Account
        </button>
      </div>
      <div className="flex flex-col gap-3">
        <ProviderBlock
          accent="border-l-accent-teal"
          headerBg="bg-accent-teal/10"
          icon={<GoogleIcon />}
          name="Google Calendar"
          calendars={[
            { name: "Work", color: "bg-accent-teal", enabled: true },
            { name: "Personal", color: "bg-accent-pink", enabled: false },
            { name: "DALI Lab", color: "bg-accent-green", enabled: true },
          ]}
        />
        <ProviderBlock
          accent="border-l-dark-blue"
          headerBg="bg-muted"
          icon={<AppleIcon />}
          name="Apple Calendar"
          calendars={[
            { name: "Personal", color: "bg-accent-pink", enabled: true },
            { name: "Birthdays", color: "bg-accent-yellow", enabled: false },
          ]}
        />
        <ProviderBlock
          accent="border-l-accent-green"
          headerBg="bg-accent-green/10"
          icon={<OutlookIcon />}
          name="Outlook"
          calendars={[{ name: "Dartmouth", color: "bg-accent-green", enabled: true }]}
        />
      </div>
    </section>
  );
}

function ProviderBlock({
  accent,
  headerBg,
  icon,
  name,
  calendars,
}: {
  accent: string;
  headerBg: string;
  icon: React.ReactNode;
  name: string;
  calendars: { name: string; color: string; enabled: boolean }[];
}) {
  return (
    <div className={`bg-card border border-border border-l-4 ${accent} rounded-md overflow-hidden`}>
      <div className={`flex items-center justify-between px-3 py-2 ${headerBg}`}>
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-semibold text-sm text-foreground">{name}</span>
        </div>
        <button
          type="button"
          aria-label={`Remove ${name}`}
          className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="px-3 py-3 flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">Select which calendars should block your availability:</p>
        {calendars.map((c) => (
          <CalendarRow key={c.name} {...c} />
        ))}
      </div>
    </div>
  );
}

function CalendarRow({ name, color, enabled }: { name: string; color: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  return (
    <button
      type="button"
      onClick={() => setOn((v) => !v)}
      className="flex items-center justify-between text-left hover:bg-muted/50 rounded-md px-1 py-1 transition-colors"
    >
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${color}`} />
        <span className="text-sm text-foreground">{name}</span>
      </div>
      <span
        className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
          on
            ? "bg-accent-coral border-accent-coral text-white"
            : "border-border bg-background"
        }`}
      >
        {on && (
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M3 8.5l3.5 3.5L13 5" />
          </svg>
        )}
      </span>
    </button>
  );
}

function WorkingHoursCard() {
  const days = [
    { key: "Mon", enabled: true },
    { key: "Tue", enabled: true },
    { key: "Wed", enabled: true },
    { key: "Thu", enabled: true },
    { key: "Fri", enabled: true },
    { key: "Sat", enabled: false },
    { key: "Sun", enabled: false },
  ];
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <Clock className="w-4 h-4 text-accent-coral" />
          Working Hours
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground"
          >
            <Copy className="w-3 h-3" />
            Weekdays
          </button>
          <button
            type="button"
            aria-label="Reset"
            className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="bg-card border border-border rounded-md p-3 flex flex-col gap-2">
        {days.map((d) => (
          <DayRow key={d.key} day={d.key} enabled={d.enabled} />
        ))}
      </div>
    </section>
  );
}

function DayRow({ day, enabled }: { day: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [loc, setLoc] = useState<"in" | "remote">("in");
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOn((v) => !v)}
        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${
          on ? "bg-accent-coral border-accent-coral text-white" : "border-border bg-background"
        }`}
        aria-label={`${day} enabled`}
      >
        {on && (
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M3 8.5l3.5 3.5L13 5" />
          </svg>
        )}
      </button>
      <span className="text-sm font-medium text-foreground w-9">{day}</span>
      {on ? (
        <>
          <TimeField defaultValue="09:00 AM" />
          <span className="text-muted-foreground text-sm">–</span>
          <TimeField defaultValue="05:00 PM" />
          <div className="flex items-center gap-0.5 ml-auto">
            <LocButton active={loc === "in"} onClick={() => setLoc("in")} icon={<Building2 className="w-3.5 h-3.5" />} />
            <LocButton active={loc === "remote"} onClick={() => setLoc("remote")} icon={<Wifi className="w-3.5 h-3.5" />} />
          </div>
        </>
      ) : (
        <span className="text-sm text-muted-foreground italic ml-1">Unavailable</span>
      )}
    </div>
  );
}

function TimeField({ defaultValue }: { defaultValue: string }) {
  return (
    <div className="relative">
      <input
        type="text"
        defaultValue={defaultValue}
        className="w-[88px] pl-2 pr-6 py-1 text-xs border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
      />
      <Clock className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
    </div>
  );
}

function LocButton({ active, onClick, icon }: { active: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-1.5 rounded-md transition-colors ${
        active ? "bg-accent-coral/20 text-accent-coral" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {icon}
    </button>
  );
}

function EventBuffersCard() {
  const options = ["None", "5m", "10m", "15m", "30m", "45m", "60m"];
  const [selected, setSelected] = useState("15m");
  return (
    <section>
      <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground mb-3">
        <Shield className="w-4 h-4 text-accent-coral" />
        Event Buffers
      </h2>
      <div className="bg-card border border-border rounded-md p-3">
        <p className="text-xs text-muted-foreground mb-3">
          Add padding around all calendar and manual events so you're never booked back-to-back.
        </p>
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setSelected(o)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                selected === o
                  ? "bg-accent-coral text-white"
                  : "bg-background text-foreground border border-border hover:bg-muted"
              }`}
            >
              {o}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          {selected === "None"
            ? "No buffer will be added between events."
            : `A ${selected.replace("m", "-minute")} buffer will be added before and after every event.`}
        </p>
      </div>
    </section>
  );
}

function ManualBlocksCard() {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <CalendarIcon className="w-4 h-4 text-accent-coral" />
          Manual Blocks
        </h2>
        <button
          type="button"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-border hover:bg-muted transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Block
        </button>
      </div>
      <div className="flex flex-col gap-2">
        <div className="bg-card border border-border border-l-4 border-l-accent-coral rounded-md px-3 py-2 flex items-start justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">Dentist</div>
            <div className="text-xs text-muted-foreground mt-0.5">2026-05-11 · 13:00 – 14:30</div>
          </div>
          <button
            type="button"
            aria-label="Remove block"
            className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Week grids                                                          */
/* ------------------------------------------------------------------ */

function WeekToolbar({ legend }: { legend: { color: string; label: string }[] }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-3">
        <h2 className="font-heading text-lg font-bold text-foreground">May 2026</h2>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous week" className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" className="px-3 py-1 text-xs font-semibold rounded-md border border-border hover:bg-muted transition-colors">
            Today
          </button>
          <button type="button" aria-label="Next week" className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {legend.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            <span className={`inline-block w-3 h-3 rounded-sm ${l.color}`} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const DAYS = [
  { key: "SUN", num: 10 },
  { key: "MON", num: 11 },
  { key: "TUE", num: 12 },
  { key: "WED", num: 13 },
  { key: "THU", num: 14 },
  { key: "FRI", num: 15 },
  { key: "SAT", num: 16 },
];

const HOUR_PX = 56;

function hoursBetween(startHour: number, endHour: number, startMin = 0, endMin = 0) {
  return endHour - startHour + (endMin - startMin) / 60;
}

function AvailabilityWeekGrid() {
  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col">
      <WeekToolbar
        legend={[
          { color: "bg-accent-green", label: "Available" },
          { color: "bg-muted", label: "Outside Hours" },
          { color: "bg-accent-yellow", label: "Buffer" },
          { color: "bg-accent-coral", label: "Busy" },
        ]}
      />
      <WeekGrid
        showProviderRow
        backgroundLayer={(dayIdx) => {
          const isWeekend = dayIdx === 0 || dayIdx === 6;
          if (isWeekend) return <DayBg style={STRIPE_STYLE} />;
          return (
            <>
              {/* before 9am */}
              <BlockBlock topHour={8} startHour={8} duration={1} style={STRIPE_STYLE} />
              {/* after 5pm */}
              <BlockBlock topHour={8} startHour={17} duration={3} style={STRIPE_STYLE} />
              {/* working hours wash */}
              <BlockBlock topHour={8} startHour={9} duration={8} className="bg-accent-green/20 dark:bg-accent-green/15" />
            </>
          );
        }}
        eventsByDay={availabilityEvents}
      />
    </section>
  );
}

// Hard-coded dark text that doesn't flip in dark mode (the dark-blue token does).
const EVENT_TEXT = "text-[hsl(203_38%_18%)]";
const EVENT_CORAL = `bg-accent-coral-light ${EVENT_TEXT}`;
const EVENT_GREEN = `bg-accent-green ${EVENT_TEXT}`;
const EVENT_TEAL = `bg-accent-teal ${EVENT_TEXT}`;
const MATCH_CLS = `bg-accent-coral-light ${EVENT_TEXT}`;
const NEAR_MISS_CLS = `bg-accent-green ${EVENT_TEXT}`;

const BUFFER = 0.25; // 15 minutes

const availabilityEvents: Record<number, EventBlock[]> = {
  1: [
    {
      startHour: 13,
      duration: 1.5,
      label: "Dentist",
      className: EVENT_CORAL,
      borderClassName: "border-accent-coral-light",
      bufferClassName: "bg-accent-coral-light/30",
      bufferBefore: BUFFER,
      bufferAfter: BUFFER,
    },
  ],
  2: [
    {
      startHour: 16,
      duration: 2,
      label: "DALI Lab",
      className: EVENT_GREEN,
      borderClassName: "border-accent-green",
      bufferClassName: "bg-accent-green/30",
      bufferBefore: BUFFER,
      bufferAfter: BUFFER,
    },
  ],
  3: [
    {
      startHour: 10,
      duration: 2,
      label: "Work",
      className: EVENT_TEAL,
      borderClassName: "border-accent-teal",
      bufferClassName: "bg-accent-teal/30",
      bufferBefore: BUFFER,
      bufferAfter: BUFFER,
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Schedule view                                                       */
/* ------------------------------------------------------------------ */

type PersonRow = { id: string; label: string };
type GroupRow = { id: string; mode: "ALL" | "ANY" | "ATLEAST"; n: number; people: PersonRow[] };

function ScheduleView() {
  const [outer, setOuter] = useState<{ mode: "ALL" | "ANY"; rows: (PersonRow | GroupRow)[] }>({
    mode: "ALL",
    rows: [
      { id: "p1", label: "Carol (PM)" },
      {
        id: "g1",
        mode: "ATLEAST",
        n: 1,
        people: [
          { id: "p2", label: "Bob (Developer)" },
          { id: "p3", label: "Dave (Developer)" },
        ],
      },
    ],
  });

  const addPersonToOuter = () =>
    setOuter((s) => ({ ...s, rows: [...s.rows, { id: rid(), label: "New person" }] }));
  const addGroupToOuter = () =>
    setOuter((s) => ({ ...s, rows: [...s.rows, { id: rid(), mode: "ATLEAST", n: 1, people: [] }] }));
  const removeOuterRow = (id: string) =>
    setOuter((s) => ({ ...s, rows: s.rows.filter((r) => r.id !== id) }));
  const addPersonToGroup = (groupId: string) =>
    setOuter((s) => ({
      ...s,
      rows: s.rows.map((r) =>
        "people" in r && r.id === groupId ? { ...r, people: [...r.people, { id: rid(), label: "New person" }] } : r,
      ),
    }));
  const removePersonFromGroup = (groupId: string, personId: string) =>
    setOuter((s) => ({
      ...s,
      rows: s.rows.map((r) =>
        "people" in r && r.id === groupId ? { ...r, people: r.people.filter((p) => p.id !== personId) } : r,
      ),
    }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
      <aside className="flex flex-col gap-4">
        <header>
          <h1 className="font-heading text-2xl font-bold text-foreground">Schedule Meeting</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Build complex availability rules to find the perfect time.
          </p>
        </header>
        <div>
          <h2 className="font-heading font-semibold text-foreground mb-3">Who needs to be there?</h2>
          <div className="bg-card border border-border border-l-4 border-l-accent-coral rounded-md p-3 flex flex-col gap-2">
            <ModeDropdown
              value={outer.mode === "ALL" ? "ALL of these (AND)" : "ANY of these (OR)"}
            />
            {outer.rows.map((row) =>
              "people" in row ? (
                <GroupRowView
                  key={row.id}
                  row={row}
                  onRemove={() => removeOuterRow(row.id)}
                  onAddPerson={() => addPersonToGroup(row.id)}
                  onRemovePerson={(pid) => removePersonFromGroup(row.id, pid)}
                />
              ) : (
                <PersonRowView key={row.id} label={row.label} onRemove={() => removeOuterRow(row.id)} />
              ),
            )}
            <div className="flex items-center gap-2 pt-1">
              <AddBtn label="Add Person" onClick={addPersonToOuter} />
              <AddBtn label="Add Group" onClick={addGroupToOuter} />
            </div>
          </div>
        </div>
      </aside>
      <ScheduleWeekGrid />
    </div>
  );
}

function rid() {
  return Math.random().toString(36).slice(2, 9);
}

function ModeDropdown({ value }: { value: string }) {
  return (
    <button
      type="button"
      className="w-fit inline-flex items-center justify-between gap-2 px-3 py-1.5 text-sm font-medium border border-border rounded-md bg-background hover:bg-muted transition-colors"
    >
      <span>{value}</span>
      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
    </button>
  );
}

function PersonRowView({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="flex-1 inline-flex items-center justify-between gap-2 px-3 py-1.5 text-sm font-medium border border-border rounded-md bg-background hover:bg-muted transition-colors"
      >
        <span>{label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function GroupRowView({
  row,
  onRemove,
  onAddPerson,
  onRemovePerson,
}: {
  row: GroupRow;
  onRemove: () => void;
  onAddPerson: () => void;
  onRemovePerson: (id: string) => void;
}) {
  return (
    <div className="border-l-2 border-accent-coral pl-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center justify-between gap-2 px-2.5 py-1 text-xs font-medium border border-border rounded-md bg-background hover:bg-muted transition-colors"
        >
          <span>AT LEAST N of these</span>
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        </button>
        <input
          type="number"
          defaultValue={row.n}
          min={1}
          className="w-12 px-2 py-1 text-xs border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
        <span className="text-xs text-muted-foreground">people</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove group"
          className="ml-auto p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {row.people.map((p) => (
        <PersonRowView key={p.id} label={p.label} onRemove={() => onRemovePerson(p.id)} />
      ))}
      <div className="flex items-center gap-2 pt-0.5">
        <AddBtn label="Add Person" onClick={onAddPerson} size="sm" />
        <AddBtn label="Add Group" onClick={() => {}} size="sm" />
      </div>
    </div>
  );
}

function AddBtn({ label, onClick, size = "md" }: { label: string; onClick: () => void; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md border border-border text-foreground hover:bg-muted transition-colors ${
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs font-medium"
      }`}
    >
      <Plus className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
      {label}
    </button>
  );
}

function ScheduleWeekGrid() {
  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col">
      <WeekToolbar
        legend={[
          { color: "bg-accent-coral", label: "Match (24)" },
          { color: "bg-accent-green", label: "Near Miss (24)" },
        ]}
      />
      <WeekGrid eventsByDay={scheduleEvents} />
    </section>
  );
}

const scheduleEvents: Record<number, EventBlock[]> = {
  2: [
    // Tue
    { startHour: 9, duration: 1.5, label: "~50% match", className: NEAR_MISS_CLS, borderClassName: "border-accent-green" },
    { startHour: 10.5, duration: 1, label: "✓ Available", className: MATCH_CLS },
    { startHour: 13, duration: 1, label: "✓ Available", className: MATCH_CLS },
    { startHour: 14, duration: 3, label: "✓ Available", className: MATCH_CLS },
  ],
  3: [
    // Wed
    { startHour: 9, duration: 2.5, label: "~50% match", className: NEAR_MISS_CLS, borderClassName: "border-accent-green" },
    { startHour: 12.5, duration: 1.5, label: "~50% match", className: NEAR_MISS_CLS, borderClassName: "border-accent-green" },
    { startHour: 14, duration: 1, label: "✓ Available", className: MATCH_CLS },
  ],
  4: [
    // Thu
    { startHour: 9, duration: 1.5, label: "~50% match", className: NEAR_MISS_CLS, borderClassName: "border-accent-green" },
    { startHour: 10.5, duration: 1, label: "✓ Available", className: MATCH_CLS },
    { startHour: 12.5, duration: 1.5, label: "~50% match", className: NEAR_MISS_CLS, borderClassName: "border-accent-green" },
    { startHour: 14, duration: 1.5, label: "~50% match", className: NEAR_MISS_CLS, borderClassName: "border-accent-green" },
    { startHour: 15.5, duration: 1.5, label: "~50% match", className: NEAR_MISS_CLS, borderClassName: "border-accent-green" },
  ],
};

/* ------------------------------------------------------------------ */
/* Week grid primitives                                                */
/* ------------------------------------------------------------------ */

type EventBlock = {
  startHour: number;
  duration: number;
  label: string;
  /** Tailwind classes for the colored body (bg + text). */
  className: string;
  /** Border color class for the outer wrapper (defaults to matching the body). */
  borderClassName?: string;
  /** Background tint for the buffer strip + frame (e.g. "bg-accent-coral/25"). */
  bufferClassName?: string;
  /** Hours of buffer above the event body. */
  bufferBefore?: number;
  /** Hours of buffer below the event body. */
  bufferAfter?: number;
};

function WeekGrid({
  eventsByDay,
  backgroundLayer,
  showProviderRow = false,
}: {
  eventsByDay: Record<number, EventBlock[]>;
  backgroundLayer?: (dayIdx: number) => React.ReactNode;
  showProviderRow?: boolean;
}) {
  return (
    <div className="flex border border-border rounded-md overflow-hidden">
      {/* Hour axis */}
      <div className="flex flex-col w-14 border-r border-border bg-card text-[11px] text-muted-foreground">
        <div className={showProviderRow ? "h-16 border-b border-border" : "h-9 border-b border-border"} />
        {HOURS.map((h) => (
          <div key={h} style={{ height: HOUR_PX }} className="px-2 pt-1 text-right">
            {formatHour(h)}
          </div>
        ))}
      </div>
      {/* Day columns */}
      {DAYS.map((d, idx) => (
        <div key={d.key} className="flex-1 min-w-0 border-r last:border-r-0 border-border flex flex-col">
          <div className={`flex flex-col items-center justify-center border-b border-border ${showProviderRow ? "h-16" : "h-9"}`}>
            <div className="text-[10px] font-semibold text-muted-foreground tracking-wide">{d.key}</div>
            <div className="text-sm font-bold text-foreground">{d.num}</div>
            {showProviderRow && (
              <div className="flex items-center gap-0.5 mt-0.5 text-muted-foreground/50">
                <Building2 className="w-2.5 h-2.5" />
                <Wifi className="w-2.5 h-2.5" />
              </div>
            )}
          </div>
          <div className="relative" style={{ height: HOURS.length * HOUR_PX }}>
            {/* gridlines */}
            {HOURS.map((_, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 border-t border-border/60"
                style={{ top: i * HOUR_PX }}
              />
            ))}
            {/* background layer (working hours / weekend) */}
            {backgroundLayer?.(idx)}
            {/* events */}
            {(eventsByDay[idx] ?? []).map((e, i) => {
              const bufferBefore = e.bufferBefore ?? 0;
              const bufferAfter = e.bufferAfter ?? 0;
              const totalHours = bufferBefore + e.duration + bufferAfter;
              const border = e.borderClassName ?? "border-accent-coral-light";
              const bufferBg = e.bufferClassName ?? "";
              return (
                <div
                  key={i}
                  className={`absolute left-0 right-0 border-2 ${border} ${bufferBg} overflow-hidden`}
                  style={{
                    top: (e.startHour - bufferBefore - HOURS[0]) * HOUR_PX,
                    height: totalHours * HOUR_PX,
                  }}
                >
                  <div
                    className={`absolute left-0 right-0 px-1.5 py-1 text-[11px] font-medium overflow-hidden ${e.className}`}
                    style={{
                      top: bufferBefore * HOUR_PX,
                      height: e.duration * HOUR_PX,
                    }}
                  >
                    {e.label && <span className="truncate block">{e.label}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatHour(h: number) {
  if (h === 12) return "12 PM";
  if (h === 0) return "12 AM";
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}

const STRIPE_STYLE: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, rgba(120,120,120,0.35) 0 6px, transparent 6px 12px)",
  backgroundColor: "rgba(120,120,120,0.25)",
};

function DayBg({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`absolute inset-0 ${className ?? ""}`} style={style} />;
}

function BlockBlock({
  topHour,
  startHour,
  duration,
  className,
  style,
}: {
  topHour: number;
  startHour: number;
  duration: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`absolute left-0 right-0 ${className ?? ""}`}
      style={{
        top: (startHour - topHour) * HOUR_PX,
        height: duration * HOUR_PX,
        ...style,
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Provider icons                                                      */
/* ------------------------------------------------------------------ */

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function OutlookIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
      <path d="M24 7.387v10.478c0 .23-.08.424-.238.576a.806.806 0 01-.588.234h-8.42v-8.07l1.2.9 1.705-1.4V7.387h6.103c.23 0 .424.08.588.234.159.152.238.346.238.576z" fill="#0364B8" />
      <path d="M16.754 10.105l-1.705 1.4-1.2-.9v8.07h-5.1V7.387h6.103c.23 0 .424.08.588.234.159.152.238.346.238.576v1.908z" fill="#0A2767" />
      <rect x="1" y="5" width="12" height="14" rx="1" fill="#0078D4" />
      <ellipse cx="7" cy="12" rx="3.5" ry="3.5" fill="white" />
    </svg>
  );
}
