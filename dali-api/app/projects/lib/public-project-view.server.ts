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
  // Project pages the team could nominate as the public write-up, with the
  // current pick flagged. Empty when the project has no unarchived pages.
  pages: { id: string; title: string; iconEmoji: string | null; publicVisible: boolean }[];
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

  const [assignments, pages] = await Promise.all([
    prisma.projectAssignment.findMany({
      where: { projectId },
      select: { user: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.page.findMany({
      where: { workspaceType: "Project", workspaceId: projectId, archivedAt: null },
      orderBy: { position: "asc" },
      select: { id: true, title: true, iconEmoji: true, publicVisible: true },
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
    pages,
  };
}
