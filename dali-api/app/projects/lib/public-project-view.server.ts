import { prisma } from "~/lib/db";
import { resolvePhotoUrl } from "~/lib/photo";
import { fullName } from "~/lib/display";
import type { ProjectShowcaseStatus } from "~/generated/prisma/client";

// The editing surface behind a project's Public view. Sibling of
// loadPartnerProjectView (app/partners/lib/partner-project-view.server.ts):
// same idea — the whole read-surface for one audience in one query pass — but
// where the partner view *derives* everything from live project state, the
// public view is hand-curated, so this mostly reads back the ProjectShowcase
// row and the few live bits the public card shows alongside it.

export type PublicProjectViewData = {
  project: {
    id: string;
    name: string;
    imageUrl: string | null;
  };
  // Null until someone saves the Public view for the first time. The route
  // renders empty inputs rather than creating a row on mere page load.
  showcase: {
    status: ProjectShowcaseStatus;
    tagline: string | null;
    displayName: string | null;
    year: number | null;
    partners: string[];
    products: string[];
    sectors: string[];
    techStack: string[];
    appUrl: string | null;
    websiteUrl: string | null;
    blogUrl: string | null;
    pressUrl: string | null;
    heroImageUrl: string | null;
    updatedAt: string;
  } | null;
  // Presigned/resolved for the preview panel only; the public API resolves its
  // own copy through the media proxy.
  heroPreviewUrl: string | null;
  // Current roster, shown on the public card as the credit line. Live, not
  // curated — the public site names who built it.
  teamMembers: string[];
  // The page whose body is the public write-up, if one has been nominated —
  // either created from this view or flagged from the Documents block. Null
  // means the write-up hasn't been started; the view offers to create it
  // rather than accruing an empty document on every project someone merely
  // looks at.
  writeup: { id: string; title: string } | null;
};

export async function loadPublicProjectView(
  projectId: string,
): Promise<PublicProjectViewData | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      imageUrl: true,
      showcase: true,
    },
  });
  if (!project) return null;

  const [assignments, writeup] = await Promise.all([
    prisma.projectAssignment.findMany({
      where: { projectId },
      select: { user: { select: { id: true, firstName: true, lastName: true } } },
    }),
    // Lowest position wins when several pages are flagged — the same tiebreak
    // the public API uses, so this view can't preview a different page from
    // the one that actually ships.
    prisma.page.findFirst({
      where: {
        workspaceType: "Project",
        workspaceId: projectId,
        archivedAt: null,
        publicVisible: true,
      },
      orderBy: { position: "asc" },
      select: { id: true, title: true },
    }),
  ]);

  // One credit per person even when they were staffed across several terms or
  // domains, ordered by name so the card reads consistently between loads.
  const byUser = new Map(assignments.map((a) => [a.user.id, fullName(a.user)]));
  const teamMembers = [...byUser.values()].sort((a, b) => a.localeCompare(b));

  const s = project.showcase;

  return {
    project: {
      id: project.id,
      name: project.name,
      imageUrl: await resolvePhotoUrl(project.imageUrl),
    },
    showcase: s
      ? {
          status: s.status,
          tagline: s.tagline,
          displayName: s.displayName,
          year: s.year,
          partners: s.partners,
          products: s.products,
          sectors: s.sectors,
          techStack: s.techStack,
          appUrl: s.appUrl,
          websiteUrl: s.websiteUrl,
          blogUrl: s.blogUrl,
          pressUrl: s.pressUrl,
          heroImageUrl: s.heroImageUrl,
          updatedAt: s.updatedAt.toISOString(),
        }
      : null,
    heroPreviewUrl: await resolvePhotoUrl(s?.heroImageUrl ?? project.imageUrl),
    teamMembers,
    writeup,
  };
}
