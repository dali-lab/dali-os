import { Link } from "react-router";
import type { Route } from "./+types/help.calendar";

export const meta: Route.MetaFunction = () => [
  { title: "Calendar · Help · DALI OS" },
];

export default function HelpCalendarPage() {
  return (
    <main className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Calendar</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        DALI OS uses your linked Google calendars in two ways: it reads when
        you're busy so it can show you and others your real availability, and
        it writes meetings you (or an AI assistant) schedule through DALI OS.
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Linking a Google account</h2>
        <p className="mt-2 text-sm text-foreground">
          Go to{" "}
          <Link to="/settings/calendar" className="text-accent-teal hover:underline">
            Settings → Calendar
          </Link>{" "}
          (or the right rail on the{" "}
          <Link to="/calendar" className="text-accent-teal hover:underline">
            Calendar page
          </Link>
          ) and click <em>Add Google account</em>. You'll be redirected to
          Google to grant access, then bounced back. Linking the same account
          twice is harmless — it refreshes the tokens.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Which calendars block you</h2>
        <p className="mt-2 text-sm text-foreground">
          After you link an account, DALI OS lists every calendar inside it.
          Toggle the ones that should count toward your busy time — typically
          your primary calendar and any shared calendars you actually attend.
          Skip ones you only subscribe to (sports schedules, public holidays,
          team calendars you don't sit in). The state is per-account, so you
          can be precise across personal and Dartmouth Google accounts.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Working hours and buffers</h2>
        <p className="mt-2 text-sm text-foreground">
          On the{" "}
          <Link to="/calendar" className="text-accent-teal hover:underline">
            Calendar page
          </Link>{" "}
          you can set the hours you're generally available on each weekday and
          a buffer that's automatically padded around every external event
          before someone (or an AI assistant) can schedule on top of you.
          Working hours are interpreted in your saved timezone; the default is
          America/New_York.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">When DALI OS writes to your calendar</h2>
        <p className="mt-2 text-sm text-foreground">
          The only events DALI OS creates on your Google calendar are meetings
          scheduled through DALI OS — either by you (via the scheduling UI) or
          by an AI assistant calling the <code>schedule_meeting</code> MCP
          tool. Those events are written to whichever linked account you pick
          as the organizer, with all attendees invited via Gmail. DALI OS
          never reads or modifies other events on your calendar.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Removing a link</h2>
        <p className="mt-2 text-sm text-foreground">
          From{" "}
          <Link to="/settings/calendar" className="text-accent-teal hover:underline">
            Settings → Calendar
          </Link>
          , click the trash icon next to an account. Existing meetings
          DALI OS wrote stay on Google; future scheduling stops using that
          account immediately, and we discard the refresh token.
        </p>
      </section>
    </main>
  );
}
