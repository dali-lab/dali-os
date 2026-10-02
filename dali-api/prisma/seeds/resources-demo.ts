/**
 * Demo content for Resources (/resources): a handful of blog posts on The
 * Scoop in every state the page has to draw (pinned lead, public, internal,
 * with and without a cover, a draft), plus two bookmark pages, one of them
 * built from the component library.
 *
 * Idempotent — every row is upserted on a stable id, so re-seeding is safe.
 * Runs as part of `prisma db seed`, or alone against an existing database:
 *
 *   npm run db:seed:resources-demo
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../../app/generated/prisma/client.js";
import type { DocBlock } from "../../app/collab/blocknote-server.js";
import { resourcesRoomName } from "../../app/collab/roomName.js";
import { replaceCollabDocContent } from "../../app/collab/write.js";
import { COMPONENT_KINDS } from "../../app/components/doc/components/kinds.js";
import { deriveBlogPreview } from "../../app/lib/blog-preview.js";

const DAY = 86_400_000;

function block(type: string, text: string, props: Record<string, unknown> = {}): DocBlock {
  return {
    id: randomUUID(),
    type,
    props: { backgroundColor: "default", textColor: "default", textAlignment: "left", ...props },
    content: text ? [{ type: "text", text, styles: {} }] : [],
    children: [],
  };
}

const h = (text: string, level = 2) => block("heading", text, { level });
const p = (text: string) => block("paragraph", text);
const li = (text: string) => block("bulletListItem", text);
const image = (url: string): DocBlock => ({
  id: randomUUID(),
  type: "image",
  props: { url, caption: "", previewWidth: 720, textAlignment: "center", backgroundColor: "default" },
  content: undefined,
  children: [],
});

type Data = { fields: Record<string, string>; items: Record<string, string>[] };
const component = (kind: string, data?: Data): DocBlock => ({
  id: randomUUID(),
  type: "component",
  props: {
    kind,
    data: JSON.stringify(data ?? COMPONENT_KINDS.find((k) => k.kind === kind)!.defaults),
  },
  content: undefined,
  children: [],
});

const photo = (seed: string) => `https://picsum.photos/seed/${seed}/1600/900`;

type DemoPost = {
  id: string;
  title: string;
  daysAgo: number | null; // null = draft
  isPublic?: boolean;
  rank?: number;
  summary?: string;
  body: DocBlock[];
};

const POSTS: DemoPost[] = [
  {
    id: "blog-demo-crit-night",
    title: "What we learned from the first crit night of the term",
    daysAgo: 1,
    isPublic: true,
    rank: 0,
    summary: "Twelve teams, ninety minutes, and one rule: show the thing, not the slides.",
    body: [
      image(photo("dali-crit")),
      p("Crit night used to be a slideshow. This term every team put a working flow on the big screen and let the room poke at it."),
      h("Three things that worked"),
      li("Five minutes of silent use before anyone speaks."),
      li("One named question per team, written on the board."),
      li("Mentors go last."),
      component("stats", {
        fields: {},
        items: [
          { value: "12", label: "Teams presenting", tone: "accent" },
          { value: "90", label: "Minutes", tone: "neutral" },
          { value: "147", label: "Sticky notes", tone: "warning" },
        ],
      }),
      p("We will run it the same way in week seven. Bring a prototype someone else can click."),
    ],
  },
  {
    id: "blog-demo-design-tokens",
    title: "A field guide to the lab's design tokens",
    daysAgo: 3,
    isPublic: true,
    body: [
      image(photo("dali-tokens")),
      p("Every DALI project starts from the same handful of colors, type sizes and spacing steps. Here is how to use them without fighting them."),
      h("Start with spacing"),
      p("If a layout feels off, it is almost always spacing. Pick from the scale and stop nudging by a pixel."),
    ],
  },
  {
    id: "blog-demo-user-testing",
    title: "How to run a user test in a dining hall",
    daysAgo: 5,
    body: [
      p("You do not need a lab. You need a table near the door, a phone with the prototype loaded, and a bag of candy."),
      h("The script"),
      li("Ask what they did last time they had this problem."),
      li("Hand over the phone and stop talking."),
      li("Write down what they do, not what they say."),
    ],
  },
  {
    id: "blog-demo-partner-kickoff",
    title: "Notes from a partner kickoff that went well",
    daysAgo: 8,
    isPublic: true,
    body: [
      image(photo("dali-kickoff")),
      p("The best kickoffs end with a shared sentence about who the product is for. This one took forty minutes to get there, and it was worth it."),
    ],
  },
  {
    id: "blog-demo-dev-setup",
    title: "The ten minute dev setup",
    daysAgo: 12,
    body: [
      p("Clone, install, seed, run. If your project takes longer than ten minutes to start for a new teammate, fix that before you write another feature."),
      component("bars", {
        fields: { title: "Minutes to first run, by project" },
        items: [
          { label: "Atlas", value: "6", tone: "success" },
          { label: "Coffee Run", value: "11", tone: "warning" },
          { label: "Lab Tour", value: "24", tone: "danger" },
        ],
      }),
    ],
  },
  {
    id: "blog-demo-demo-day",
    title: "Demo Day is in five weeks. Here is the plan",
    daysAgo: 15,
    body: [
      image(photo("dali-demo-day")),
      p("Posters are due in week nine, the run of show goes out in week eight, and every team gets one rehearsal on the real stage."),
      component("timeline", {
        fields: { title: "Road to Demo Day", note: "", current: "2" },
        items: [
          { label: "Pitch draft" },
          { label: "Poster" },
          { label: "Rehearsal" },
          { label: "Demo Day" },
        ],
      }),
    ],
  },
  {
    id: "blog-demo-draft",
    title: "Things I wish I knew my first term",
    daysAgo: null,
    body: [p("Ask for the Figma file on day one. Go to crit even when you have nothing to show.")],
  },
];

const BOOKMARKS: { id: string; title: string; body: DocBlock[] }[] = [
  {
    id: "bookmark-demo-design-hub",
    title: "Design Hub",
    body: [
      h("Design Hub", 1),
      p("Everything DALI designers need this term: crit prep, testing kits and craft resources."),
      component("chips", {
        fields: { label: "Quick start" },
        items: [
          { label: "New to DALI", href: "/help" },
          { label: "Prepping for crit", href: "" },
          { label: "Running user testing", href: "" },
        ],
      }),
      component("cards"),
      component("timeline", {
        fields: { title: "Term timeline", note: "Now: test round 1", current: "4" },
        items: [
          { label: "Kickoff" },
          { label: "Research" },
          { label: "Crit 1" },
          { label: "Test round 1" },
          { label: "E2E prototype" },
          { label: "Crit 2" },
          { label: "Demo Day" },
        ],
      }),
      component("links", {
        fields: { title: "Crits", subtitle: "Format, decks and feedback norms" },
        items: [
          { title: "How DALI crits work", description: "Format, timing and what mentors look for.", meta: "Sep 12", href: "" },
          { title: "Crit deck template", description: "Keeps crits to 12 minutes.", meta: "Sep 12", href: "" },
        ],
      }),
      component("gallery"),
    ],
  },
  {
    id: "bookmark-demo-handbook",
    title: "Member handbook",
    body: [
      h("Member handbook", 1),
      p("How the lab runs, in one page."),
      h("Hours"),
      li("Log hours weekly in Timesheets."),
      li("Lab hours are Monday to Thursday, 4pm to 10pm."),
      h("Getting help"),
      p("Ask your mentor first, then post in the lab channel."),
    ],
  },
];

export async function seedResourcesDemo(prisma: PrismaClient, opts: { adminId: string }) {
  // Spread the bylines across a few members so the page isn't one name.
  const others = await prisma.user.findMany({
    where: { id: { not: opts.adminId } },
    orderBy: { createdAt: "asc" },
    take: 3,
    select: { id: true },
  });
  const authors = [opts.adminId, ...others.map((u) => u.id)];

  for (const [i, post] of POSTS.entries()) {
    const data = {
      title: post.title,
      contentJson: post.body as unknown as object,
      ...deriveBlogPreview(post.body),
      summary: post.summary ?? null,
      visibility: post.isPublic ? ("Public" as const) : ("Internal" as const),
      publishedAt: post.daysAgo === null ? null : new Date(Date.now() - post.daysAgo * DAY),
      frontPageRank: post.rank ?? null,
      // The draft belongs to the admin, so the seeded login sees it.
      authorId: post.daysAgo === null ? opts.adminId : authors[i % authors.length]!,
    };
    await prisma.blogPost.upsert({ where: { id: post.id }, update: data, create: { id: post.id, ...data } });
  }

  for (const [position, bookmark] of BOOKMARKS.entries()) {
    await prisma.resourceBookmark.upsert({
      where: { id: bookmark.id },
      update: { title: bookmark.title },
      create: { id: bookmark.id, title: bookmark.title, position: position + 1 },
    });
    await replaceCollabDocContent(resourcesRoomName(bookmark.id), bookmark.body, opts.adminId);
  }

  return { posts: POSTS.length, bookmarks: BOOKMARKS.length };
}

// Standalone run against an existing database (no reset).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  (async () => {
    const admin =
      (await prisma.user.findFirst({ where: { adminMembership: { isNot: null } }, select: { id: true } })) ??
      (await prisma.user.findFirstOrThrow({ select: { id: true } }));
    const out = await seedResourcesDemo(prisma, { adminId: admin.id });
    console.log(`✓ Seeded ${out.posts} blog posts and ${out.bookmarks} bookmarks.`);
  })()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
