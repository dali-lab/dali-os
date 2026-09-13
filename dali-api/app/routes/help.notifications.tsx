import { Link } from "react-router";
import type { Route } from "./+types/help.notifications";

export const meta: Route.MetaFunction = () => [
  { title: "Notifications · Help · DALI OS" },
];

export default function HelpNotificationsPage() {
  return (
    <main className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Notifications</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        DALI OS collects everything that needs your attention behind the
        bell in the top bar: click it for your open tasks and anything
        unread, each with the buttons to deal with it.
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Tasks vs. notifications</h2>
        <p className="mt-2 text-sm text-foreground">
          A <em>task</em> is something we want you to act on: an interview
          to confirm, a form to fill, a meeting invite to RSVP to. Tasks show
          up in the bell's count badge and stay there until they're
          resolved.
        </p>
        <p className="mt-2 text-sm text-foreground">
          A regular notification is just a heads-up — a project update, a
          system announcement, a meeting reminder. These collect in the same
          panel and mark themselves read when you've seen them; the full
          history lives on{" "}
          <Link to="/notifications" className="text-accent-teal hover:underline">
            My Tasks
          </Link>
          .
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Meeting invites</h2>
        <p className="mt-2 text-sm text-foreground">
          When someone schedules a meeting with you (directly or through an
          AI assistant via MCP) you get an invite notification with{" "}
          <em>Accept</em>, <em>Decline</em>, and <em>Tentative</em> buttons.
          Accepting also flips the corresponding event on your linked
          Google calendar to <em>accepted</em>. The notification clears
          itself once you respond.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Reminders</h2>
        <p className="mt-2 text-sm text-foreground">
          For meetings and time-sensitive tasks, DALI OS sends a reminder
          ahead of the deadline. Reminders clear themselves once they've
          gone by, or once the underlying assignment is no longer active (the
          meeting is cancelled, the interview is reassigned, etc.), so you
          don't have to clean up after a state change.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Channels &amp; preferences</h2>
        <p className="mt-2 text-sm text-foreground">
          Every notification can reach you three ways: in-app (the bell and
          Home inbox), email, and a Slack DM from the DALI OS bot. Email can
          arrive instantly per notification, or batched into a daily or
          weekly digest of what you haven&apos;t read (send times are shown
          on the settings page).
        </p>
        <p className="mt-2 text-sm text-foreground">
          Tune all of this per event type in{" "}
          <Link to="/settings/notifications" className="text-blue-700 underline">
            Settings → Notifications
          </Link>
          . Action items (meeting invites, assigned interviews, forms to
          fill) always stay in-app; a few flows — like education application
          decisions — send their own dedicated emails regardless of these
          settings.
        </p>
      </section>
    </main>
  );
}
