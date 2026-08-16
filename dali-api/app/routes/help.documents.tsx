import { Link } from "react-router";
import type { Route } from "./+types/help.documents";

export const meta: Route.MetaFunction = () => [
  { title: "Documents and sharing · Help · DALI OS" },
];

export default function HelpDocumentsPage() {
  return (
    <main>
      <h1 className="text-2xl font-semibold">Documents and sharing</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Documents in DALI OS are collaborative: several people can type in the
        same one at once, everyone sees the changes as they happen, and there's
        no save button. Everything below applies whether the doc lives on a
        project, on a course, or in the lab-wide tree.
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Where documents live</h2>
        <p className="mt-2 text-sm text-foreground">
          Docs belong to a workspace — the lab, a project, an education
          offering, or you. Lab-wide docs are at{" "}
          <Link to="/documents" className="text-accent-teal hover:underline">
            Documents
          </Link>
          ; project docs live inside the project. Pages nest into folders, and
          a folder can carry its own access rules that everything inside it
          inherits.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Writing in a doc</h2>
        <p className="mt-2 text-sm text-foreground">
          Type <code className="rounded bg-muted px-1 py-0.5 text-xs">/</code>{" "}
          for the block menu — headings, lists, tables, callouts, code, images,
          and embeds. Type{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">@</code> to
          mention a person, which notifies them. Select text to comment on it;
          comments thread in a rail beside the doc and resolve when they're
          handled.
        </p>
        <p className="mt-2 text-sm text-foreground">
          Every doc keeps a version history, so you can see what changed and
          restore an earlier state. Nothing is lost when two people edit the
          same paragraph — the document merges both.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Who can see a document</h2>
        <p className="mt-2 text-sm text-foreground">
          Two things decide access, and a person gets whichever is more
          generous. The first is the link setting:{" "}
          <em>Restricted</em> means only people named on the doc,{" "}
          <em>Lab members</em> opens it to anyone in the lab, and{" "}
          <em>Public</em> puts it on the open web. The second is the share list
          — specific people or groups, each granted <em>View</em>,{" "}
          <em>Comment</em>, <em>Edit</em>, or <em>Full access</em>.
        </p>
        <p className="mt-2 text-sm text-foreground">
          Nesting only ever narrows access. Putting a doc inside a private
          folder restricts it; it never widens a doc that was already limited.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Writing assistance</h2>
        <p className="mt-2 text-sm text-foreground">
          Some documents offer an AI writing assistant for drafting and
          rewriting inside the editor. It's per-surface, so you'll see it on
          docs where it's turned on and not elsewhere, and it has a daily usage
          limit per person.
        </p>
      </section>
    </main>
  );
}
