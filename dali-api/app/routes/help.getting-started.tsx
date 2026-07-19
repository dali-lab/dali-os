import { Link } from "react-router";
import type { Route } from "./+types/help.getting-started";

export const meta: Route.MetaFunction = () => [
  { title: "Getting started · Help · DALI OS" },
];

const SECTIONS: Array<{
  title: string;
  to: string;
  body: React.ReactNode;
}> = [
  {
    title: "Home",
    to: "/",
    body: (
      <>
        The first thing you see each day: open tasks, unread announcements,
        meetings on the agenda, and a few shortcuts into the rest of the
        app. If something needs your attention, it surfaces here first.
      </>
    ),
  },
  {
    title: "Calendar",
    to: "/calendar",
    body: (
      <>
        Your week with external calendars overlaid. Set working hours and
        meeting buffers here, and use it to find mutual free time with
        other members. Linked accounts come from{" "}
        <Link to="/settings/calendar" className="text-accent-teal hover:underline">
          Settings → Calendar
        </Link>
        .
      </>
    ),
  },
  {
    title: "Projects",
    to: "/projects",
    body: (
      <>
        Every active project lives here with its sprint board, epics, tasks,
        docs, and files. The <em>Staffing</em> section under Projects is
        where intent-to-work, project bids, and level-up forms live during
        a staffing cycle —{" "}
        <Link to="/help/staffing" className="text-accent-teal hover:underline">
          read more
        </Link>
        .
      </>
    ),
  },
  {
    title: "Hiring",
    to: "/hiring/reviewer",
    body: (
      <>
        Everything for running an application cycle: reviewing applications,
        domain-lead deliberations, scheduling interviews, and the library of
        challenges, rubrics, and email templates. What you see depends on
        your role this cycle.
      </>
    ),
  },
  {
    title: "Members",
    to: "/members",
    body: (
      <>
        The lab directory — current members, alumni (by class year), and
        groups. Click a member to see their profile, projects, and roles.
        Your own profile lives at{" "}
        <Link to="/profile" className="text-accent-teal hover:underline">
          /profile
        </Link>
        .
      </>
    ),
  },
  {
    title: "Partners",
    to: "/partners",
    body: (
      <>
        Outside organizations DALI works with — current partners and partner
        applications. Domain leads review partner applications in the same
        place.
      </>
    ),
  },
  {
    title: "Education",
    to: "/education",
    body: (
      <>
        Miniseries, workshops, and other lab-wide learning. Sign up for
        sessions and see what's coming up.
      </>
    ),
  },
  {
    title: "Forms",
    to: "/forms",
    body: (
      <>
        A folder tree of forms — feedback, evaluations, staffing inputs,
        one-off surveys. If someone sends you a form to fill, the link in
        your task list opens it here.
      </>
    ),
  },
];

export default function GettingStartedPage() {
  return (
    <main className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Getting started</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        DALI OS is organized by what you're trying to do, not by your role.
        The left sidebar groups the lab's work into a few sections — here's
        what lives in each.
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Tabs and panes</h2>
        <p className="mt-2 text-sm text-foreground">
          Pages open in tabs inside the workspace. Open multiple at once,
          split your view to compare two pages side-by-side, and use{" "}
          <Link to="/help/shortcuts" className="text-accent-teal hover:underline">
            keyboard shortcuts
          </Link>{" "}
          to move between them.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Sidebar sections</h2>
        <ul className="mt-3 space-y-3">
          {SECTIONS.map((s) => (
            <li
              key={s.to}
              className="rounded border border-border bg-card p-4"
            >
              <h3 className="font-medium">
                <Link to={s.to} className="text-accent-teal hover:underline">
                  {s.title}
                </Link>
              </h3>
              <p className="mt-1 text-sm text-foreground">{s.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Settings and help</h2>
        <p className="mt-2 text-sm text-foreground">
          The gear and question-mark icons in the bottom-left of the
          sidebar open{" "}
          <Link to="/settings" className="text-accent-teal hover:underline">
            Settings
          </Link>{" "}
          and{" "}
          <Link to="/help" className="text-accent-teal hover:underline">
            Help
          </Link>
          . Settings is where you manage your calendar links, active
          sessions, and connected AI assistants.
        </p>
      </section>
    </main>
  );
}
