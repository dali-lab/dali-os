import { useEffect, useState } from "react";
import { Link, useLoaderData } from "react-router";
import {
  ArrowRight,
  Clock,
  FolderKanban,
  Globe,
  Handshake,
  Images,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "./+types/currently";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { getUserRoles, currentTerm, currentTermMemberWhere } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { loadGalleryHighlights, type GalleryTileData } from "~/community/lib/gallery.server";
import { BLOG_LISTING_ORDER } from "~/lib/blog-post.server";
import { blogListing, DEFAULT_BLOG_COVER } from "~/lib/blog-preview";
import { resolvePhotoUrl } from "~/lib/photo";
import { formatDateShort, fullName } from "~/lib/display";
import { cn } from "~/lib/cn";
import { galleryPostHref } from "~/community/components/GalleryMasonry";
import { OsProjectCard } from "~/projects/components/OsProjectCard";
import { ShowcaseCard } from "~/projects/components/ShowcaseCard";
import { listShowcaseCards } from "~/projects/lib/showcase-view.server";

export const meta: Route.MetaFunction = () => [{ title: "Currently at DALI · DALI OS" }];

export const handle = { breadcrumb: () => "Currently at DALI", fitViewport: true };

const STORY_COUNT = 4;
const GALLERY_COUNT = 8;
const PROJECT_COUNT = 6;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;

  const roles = await getUserRoles(auth.user.sub, request);
  const community = await isFeatureEnabled("community", auth.user.sub, roles, request);
  const term = await currentTerm(request);
  const viewer = { id: auth.user.sub, core: roles.isCore, name: "" };
  const alumni = roles.isAlumni;
  const projectWhere = {
    status: "Active" as const,
    ...(term ? { projectTerms: { some: { termId: term.id } } } : {}),
  };

  const [
    projectRows,
    storyRows,
    storiesTotal,
    gallery,
    showcaseProjects,
    members,
    projectsTotal,
    partnerRows,
    hoursAgg,
    photosTotal,
  ] = await Promise.all([
    alumni
      ? []
      : prisma.project.findMany({
      where: projectWhere,
      orderBy: { name: "asc" },
      take: PROJECT_COUNT,
      select: {
        id: true,
        name: true,
        iconEmoji: true,
        status: true,
        imageUrl: true,
        projectTerms: {
          orderBy: { term: { sortKey: "asc" } },
          take: 1,
          select: { term: { select: { code: true } } },
        },
        partners: { select: { partnerOrg: { select: { name: true, logoUrl: true } } } },
        showcase: { select: { status: true } },
      },
    }),
    community
      ? prisma.blogPost.findMany({
          where: { publishedAt: { not: null } },
          orderBy: BLOG_LISTING_ORDER,
          take: STORY_COUNT,
          select: {
            id: true,
            title: true,
            summary: true,
            excerpt: true,
            customCoverUrl: true,
            coverImageUrl: true,
            visibility: true,
            publishedAt: true,
            author: { select: { firstName: true, lastName: true } },
          },
        })
      : [],
    community ? prisma.blogPost.count({ where: { publishedAt: { not: null } } }) : 0,
    community ? loadGalleryHighlights(viewer, GALLERY_COUNT) : [],
    alumni ? listShowcaseCards(PROJECT_COUNT) : [],
    prisma.user.count({ where: await currentTermMemberWhere(request) }),
    prisma.project.count({ where: projectWhere }),
    prisma.projectPartner.findMany({
      where: { project: projectWhere },
      distinct: ["partnerOrgId"],
      select: { partnerOrgId: true },
    }),
    term
      ? prisma.timeEntry.aggregate({
          _sum: { hours: true },
          where: { date: { gte: term.startDate, lte: term.endDate } },
        })
      : null,
    community ? prisma.galleryPost.count({ where: { hiddenAt: null } }) : 0,
  ]);

  return {
    community,
    alumni,
    termCode: term?.code ?? null,
    stats: {
      members,
      projects: projectsTotal,
      partners: partnerRows.length,
      hours: hoursAgg?._sum.hours ? Math.round(hoursAgg._sum.hours) : null,
      photos: photosTotal,
    },
    showcaseProjects,
    projects: await Promise.all(
      projectRows.map(async (p) => ({
        id: p.id,
        name: p.name,
        iconEmoji: p.iconEmoji,
        status: p.status,
        firstTermCode: p.projectTerms[0]?.term.code ?? null,
        imageUrl: await resolvePhotoUrl(p.imageUrl),
        partners: await Promise.all(
          p.partners.map(async (pp) => ({
            name: pp.partnerOrg.name,
            logoUrl: await resolvePhotoUrl(pp.partnerOrg.logoUrl),
          })),
        ),
        showcaseStatus: p.showcase?.status ?? null,
      })),
    ),
    stories: storyRows.map((s) => ({
      id: s.id,
      title: s.title,
      ...blogListing(s),
      isPublic: s.visibility === "Public",
      author: fullName(s.author),
      date: s.publishedAt ? formatDateShort(s.publishedAt) : null,
    })),
    storiesTotal,
    gallery,
  };
}

type Story = {
  id: string;
  title: string;
  excerpt: string;
  coverImageUrl: string | null;
  isPublic: boolean;
  author: string;
  date: string | null;
};

export default function Currently() {
  const {
    community,
    alumni,
    termCode,
    stats,
    projects,
    showcaseProjects,
    stories,
    storiesTotal,
    gallery,
  } = useLoaderData<typeof loader>();
  const projectCount = alumni ? showcaseProjects.length : projects.length;
  const tiles: Tile[] = [
    { label: "Members this term", value: stats.members, icon: UsersRound, tint: "accent" },
    { label: "Projects this term", value: stats.projects, icon: FolderKanban, tint: "green" },
    { label: "Partners this term", value: stats.partners, icon: Handshake, tint: "amber" },
    ...(stats.hours !== null
      ? [{ label: "Hours logged this term", value: stats.hours, icon: Clock, tint: "accent" } as Tile]
      : []),
    ...(community
      ? [{ label: "Photos shared", value: stats.photos, icon: Images, tint: "red" } as Tile]
      : []),
  ];

  return (
    <div className="flex flex-col gap-8 md:min-h-0 md:flex-1 md:gap-4">
      <StatBand tiles={tiles} />

      {community && (
        <Section id="stories-h" grow={1.1}>
          <SectionHeader
            id="stories-h"
            title="Stories"
            meta={stories.length > 0 ? `${storiesTotal} published` : null}
            cta="See all stories"
            to="/resources"
          />
          {stories.length > 0 ? (
            <Row>
              {stories.map((p) => (
                <StoryCard key={p.id} post={p} />
              ))}
            </Row>
          ) : (
            <Empty text="Nothing published yet. New stories from the lab will show up here." />
          )}
        </Section>
      )}

      {community && (
        <Section id="gallery-h" grow={1} divider>
          <SectionHeader
            id="gallery-h"
            title="Gallery"
            meta={gallery.length > 0 ? "Latest photos from members, staff and alumni" : null}
            cta="See all photos"
            to="/community/gallery"
          />
          {gallery.length > 0 ? (
            <Row>
              {(gallery as GalleryTileData[]).map((post) => (
                <Link
                  key={post.id}
                  to={galleryPostHref(post.id)}
                  className="group shrink-0 snap-start overflow-hidden rounded-os-card md:h-full"
                >
                  <img
                    src={post.imageUrl}
                    alt={post.caption ?? ""}
                    style={{ aspectRatio: `${post.width} / ${post.height}` }}
                    className="h-48 w-auto object-cover transition-transform duration-300 ease-out motion-safe:group-hover:scale-[1.03] md:h-full"
                  />
                </Link>
              ))}
            </Row>
          ) : (
            <Empty text="Nothing posted yet. Photos from the lab will show up here." />
          )}
        </Section>
      )}

      <Section id="projects-h" grow={1.3} divider={community}>
        <SectionHeader
          id="projects-h"
          title="Projects"
          meta={
            projectCount > 0
              ? alumni
                ? "From the DALI showcase"
                : `In progress this term${termCode ? ` · ${termCode}` : ""}`
              : null
          }
          cta="See all projects"
          to="/projects"
        />
        {projectCount > 0 ? (
          <Row>
            {alumni
              ? showcaseProjects.map((p) => (
                  <div key={p.id} className="w-[280px] shrink-0 snap-start md:h-full">
                    <ShowcaseCard showcase={p} />
                  </div>
                ))
              : projects.map((p) => (
                  <div key={p.id} className="w-[280px] shrink-0 snap-start md:h-full">
                    <OsProjectCard project={p} fill />
                  </div>
                ))}
          </Row>
        ) : (
          <Empty
            text={
              alumni
                ? "Nothing published yet. Showcased projects will show up here."
                : `No projects running${termCode ? ` in ${termCode}` : ""} yet.`
            }
          />
        )}
      </Section>
    </div>
  );
}

function compact(n: number): string {
  if (n >= 10000) return `${Math.round(n / 100) / 10}K`;
  return n.toLocaleString("en-US");
}

type Tile = {
  label: string;
  value: number;
  icon: LucideIcon;
  tint: "accent" | "green" | "amber" | "red";
};

const TINT = {
  accent: "bg-os-accent/15 text-os-accent",
  green: "bg-os-green/15 text-os-green",
  amber: "bg-os-amber/15 text-os-amber",
  red: "bg-os-red/15 text-os-red",
} as const;

function StatBand({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="no-scrollbar flex shrink-0 items-stretch gap-0 overflow-x-auto rounded-os-card bg-gradient-to-r from-os-accent/15 via-os-accent/5 to-os-green/10">
      {tiles.map((t, i) => (
        <div
          key={t.label}
          className={cn(
            "flex min-w-44 flex-1 items-center gap-4 px-6 py-4",
            i > 0 && "border-l border-os-container/60",
          )}
        >
          <span
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
              TINT[t.tint],
            )}
            aria-hidden
          >
            <t.icon className="h-5 w-5" />
          </span>
          <span className="flex min-w-0 flex-col">
            <CountUp value={t.value} />
            <span className="whitespace-nowrap text-sm text-os-grey">{t.label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const duration = 900;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <span className="font-heading text-4xl font-semibold leading-none text-foreground tabular-nums">
      {compact(shown)}
    </span>
  );
}

function Section({
  id,
  grow,
  divider = false,
  children,
}: {
  id: string;
  grow: number;
  divider?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{ "--grow": grow } as React.CSSProperties}
      className={cn(
        "flex flex-col gap-4 md:min-h-0 md:flex-[var(--grow)]",
        divider && "border-t border-os-container pt-6 md:pt-4",
      )}
      aria-labelledby={id}
    >
      {children}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="no-scrollbar -mx-2 flex snap-x items-stretch gap-5 overflow-x-auto px-2 py-1 md:min-h-0 md:flex-1">
      {children}
    </div>
  );
}

function SectionHeader({
  id,
  title,
  meta,
  cta,
  to,
}: {
  id: string;
  title: string;
  meta: string | null;
  cta: string;
  to: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 id={id} className="font-heading text-xl font-semibold text-foreground">
          {title}
        </h2>
        {meta && <p className="text-sm text-os-grey">{meta}</p>}
      </div>
      <Link
        to={to}
        className="group inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-semibold text-os-accent transition-colors duration-150 ease-out hover:bg-os-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/60"
      >
        {cta}
        <ArrowRight
          className="h-4 w-4 transition-transform duration-150 ease-out group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    </div>
  );
}

function StoryCard({ post }: { post: Story }) {
  return (
    <Link
      to={`/resources/blog/${post.id}`}
      className="group flex w-72 shrink-0 snap-start flex-col gap-3 md:h-full"
    >
      <img
        src={post.coverImageUrl ?? DEFAULT_BLOG_COVER}
        alt=""
        className="aspect-[3/2] w-full rounded-lg object-cover md:aspect-auto md:min-h-0 md:flex-1"
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 className="line-clamp-2 font-heading text-lg font-semibold leading-tight text-foreground group-hover:underline">
          {post.title}
        </h3>
        <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-os-grey">
          {post.author}
          {post.date && <span className="font-normal normal-case tracking-normal">{post.date}</span>}
          {post.isPublic && <Globe className="h-3.5 w-3.5" aria-label="Also on the DALI website" />}
        </p>
      </div>
    </Link>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-os-card bg-os-well px-6 py-10 text-center text-sm text-os-grey">{text}</p>
  );
}
