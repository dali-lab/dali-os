import { prisma } from "~/lib/db";
import { fullName } from "~/lib/display";
import { publicMediaUrl } from "./public-media";
import {
  parseDetails,
  parseMedia,
  type ShowcaseDetail,
} from "~/projects/lib/showcase-content";

// One gallery item as the site consumes it: the stored src resolved to a
// publicly reachable URL (media proxy path or a passed-through absolute URL).
export type PublicProjectMedia = {
  type: "image" | "video";
  url: string;
  caption?: string;
};

// The shape dali.website's `Project` interface (shared/api.ts) expects. Held
// to deliberately, so swapping the site's data source from Notion to here
// needed no changes to any of its components.
export type PublicProject = {
  id: string;
  name: string;
  description: string;
  status: string;
  tags: string[];
  sector?: string;
  sectors: string[];
  product: string[];
  techStack: string[];
  term: string;
  teamMembers: string[];
  coverImage: string;
  projectUrls: { label: string; url: string }[];
};

// Only Published rows are ever visible here — the other ProjectShowcaseStatus
// values are pipeline states for Core, not a public audience.
const PUBLISHED = { status: "Published" } as const;

const SHOWCASE_SELECT = {
  projectId: true,
  displayName: true,
  tagline: true,
  year: true,
  partners: true,
  products: true,
  sectors: true,
  techStack: true,
  appUrl: true,
  websiteUrl: true,
  blogUrl: true,
  pressUrl: true,
  heroImageUrl: true,
  project: { select: { id: true, name: true, imageUrl: true } },
} as const;

type ShowcaseRow = {
  projectId: string;
  displayName: string | null;
  tagline: string | null;
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
  project: { id: string; name: string; imageUrl: string | null };
};

function toPublicProject(row: ShowcaseRow, teamMembers: string[]): PublicProject {
  const projectUrls: { label: string; url: string }[] = [];
  if (row.websiteUrl) projectUrls.push({ label: "Website", url: row.websiteUrl });
  if (row.appUrl) projectUrls.push({ label: "App", url: row.appUrl });
  if (row.blogUrl) projectUrls.push({ label: "Student Blog", url: row.blogUrl });
  if (row.pressUrl) projectUrls.push({ label: "Press", url: row.pressUrl });

  return {
    id: row.projectId,
    name: row.displayName || row.project.name,
    description: row.tagline ?? "",
    // The site shows one status string and every published project is, by
    // definition, published. Project.status is internal lifecycle state and
    // is deliberately not leaked here.
    status: "Published",
    // The site's filter chips read from one flat list; the three facets stay
    // available separately for its search predicate.
    tags: [...row.products, ...row.sectors, ...row.techStack],
    sector: row.sectors[0],
    sectors: row.sectors,
    product: row.products,
    techStack: row.techStack,
    term: row.year ? String(row.year) : "",
    teamMembers,
    // Falls back to the internal hub banner when no public hero is set, so a
    // freshly curated project isn't imageless.
    coverImage: publicMediaUrl(row.heroImageUrl ?? row.project.imageUrl) ?? "",
    projectUrls,
  };
}

// Credit lines for a set of projects in one query, rather than one per
// project — the list endpoint serves every published project at once.
async function teamMembersByProject(
  projectIds: string[],
): Promise<Map<string, string[]>> {
  if (projectIds.length === 0) return new Map();
  const rows = await prisma.projectAssignment.findMany({
    where: { projectId: { in: projectIds } },
    select: {
      projectId: true,
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  // Dedupe per project: a member staffed across several terms or domains is
  // one credit, not several.
  const seen = new Map<string, Map<string, string>>();
  for (const r of rows) {
    let forProject = seen.get(r.projectId);
    if (!forProject) {
      forProject = new Map();
      seen.set(r.projectId, forProject);
    }
    forProject.set(r.user.id, fullName(r.user));
  }
  return new Map(
    [...seen].map(([projectId, users]) => [
      projectId,
      [...users.values()].sort((a, b) => a.localeCompare(b)),
    ]),
  );
}

export async function listPublicProjects(): Promise<PublicProject[]> {
  const rows = await prisma.projectShowcase.findMany({
    where: PUBLISHED,
    orderBy: [{ year: "desc" }, { tagline: "asc" }],
    select: SHOWCASE_SELECT,
  });
  const teams = await teamMembersByProject(rows.map((r) => r.projectId));
  return rows.map((r) => toPublicProject(r, teams.get(r.projectId) ?? []));
}

export async function getPublicProject(
  projectId: string,
): Promise<{
  project: PublicProject;
  details: ShowcaseDetail[];
  media: PublicProjectMedia[];
} | null> {
  const row = await prisma.projectShowcase.findFirst({
    where: { projectId, ...PUBLISHED },
    // details/media only for the single-project view — the list endpoint
    // doesn't return them, so they stay out of SHOWCASE_SELECT.
    select: { ...SHOWCASE_SELECT, details: true, media: true },
  });
  if (!row) return null;

  const teams = await teamMembersByProject([projectId]);

  // Resolve each media src to a public URL; drop anything that can't be made
  // reachable (an unresolvable key) rather than ship a broken tag to the site.
  const media = parseMedia(row.media)
    .map((m): PublicProjectMedia | null => {
      const url = publicMediaUrl(m.src);
      if (!url) return null;
      return m.caption
        ? { type: m.type, url, caption: m.caption }
        : { type: m.type, url };
    })
    .filter((m): m is PublicProjectMedia => m !== null);

  return {
    project: toPublicProject(row, teams.get(projectId) ?? []),
    details: parseDetails(row.details),
    media,
  };
}
