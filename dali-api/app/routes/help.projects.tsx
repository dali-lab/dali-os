import { Link } from "react-router";
import type { Route } from "./+types/help.projects";

export const meta: Route.MetaFunction = () => [
  { title: "Projects, sprints, and tasks · Help · DALI OS" },
];

export default function HelpProjectsPage() {
  return (
    <main>
      <h1 className="text-2xl font-semibold">Projects, sprints, and tasks</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        A project workspace holds the team, the work, and everything written
        down about it. Once you're staffed, this is where most of your term
        happens.
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Finding your project</h2>
        <p className="mt-2 text-sm text-foreground">
          Every project in the lab is listed at{" "}
          <Link to="/projects" className="text-accent-teal hover:underline">
            Projects
          </Link>
          , and the ones you're on surface on{" "}
          <Link to="/" className="text-accent-teal hover:underline">
            Home
          </Link>
          . Opening a project gives you its team, its board, its documents, and
          its files.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Tasks</h2>
        <p className="mt-2 text-sm text-foreground">
          A task moves through six states: <em>Backlog</em>, <em>Todo</em>,{" "}
          <em>In Progress</em>, <em>In Review</em>, <em>Done</em>, and{" "}
          <em>Cancelled</em>. Anything assigned to you also appears in{" "}
          <Link
            to="/notifications"
            className="text-accent-teal hover:underline"
          >
            My Tasks
          </Link>
          , so you don't have to open each project to find out what's waiting on
          you.
        </p>
        <p className="mt-2 text-sm text-foreground">
          Open a task to add a checklist, attach files, comment, or link it to a
          GitHub issue or pull request. Mentioning someone in a comment with{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">@</code>{" "}
          notifies them.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Epics and sprints</h2>
        <p className="mt-2 text-sm text-foreground">
          Epics group tasks by the piece of the product they belong to; sprints
          group them by when they're being worked. A task can sit in both, or in
          neither — an unplanned task in no sprint is just backlog. PMs create
          and close sprints from the project; everyone else mostly reads them.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Documents and files</h2>
        <p className="mt-2 text-sm text-foreground">
          Each project carries its own document tree — specs, meeting notes,
          research, retros — plus uploaded files. Documents are collaborative
          and are covered in{" "}
          <Link to="/help/documents" className="text-accent-teal hover:underline">
            Documents and sharing
          </Link>
          . Files on a project can be marked visible to the partner
          organization, which is how deliverables get handed over without
          emailing them around.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">How you get on a project</h2>
        <p className="mt-2 text-sm text-foreground">
          Staffing happens between terms, not on the project page: you declare
          intent to work, bid on the projects you want, and optionally apply to
          level up. See{" "}
          <Link to="/help/staffing" className="text-accent-teal hover:underline">
            Staffing
          </Link>{" "}
          for how that cycle runs and what PMs see.
        </p>
      </section>
    </main>
  );
}
