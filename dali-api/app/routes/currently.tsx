import { Link, useLoaderData } from "react-router";
import { ArrowRight, Globe } from "lucide-react";
import type { Route } from "./+types/currently";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { getUserRoles, currentTerm } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { loadGalleryHighlights, type GalleryTileData } from "~/community/lib/gallery.server";
import { BLOG_LISTING_ORDER } from "~/lib/blog-post.server";
import { blogListing, DEFAULT_BLOG_COVER } from "~/lib/blog-preview";
import { resolvePhotoUrl } from "~/lib/photo";
import { formatDateShort, fullName } from "~/lib/display";
import { cn } from "~/lib/cn";
import { GalleryMasonry } from "~/community/components/GalleryMasonry";
import { OsProjectCard } from "~/projects/components/OsProjectCard";

export const meta: Route.MetaFunction = () => [{ title: "Currently in DALI · DALI OS" }];

export const handle = { breadcrumb: () => "Currently in DALI" };

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

  const [projectRows, storyRows, storiesTotal, gallery] = await Promise.all([
    prisma.project.findMany({
      where: {
        status: "Active",
        ...(term ? { projectTerms: { some: { termId: term.id } } } : {}),
      },
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
  ]);

  return {
    community,
    termCode: term?.code ?? null,
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
  const { community, termCode, projects, stories, storiesTotal, gallery } =
    useLoaderData<typeof loader>();
  const [lead, ...rest] = stories;
  const side = rest.slice(0, 3);

  return (
    <div className="flex flex-col gap-12">
      <header>
        <h1 className="font-heading text-4xl font-medium text-foreground">Currently in DALI</h1>
      </header>

      {community && (
        <section className="flex flex-col gap-6" aria-labelledby="stories-h">
          <SectionHeader
            id="stories-h"
            title="Stories"
            meta={lead ? `${storiesTotal} published` : null}
            cta="See all stories"
            to="/resources"
          />
          {lead ? (
            <div className="grid gap-8 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <StoryCard post={lead} size="lead" />
              </div>
              <div className="flex flex-col divide-y divide-os-container xl:border-l xl:border-os-container xl:pl-8">
                {side.map((p) => (
                  <div key={p.id} className="py-5 first:pt-0 last:pb-0">
                    <StoryCard post={p} size="side" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Empty text="Nothing published yet. New stories from the lab will show up here." />
          )}
        </section>
      )}

      {community && (
        <section
          className={cn("flex flex-col gap-6", "border-t border-os-container pt-10")}
          aria-labelledby="gallery-h"
        >
          <SectionHeader
            id="gallery-h"
            title="Gallery"
            meta={gallery.length > 0 ? "Latest photos from members, staff and alumni" : null}
            cta="See all photos"
            to="/community/gallery"
          />
          {gallery.length > 0 ? (
            <GalleryMasonry posts={gallery as GalleryTileData[]} />
          ) : (
            <Empty text="Nothing posted yet. Photos from the lab will show up here." />
          )}
        </section>
      )}

      <section
        className={cn("flex flex-col gap-6", community && "border-t border-os-container pt-10")}
        aria-labelledby="projects-h"
      >
        <SectionHeader
          id="projects-h"
          title="Projects"
          meta={
            projects.length > 0
              ? `In progress this term${termCode ? ` · ${termCode}` : ""}`
              : null
          }
          cta="See all projects"
          to="/projects"
        />
        {projects.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <OsProjectCard key={p.id} project={p} />
            ))}
          </div>
        ) : (
          <Empty text={`No projects running${termCode ? ` in ${termCode}` : ""} yet.`} />
        )}
      </section>
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

function StoryCard({ post, size }: { post: Story; size: "lead" | "side" }) {
  return (
    <Link
      to={`/resources/blog/${post.id}`}
      className={cn(
        "group",
        size === "lead" && "grid items-start gap-6 md:grid-cols-5",
        size === "side" && "flex items-start gap-4",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-col gap-2 px-2 py-1",
          size === "lead" ? "md:col-span-2" : "flex-1",
        )}
      >
        <h3
          className={cn(
            "font-heading font-semibold leading-tight text-foreground group-hover:underline",
            size === "lead" ? "text-3xl xl:text-4xl" : "text-lg",
          )}
        >
          {post.title}
        </h3>
        {post.excerpt && size === "lead" && (
          <p className="line-clamp-5 text-base text-os-grey">{post.excerpt}</p>
        )}
        <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-os-grey">
          {post.author}
          {post.date && <span className="font-normal normal-case tracking-normal">{post.date}</span>}
          {post.isPublic && <Globe className="h-3.5 w-3.5" aria-label="Also on the DALI website" />}
        </p>
      </div>
      <img
        src={post.coverImageUrl ?? DEFAULT_BLOG_COVER}
        alt=""
        className={cn(
          "rounded-lg object-cover",
          size === "lead" ? "aspect-[3/2] w-full md:col-span-3" : "h-20 w-28 shrink-0",
        )}
      />
    </Link>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-os-card bg-os-well px-6 py-10 text-center text-sm text-os-grey">{text}</p>
  );
}
