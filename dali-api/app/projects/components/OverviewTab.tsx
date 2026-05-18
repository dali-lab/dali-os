import { CollaborativeEditor } from "~/components/CollaborativeEditor";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import type { WorkspaceData } from "~/projects/lib/queries";
import type { ProjectMembership } from "~/lib/projectAuth";

interface Props {
  workspace: WorkspaceData;
  membership: ProjectMembership;
  viewer: {
    userId: string;
    userFirstName: string;
    userLastName: string;
    collabToken: string | null;
  };
}

export function OverviewTab({ workspace, membership, viewer }: Props) {
  const docName = `project:${workspace.project.id}:overview`;
  const userName =
    `${viewer.userFirstName} ${viewer.userLastName}`.trim() || "DALI member";
  const readOnly = !membership.canEdit || workspace.project.status === "Archived";

  if (!viewer.collabToken) {
    return (
      <div className="text-sm text-muted-foreground italic">
        Sign in again to load the collaborative editor.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <PresenceProvider
        pageId={`overview:${workspace.project.id}`}
        token={viewer.collabToken}
        userName={userName}
      >
        <CollaborativeEditor
          documentName={docName}
          token={viewer.collabToken}
          userName={userName}
          editorId="overview"
          disabled={readOnly}
          placeholder="Start with the project brief — goals, scope, team, partners…"
        />
      </PresenceProvider>
    </div>
  );
}
