import { Link } from "react-router";
import type { Route } from "./+types/help.timesheet";

export const meta: Route.MetaFunction = () => [
  { title: "Logging hours · Help · DALI OS" },
];

export default function HelpTimesheetPage() {
  return (
    <main>
      <h1 className="text-2xl font-semibold">Logging hours</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The <em>Timesheet</em> tab on the{" "}
        <Link to="/calendar" className="text-accent-teal hover:underline">
          Calendar page
        </Link>{" "}
        is where you record the hours you work. Every entry is attributed to one
        paid role, and totals accumulate over a two-week pay period.
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Adding an entry</h2>
        <p className="mt-2 text-sm text-foreground">
          There are two ways in. Use the form to log a date, a number of hours,
          the role it counts against, and an optional note — that's the quickest
          path when you're catching up on a past day. Or drag across the week
          grid to create an entry with a real start and end time; those show as
          blocks on the grid alongside your calendar events, so you can see the
          shape of your week rather than a running total.
        </p>
        <p className="mt-2 text-sm text-foreground">
          Meetings you attended through DALI OS can be turned into entries
          directly, which saves re-typing a time you've already recorded by
          checking in.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Attributing hours to a role</h2>
        <p className="mt-2 text-sm text-foreground">
          Every entry has to name the role it was worked under — a project
          assignment, a core role, teaching, domain lead work, or admin. If you
          hold more than one, you'll pick each time. This is what lets the lab
          bill a partner for project hours and pay core hours from a different
          budget, so it's worth getting right rather than defaulting everything
          to your main project.
        </p>
        <p className="mt-2 text-sm text-foreground">
          If you have exactly one paid role, it's picked for you. If you have
          none, there's nothing valid to attribute to and the form won't submit
          — that usually means your assignment hasn't been finalized yet, which
          your PM or the staffing lead can fix.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Pay periods</h2>
        <p className="mt-2 text-sm text-foreground">
          Payroll runs on a fortnight. The Timesheet shows which period today
          falls in and flags the last day of it, and your per-role totals reset
          when the next one starts. Log hours before the period closes —
          anything added afterwards has to be chased manually through payroll.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Timezones</h2>
        <p className="mt-2 text-sm text-foreground">
          Entries are recorded against a calendar day in your saved timezone, so
          set it before you start logging — an off-term or study-abroad member
          on Hanover time would otherwise see hours land on the wrong day.
          Change it in{" "}
          <Link
            to="/settings/calendar"
            className="text-accent-teal hover:underline"
          >
            Settings → Calendar
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
