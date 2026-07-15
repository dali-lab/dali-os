import { Link } from "react-router";
import type { Route } from "./+types/help.notifications";

export const meta: Route.MetaFunction = () => [
  { title: "Notifications · Help · DALI OS" },
];

export default function HelpNotificationsPage() {
  return (
    <main className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Notifications</h1>
      <p className="mt-2 text-sm text-zinc-600">
        DALI OS tells you about things that need your attention in two
        places: the Tasks group in the sidebar and your Home inbox.
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Tasks vs. notifications</h2>
        <p className="mt-2 text-sm text-zinc-700">
          A <em>task</em> is something we want you to act on: an interview
          to confirm, a form to fill, a meeting invite to RSVP to. Tasks show
          up in the sidebar with a count badge and stay there until they're
          resolved.
        </p>
        <p className="mt-2 text-sm text-zinc-700">
          A regular notification is just a heads-up — a project update, a
          system announcement, a meeting reminder. These collect on{" "}
          <Link to="/" className="text-blue-700 underline">
            Home
          </Link>{" "}
          and mark themselves read when you've seen them.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Meeting invites</h2>
        <p className="mt-2 text-sm text-zinc-700">
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
        <p className="mt-2 text-sm text-zinc-700">
          For meetings and time-sensitive tasks, DALI OS sends a reminder
          ahead of the deadline. Reminders disappear from the Tasks group
          automatically once the underlying assignment is no longer active
          (the meeting is cancelled, the interview is reassigned, etc.) so
          you don't have to clean up after a state change.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Channels &amp; preferences</h2>
        <p className="mt-2 text-sm text-zinc-700">
          Every notification can reach you three ways: in-app (the bell and
          Home inbox), email, and a Slack DM from the DALI OS bot. Email can
          arrive instantly per notification, or batched into a daily (9am)
          or weekly (Monday 9am) digest of what you haven&apos;t read.
        </p>
        <p className="mt-2 text-sm text-zinc-700">
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
