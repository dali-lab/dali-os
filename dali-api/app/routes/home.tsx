import { redirect, useLoaderData } from "react-router";
import {
  FileText,
  ExternalLink,
  AlertCircle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { requireAuth } from "~/lib/auth";
import type { Route } from "./+types/home";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  return { user: auth.user };
}

export default function Home() {
  const { user } = useLoaderData<typeof loader>();
  const firstName = user.firstName || user.email.split("@")[0];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Welcome back, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Here's what's happening in the lab this week.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        <RemindersPanel />
        <WeekCalendarPanel />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lab-wide reminders                                                  */
/* ------------------------------------------------------------------ */

type Reminder = {
  id: string;
  title: string;
  description: string;
  dueLabel: string;
  urgent?: boolean;
  href?: string;
};

const REMINDERS: Reminder[] = [
  {
    id: "r1",
    title: "Submit weekly term-time form",
    description: "Log your hours and project updates for the week.",
    dueLabel: "Due Friday",
    urgent: true,
    href: "#",
  },
  {
    id: "r2",
    title: "End-of-term reflection",
    description: "Share what went well and what to improve next term.",
    dueLabel: "Due next week",
    href: "#",
  },
  {
    id: "r3",
    title: "Update headshot & bio",
    description: "Refresh your profile so partners can find you.",
    dueLabel: "Anytime",
    href: "#",
  },
];

function RemindersPanel() {
  return (
    <aside className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <AlertCircle className="w-4 h-4 text-accent-coral" />
          Lab Reminders
        </h2>
        <span className="text-xs text-muted-foreground">{REMINDERS.length} open</span>
      </div>
      <div className="flex flex-col gap-2">
        {REMINDERS.map((r) => (
          <ReminderCard key={r.id} reminder={r} />
        ))}
      </div>
    </aside>
  );
}

function ReminderCard({ reminder }: { reminder: Reminder }) {
  const accent = reminder.urgent ? "border-l-accent-coral" : "border-l-accent-teal";
  return (
    <a
      href={reminder.href ?? "#"}
      className={`group bg-card border border-border border-l-4 ${accent} rounded-md px-3 py-2.5 flex items-start gap-3 hover:bg-muted/40 transition-colors`}
    >
      <FileText className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-foreground truncate">{reminder.title}</span>
          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{reminder.description}</p>
        <span
          className={`inline-block mt-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            reminder.urgent
              ? "bg-accent-coral/15 text-accent-coral"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {reminder.dueLabel}
        </span>
      </div>
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* This-week calendar                                                  */
/* ------------------------------------------------------------------ */

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];
const HOUR_PX = 44;
const DAYS = [
  { key: "SUN", num: 10 },
  { key: "MON", num: 11 },
  { key: "TUE", num: 12 },
  { key: "WED", num: 13 },
  { key: "THU", num: 14 },
  { key: "FRI", num: 15 },
  { key: "SAT", num: 16 },
];

const EVENT_TEXT = "text-[hsl(203_38%_18%)]";

type WeekEvent = {
  startHour: number;
  duration: number;
  label: string;
  className: string;
};

const WEEK_EVENTS: Record<number, WeekEvent[]> = {
  1: [
    { startHour: 10, duration: 1, label: "Standup", className: `bg-accent-teal ${EVENT_TEXT}` },
    { startHour: 14, duration: 1.5, label: "Design crit", className: `bg-accent-coral-light ${EVENT_TEXT}` },
  ],
  2: [
    { startHour: 11, duration: 1, label: "Partner sync", className: `bg-accent-green ${EVENT_TEXT}` },
  ],
  3: [
    { startHour: 9, duration: 1, label: "Standup", className: `bg-accent-teal ${EVENT_TEXT}` },
    { startHour: 15, duration: 2, label: "DALI hours", className: `bg-accent-coral-light ${EVENT_TEXT}` },
  ],
  4: [
    { startHour: 13, duration: 1, label: "1:1 w/ PM", className: `bg-accent-green ${EVENT_TEXT}` },
  ],
  5: [
    { startHour: 16, duration: 1, label: "Lab meeting", className: `bg-accent-coral-light ${EVENT_TEXT}` },
  ],
};

function WeekCalendarPanel() {
  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <CalendarDays className="w-4 h-4 text-accent-coral" />
          This Week
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous week"
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="px-3 py-1 text-xs font-semibold rounded-md border border-border hover:bg-muted transition-colors"
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Next week"
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex border border-border rounded-md overflow-hidden">
        <div className="flex flex-col w-12 border-r border-border bg-card text-[10px] text-muted-foreground">
          <div className="h-9 border-b border-border" />
          {HOURS.map((h) => (
            <div key={h} style={{ height: HOUR_PX }} className="px-1.5 pt-0.5 text-right">
              {formatHour(h)}
            </div>
          ))}
        </div>
        {DAYS.map((d, idx) => (
          <div key={d.key} className="flex-1 min-w-0 border-r last:border-r-0 border-border flex flex-col">
            <div className="flex flex-col items-center justify-center border-b border-border h-9">
              <div className="text-[9px] font-semibold text-muted-foreground tracking-wide">
                {d.key}
              </div>
              <div className="text-xs font-bold text-foreground">{d.num}</div>
            </div>
            <div className="relative" style={{ height: HOURS.length * HOUR_PX }}>
              {HOURS.map((_, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 border-t border-border/60"
                  style={{ top: i * HOUR_PX }}
                />
              ))}
              {(WEEK_EVENTS[idx] ?? []).map((e, i) => (
                <div
                  key={i}
                  className={`absolute left-0 right-0 mx-0.5 px-1 py-0.5 rounded-sm text-[10px] font-medium overflow-hidden ${e.className}`}
                  style={{
                    top: (e.startHour - HOURS[0]) * HOUR_PX,
                    height: e.duration * HOUR_PX,
                  }}
                >
                  <span className="truncate block">{e.label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatHour(h: number) {
  if (h === 12) return "12 PM";
  if (h === 0) return "12 AM";
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}
