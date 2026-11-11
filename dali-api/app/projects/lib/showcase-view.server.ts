// The published showcase as logged-in members and alumni see it inside DALI OS:
// the same curated content dali.website serves, but with media presigned for a
// session instead of proxied through the public media route.
import { prisma } from "~/lib/db.server";
import { resolvePhotoUrl } from "~/lib/photo";
import { teamMembersByProject } from "~/public-api/lib/public-projects.server";
import {
  parseDetails,
  parseMedia,
  type ShowcaseDetail,
} from "~/projects/lib/showcase-content";

const PUBLISHED = { status: "Published" } as const;

const CARD_SELECT = {
  projectId: true,
  displayName: true,
  tagline: true,
  year: true,
  partners: true,
  heroImageUrl: true,
  project: { select: { name: true, imageUrl: true } },
} as const;

type CardRow = {
  projectId: string;
  displayName: string | null;
  tagline: string | null;
  year: number | null;
  partners: string[];
  heroImageUrl: string | null;
  project: { name: string; imageUrl: string | null };
};

export type ShowcaseCardData = {
  id: string;
  name: string;
  tagline: string;
  year: number | null;
  partners: string[];
  coverUrl: string | null;
};

async function toCard(row: CardRow): Promise<ShowcaseCardData> {
  return {
    id: row.projectId,
    name: row.displayName || row.project.name,
    tagline: row.tagline ?? "",
    year: row.year,
    partners: row.partners,
    coverUrl: await resolvePhotoUrl(row.heroImageUrl ?? row.project.imageUrl),
  };
}

export async function listShowcaseCards(limit: number): Promise<ShowcaseCardData[]> {
  const rows = await prisma.projectShowcase.findMany({
    where: PUBLISHED,
    orderBy: [{ year: "desc" }, { tagline: "asc" }],
    take: limit,
    select: CARD_SELECT,
  });
  return Promise.all(rows.map(toCard));
}

export type ShowcaseViewData = ShowcaseCardData & {
  products: string[];
  sectors: string[];
  techStack: string[];
  links: { label: string; url: string }[];
  teamMembers: string[];
  details: ShowcaseDetail[];
  media: { type: "image" | "video"; url: string; caption?: string }[];
};

export async function getShowcaseView(projectId: string): Promise<ShowcaseViewData | null> {
  const row = await prisma.projectShowcase.findFirst({
    where: { projectId, ...PUBLISHED },
    select: {
      ...CARD_SELECT,
      products: true,
      sectors: true,
      techStack: true,
      appUrl: true,
      websiteUrl: true,
      blogUrl: true,
      pressUrl: true,
      details: true,
      media: true,
    },
  });
  if (!row) return null;

  const links: { label: string; url: string }[] = [];
  if (row.websiteUrl) links.push({ label: "Website", url: row.websiteUrl });
  if (row.appUrl) links.push({ label: "App", url: row.appUrl });
  if (row.blogUrl) links.push({ label: "Student blog", url: row.blogUrl });
  if (row.pressUrl) links.push({ label: "Press", url: row.pressUrl });

  const teams = await teamMembersByProject([projectId]);
  const media = (
    await Promise.all(
      parseMedia(row.media).map(async (m) => {
        const url = await resolvePhotoUrl(m.src);
        if (!url) return null;
        return m.caption
          ? ({ type: m.type, url, caption: m.caption } as const)
          : ({ type: m.type, url } as const);
      }),
    )
  ).filter((m) => m !== null);

  return {
    ...(await toCard(row)),
    products: row.products,
    sectors: row.sectors,
    techStack: row.techStack,
    links,
    teamMembers: teams.get(projectId) ?? [],
    details: parseDetails(row.details),
    media,
  };
}
