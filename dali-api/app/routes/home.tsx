import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link, redirect, useLoaderData, useRevalidator } from "react-router";
import {
  AlignLeft,
  ListTodo,
  ListChecks,
  Check,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Search,
  CalendarClock,
  GraduationCap,
  MapPin,
  Milestone,
  Star,
  UserRound,
  X,
} from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { listOpenTasks, type Task } from "~/lib/tasks";
import { listFavoritesAndRecents, type FavoritePage } from "~/lib/user-pages.server";
import { loadShellUser } from "~/lib/shell-user.server";
import { timed } from "~/lib/server-timing";
import { ProjectIcon } from "~/components/ProjectIcon";
import { FavoriteIcon } from "~/components/FavoriteIcon";
import { FavoriteStar } from "~/components/FavoriteStar";
import { FavoriteRouteButton } from "~/components/FavoriteRouteButton";
import { isNavbarRoute } from "~/lib/navbar-routes";
import { listCatalog, registrationOpen } from "~/education/lib/offerings.server";
import { listUpcomingSessionsForUser } from "~/education/lib/schedule.server";
import { fetchGeneralCalendarEvents } from "~/lib/general-calendar";
import { getUserRoles } from "~/lib/roles";
import { resolveHomeSurface } from "~/lib/feature-flags.server";
import { TYPE_META } from "~/components/CommandPalette";
import { MIN_QUERY_LENGTH, type SearchResult } from "~/lib/search";
import { Avatar } from "~/components/ui/Avatar";
import {
  getZonedHourFraction,
  getZonedYMD,
  resolveUserTimeZone,
  zonedDayStartUtc,
} from "~/lib/timezone";
import { RsvpButtons, notifyTasksChanged } from "~/components/RsvpButtons";
import type { Route } from "./+types/home";
import {
  WeekCalendarPanel,
  formatWeekRange,
} from "~/components/WeekCalendarPanel";
import {
  generalCalendarWeekEvents,
  resolveWeekWindow,
} from "~/lib/week-events";

type HomeNotification = {
  id: string;
  kind: "General" | "MeetingInvite" | "MeetingReminder" | "SystemAnnouncement" | "Education";
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  scheduledMeetingId: string | null;
  rsvp: "Accepted" | "Declined" | "Tentative" | null;
};

export async function loader({ request }: Route.LoaderArgs) {
  const __loaderStart = performance.now();
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  // Which home this member gets — see the "home-surface" flag. The calendar
  // surface is the real /calendar route rather than a copy of it here: it owns
  // its own loader, action, and sub-tab chrome, so home hands the member over
  // instead of trying to re-host all three.
  const roles = await getUserRoles(auth.user.sub);
  const surface = await resolveHomeSurface(auth.user.sub, roles);
  if (surface === "calendar") return redirect("/calendar");
  const redesign = surface === "search";

  // The chosen week (Sunday→following Sunday) in the viewer's timezone, used
  // both to build the day columns and to window the calendar fetch. The shell
  // loads this same user row concurrently, so the memoized read shares it
  // rather than issuing a second lookup.
  const me = await loadShellUser(auth.user.sub, request);
  const tz = resolveUserTimeZone(me);
  const now = new Date();
  const { weekOffset, weekStart, weekEnd, weekDays } = resolveWeekWindow(
    request,
    tz,
    now,
  );

  const [items, tasks, rawEvents, assignedTasks, catalog, upcomingSessions, pages] =
    await Promise.all([
    timed(request, 'home.notifications', () => prisma.notification.findMany({
      // Hide invites whose meeting was Cancelled — they shouldn't appear in the
      // banner, just as they're dropped from tasks and the bell. Also hide
      // already-answered invites (Accepted/Declined/Tentative): once the user has
      // RSVP'd, the card has served its purpose and shouldn't linger.
      where: {
        recipientUserId: auth.user.sub,
        AND: [
          {
            OR: [
              { scheduledMeetingId: null },
              { scheduledMeeting: { status: { not: "Cancelled" } } },
            ],
          },
          {
            OR: [{ scheduledMeetingId: null }, { rsvp: null }],
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        link: true,
        readAt: true,
        createdAt: true,
        scheduledMeetingId: true,
        rsvp: true,
      },
    })),
    timed(request, 'home.openTasks', () => listOpenTasks(auth.user.sub)),
    // Real events from the public DALI General Calendar (empty when unconfigured
    // or on fetch failure — the panel then shows an empty grid + hint). The
    // redesigned home drops the week panel, so its external fetch goes too.
    redesign
      ? []
      : timed(request, 'home.ics', () => fetchGeneralCalendarEvents(weekStart, weekEnd)),
    // Open board tasks assigned to the viewer, across all their projects
    // (Archived projects are retired — their tasks are noise here). One
    // bounded query: soonest deadline first (undated last), then priority.
    timed(request, 'home.assignedTasks', () => prisma.task.findMany({
      where: {
        status: { in: ["Todo", "InProgress", "InReview"] },
        assignees: { some: { userId: auth.user.sub } },
        project: { status: { not: "Archived" } },
      },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
      take: 8,
      select: {
        id: true,
        title: true,
        dueAt: true,
        priority: true,
        projectId: true,
        project: { select: { name: true, iconEmoji: true } },
      },
    })),
    // Education for the home card: catalog (enrolled + open-registration +
    // open-assignment counts) and the viewer's next few sessions.
    timed(request, 'home.catalog', () => listCatalog(auth.user.sub)),
    timed(request, 'home.sessions', () => listUpcomingSessionsForUser(auth.user.sub, { limit: 3 })),
    // `request` reuses the read the shell's sidebar already kicked off for the
    // same navigation instead of re-running the per-row access checks.
    timed(request, 'home.favorites', () => listFavoritesAndRecents(auth.user.sub, request)),
  ]);

  const enrolledOfferings = catalog.filter((o) => o.myStatus === "Approved");
  const education: EducationSummary = {
    enrolledCount: enrolledOfferings.length,
    openAssignments: enrolledOfferings.reduce((s, o) => s + o.openAssignments, 0),
    openOfferings: catalog.filter((o) => registrationOpen(o)).length,
    pendingCount: catalog.filter(
      (o) => o.myStatus === "Submitted" || o.myStatus === "Waitlisted",
    ).length,
    upcoming: upcomingSessions.map((s) => ({
      id: s.id,
      offeringId: s.offeringId,
      label: s.title
        ? `${s.offeringTitle} · ${s.title}`
        : `${s.offeringTitle} · Session ${s.sequence}`,
      when: s.datetime.toLocaleString("en-US", {
        timeZone: tz,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
      location: s.location,
    })),
  };

  const myProjectTasks: MyProjectTask[] = assignedTasks.map((t) => ({
    id: t.id,
    title: t.title,
    projectId: t.projectId,
    projectName: t.project.name,
    projectIconEmoji: t.project.iconEmoji,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    priority: t.priority,
  }));

  const notifications: HomeNotification[] = items.map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
    scheduledMeetingId: n.scheduledMeetingId,
    rsvp: n.rsvp,
  }));

  const weekEvents = generalCalendarWeekEvents(rawEvents, weekStart, tz);

  // Label for the range being shown, formatted server-side in the viewer's zone
  // so the client doesn't re-derive it in the browser's.
  const weekLabel = formatWeekRange(weekStart, tz);

  const __loaderTotal = performance.now() - __loaderStart;
  if (__loaderTotal >= 400) console.log(`[perf-total] home loader ${__loaderTotal.toFixed(0)}ms`);

  return {
    redesign,
    user: auth.user,
    notifications,
    tasks,
    myProjectTasks,
    weekDays,
    weekEvents,
    weekOffset,
    weekLabel,
    timeZone: tz,
    education,
    pages: {
      favorites: pages.favorites.slice(0, HOME_PAGE_LIMIT),
      recents: pages.recents.slice(0, HOME_PAGE_LIMIT),
    },
  };
}

/* How many starred and how many recently-opened pages home shows. The lists
   themselves are longer (the sidebar shows more) — home is a landing page, not
   an index, and an unbounded pin list pushed everything else off the screen. */
const HOME_PAGE_LIMIT = 6;

type EducationSummary = {
  enrolledCount: number;
  openAssignments: number;
  openOfferings: number;
  pendingCount: number;
  upcoming: {
    id: string;
    offeringId: string;
    label: string;
    when: string;
    location: string | null;
  }[];
};

type MyProjectTask = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  projectIconEmoji: string | null;
  dueAt: string | null;
  priority: "Low" | "Normal" | "High" | "Urgent";
};

export default function Home() {
  const data = useLoaderData<typeof loader>();
  return data.redesign ? <HomeRedesign /> : <HomeClassic />;
}

/* ------------------------------------------------------------------ */
/* Redesigned home (behind `sidebar-redesign`, alongside the new left   */
/* navigation): a search-first landing page — logo, the same indexed    */
/* search the navbar runs, shortcuts to starred/recent pages, and the   */
/* attention surfaces below. No general-calendar week panel.            */
/* ------------------------------------------------------------------ */

function HomeRedesign() {
  const { user, notifications, tasks, myProjectTasks, education, pages } =
    useLoaderData<typeof loader>();
  const firstName = user.firstName || user.email.split("@")[0];

  const compactBlocks = [
    myProjectTasks.length > 0 && <MyTasksPanel tasks={myProjectTasks} />,
    hasEducationContent(education) && <EducationPanel education={education} />,
  ].filter(Boolean);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
      <div className="flex flex-col items-center gap-5 pt-12 sm:pt-20">
        {/* The blue mark disappears against the dark page, so each theme gets
            its own file rather than a filter. */}
        <img src="/logo-blue.svg" alt="DALI Lab" className="h-20 w-auto sm:h-24 dark:hidden" />
        <img
          src="/logo-white.svg"
          alt=""
          aria-hidden
          className="hidden h-20 w-auto sm:h-24 dark:block"
        />
        <p className="text-sm text-muted-foreground">Welcome back, {firstName}</p>
        <HomeSearch />
        <ShortcutTiles pages={pages} />
      </div>

      <div className="flex flex-col gap-6">
        <MilestonesBanner />

        <AttentionBanner tasks={tasks} notifications={notifications} />

        {compactBlocks.length > 1 ? (
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            {[0, 1].map((col) => (
              <div key={col} className="flex min-w-0 flex-1 flex-col gap-6">
                {compactBlocks
                  .filter((_, i) => i % 2 === col)
                  .map((block, i) => (
                    <div key={i} className="min-w-0">
                      {block}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="min-w-0">{compactBlocks[0]}</div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Milestones — a pointer to the term timeline. Sits at the top of the   */
/* attention column so the shape of the term is one click from the front */
/* door.                                                                 */
/* ------------------------------------------------------------------ */

function MilestonesBanner() {
  return (
    <Link
      to="/milestones"
      className="group flex items-center gap-3 rounded-lg border border-accent-coral/30 bg-accent-coral/10 p-3 transition-colors hover:bg-accent-coral/15"
    >
      <Milestone className="h-4 w-4 flex-shrink-0 text-accent-coral" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-heading text-sm font-semibold text-foreground">
          Check out our new milestones
        </span>
        <span className="block text-xs text-muted-foreground">
          The term week by week — lab-wide events, team milestones, and what each domain owns.
        </span>
      </span>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-accent-coral transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Search — a real input, answered in place. It queries the same         */
/* /api/search endpoint the command palette uses (so permissions and     */
/* ranking stay in one place), but the home page is the search surface:  */
/* typing here does not open the palette modal.                          */
/* ------------------------------------------------------------------ */

function HomeSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced + abortable, mirroring the palette: aborting per keystroke also
  // drops stale in-flight responses so a slow one can't overwrite a newer query.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        credentials: "include",
        signal: ctrl.signal,
      })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => {
          setResults(d.results ?? []);
          setActive(0);
        })
        .catch(() => {
          /* aborted or network error — leave prior results */
        });
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  // Close the result list on an outside click, leaving the query in the field.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const show = open && query.trim().length >= MIN_QUERY_LENGTH;

  // Home renders inside the workspace iframe, so a result opens as a workspace
  // tab rather than navigating this view away — same rule as every other link
  // on this page.
  const openResult = (r: SearchResult) => {
    if (window.self !== window.top) {
      window.parent.postMessage(
        { type: "dali:openTab", url: r.url, label: r.title },
        window.location.origin,
      );
    } else {
      window.location.assign(r.url);
    }
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!show || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[active];
      if (hit) openResult(hit);
    }
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-2xl">
      <div className="flex items-center gap-3 rounded-full border border-border bg-card px-6 py-4 shadow-brand-1 focus-within:ring-2 focus-within:ring-accent-teal">
        <Search className="h-5 w-5 flex-shrink-0 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search people, projects, documents…"
          aria-label="Search"
          role="combobox"
          aria-expanded={show}
          aria-controls="home-search-results"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      {show && (
        // Absolute so a long result list never pushes the shortcut tiles down.
        <div
          id="home-search-results"
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-2 max-h-96 overflow-y-auto rounded-2xl border border-border bg-card py-2 text-left shadow-brand-2"
        >
          {results.length === 0 ? (
            <p className="px-5 py-3 text-sm text-muted-foreground">
              No matches for “{query.trim()}”
            </p>
          ) : (
            results.map((r, i) => {
              const Icon = TYPE_META[r.type].icon;
              return (
                <button
                  key={`${r.type}-${r.id}`}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => openResult(r)}
                  className={`flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                    i === active ? "bg-muted/60" : "hover:bg-muted/40"
                  }`}
                >
                  {r.type === "person" ? (
                    <Avatar photoUrl={r.photoUrl} name={r.title} size="xs" />
                  ) : r.iconEmoji ? (
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center leading-none">
                      {r.iconEmoji}
                    </span>
                  ) : (
                    <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{r.title}</span>
                  {r.subtitle && (
                    <span className="max-w-[40%] flex-shrink-0 truncate text-xs text-muted-foreground">
                      {r.subtitle}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shortcuts — starred pages first, then the ones you opened recently,  */
/* as a tile row under the search box. Replaces the Favorites list      */
/* panel on the redesigned home.                                        */
/* ------------------------------------------------------------------ */

/** Favorites then recents, sharing one row — same ceiling as HOME_PAGE_LIMIT. */
const SHORTCUT_LIMIT = HOME_PAGE_LIMIT;

function ShortcutTiles({
  pages,
}: {
  pages: { favorites: FavoritePage[]; recents: FavoritePage[] };
}) {
  const revalidator = useRevalidator();
  // Starring here re-sorts the row: an un-starred page drops back among the
  // recents, and a starred one rises out of them.
  const onChanged = () => revalidator.revalidate();
  const shortcuts = [...pages.favorites, ...pages.recents].slice(0, SHORTCUT_LIMIT);

  // Nothing starred and nothing opened yet — a brand-new account. Render
  // nothing: the search box above is the only thing to do here, and a line of
  // instructions under it just crowds that.
  if (shortcuts.length === 0) return null;

  // The row is one merged list, so name only the halves that survived the
  // slice — captioning "recently visited" over nothing but favorites lies.
  const shownFavorites = Math.min(pages.favorites.length, shortcuts.length);
  const caption =
    shownFavorites === 0
      ? "Recently visited"
      : shownFavorites === shortcuts.length
        ? "Favorites"
        : "Favorites & recently visited";

  return (
    // Wrapping row rather than a grid so a partial last row stays centered
    // under the search box.
    <div className="flex w-full max-w-xl flex-col items-center gap-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {caption}
      </p>
      <div className="flex w-full flex-wrap justify-center gap-1">
        {shortcuts.map((p) => (
          <ShortcutTile key={p.id} page={p} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}

function ShortcutTile({ page, onChanged }: { page: FavoritePage; onChanged: () => void }) {
  return (
    // Link + star are siblings: the star must not navigate.
    <div className="group relative w-20">
      <a
        href={page.href}
        className="flex flex-col items-center gap-1.5 rounded-lg px-1 py-3 transition-colors hover:bg-muted/50"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card shadow-brand-1">
          <FavoriteIcon page={page} />
        </span>
        <span className="w-full truncate text-center text-[11px] text-foreground">
          {page.title || "Untitled"}
        </span>
      </a>
      {/* Recents show a hollow star on hover — a way to keep the page without
          hunting for it — while a favorite always shows its filled one. */}
      {(page.favorited || !page.isRoute || !isNavbarRoute(page.href)) && (
        <span
          className={`absolute right-0 top-1 ${
            page.favorited ? "" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"
          }`}
        >
          {page.isRoute ? (
            <FavoriteRouteButton
              href={page.href}
              label={page.title}
              favorited={page.favorited}
              onToggled={onChanged}
              compact
            />
          ) : (
            <FavoriteStar pageId={page.id} favorited={page.favorited} onToggled={onChanged} />
          )}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Today's home, unchanged — what everyone sees with the flag off.      */
/* ------------------------------------------------------------------ */

function HomeClassic() {
  const {
    user,
    notifications,
    tasks,
    myProjectTasks,
    weekDays,
    weekEvents,
    weekOffset,
    weekLabel,
    timeZone,
    education,
    pages,
  } = useLoaderData<typeof loader>();
  const firstName = user.firstName || user.email.split("@")[0];

  // Only the blocks that will actually render — see the grid below.
  const compactBlocks = [
    myProjectTasks.length > 0 && <MyTasksPanel tasks={myProjectTasks} />,
    <FavoritesPanel pages={pages} />,
    hasEducationContent(education) && <EducationPanel education={education} />,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Welcome back, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Here&apos;s what&apos;s happening in the lab.
        </p>
      </header>

      <AttentionBanner tasks={tasks} notifications={notifications} />

      {/* The compact blocks flow two-up on wide screens. Rather than a grid
          (whose rows align across columns, so a short card gets pinned to the
          bottom of a taller neighbour and leaves a gap), the blocks are dealt
          round-robin into two independent columns that each pack their own
          stack — a short card sits directly under the one above it. Each block
          hides itself when empty, so the list is built from what will actually
          render; a lone block takes the full width. */}
      {compactBlocks.length > 1 ? (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          {[0, 1].map((col) => (
            <div key={col} className="flex min-w-0 flex-1 flex-col gap-6">
              {compactBlocks
                .filter((_, i) => i % 2 === col)
                .map((block, i) => (
                  <div key={i} className="min-w-0">
                    {block}
                  </div>
                ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="min-w-0">{compactBlocks[0]}</div>
      )}

      <div className="flex flex-col gap-6">
        <WeekCalendarPanel
          days={weekDays}
          events={weekEvents}
          weekOffset={weekOffset}
          weekLabel={weekLabel}
          timeZone={timeZone}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Education — enrolled courses, next sessions, and open registration.  */
/* Collapses to nothing when the member has no education activity, so    */
/* the widget works for everyone (including non-students).               */
/* ------------------------------------------------------------------ */

// Whether the Education block has anything to say. Exported shape so the home
// layout can count visible blocks without duplicating the rule.
function hasEducationContent(e: EducationSummary): boolean {
  return (
    e.enrolledCount > 0 || e.openOfferings > 0 || e.pendingCount > 0 || e.upcoming.length > 0
  );
}

function EducationPanel({ education }: { education: EducationSummary }) {
  const { enrolledCount, openAssignments, openOfferings, pendingCount, upcoming } = education;
  if (!hasEducationContent(education)) {
    return null;
  }
  const blurb =
    enrolledCount > 0
      ? `You're enrolled in ${enrolledCount} course${enrolledCount === 1 ? "" : "s"}${
          openAssignments > 0
            ? ` — ${openAssignments} assignment${openAssignments === 1 ? "" : "s"} waiting on you`
            : ""
        }.`
      : openOfferings > 0
        ? `${openOfferings} workshop${openOfferings === 1 ? " or miniseries is" : "s and miniseries are"} open for registration.`
        : "Workshops and miniseries are posted here each term.";
  return (
    <section className="bg-card border border-border shadow-brand-1 rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
          <GraduationCap className="w-4 h-4 text-accent-coral" />
          Education
        </h2>
        <Link to="/education" className={buttonClasses("secondary", "sm")}>
          {enrolledCount > 0 ? "My courses" : "Browse offerings"}
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">{blurb}</p>
      {(openAssignments > 0 || pendingCount > 0) && (
        <div className="flex items-center gap-2 flex-wrap">
          {openAssignments > 0 && (
            <span className="inline-flex items-center rounded-full bg-accent-coral text-white px-2.5 py-1 text-xs font-semibold">
              {openAssignments} assignment{openAssignments === 1 ? "" : "s"} due
            </span>
          )}
          {pendingCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2.5 py-1 text-xs font-semibold">
              {pendingCount} application{pendingCount === 1 ? "" : "s"} pending
            </span>
          )}
        </div>
      )}
      {upcoming.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-t border-border pt-3">
          {upcoming.map((s) => (
            <li key={s.id} className="text-xs">
              <Link
                to={`/education/${s.offeringId}/hub`}
                className="font-medium text-foreground hover:underline"
              >
                {s.label}
              </Link>
              <span className="text-muted-foreground">
                {" "}
                · {s.when}
                {s.location ? ` · ${s.location}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* My tasks — open project-board tasks assigned to the viewer, soonest  */
/* deadline first. Each row deep-links to the task modal on its          */
/* project board. Collapses to nothing when the viewer has none.         */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Favorites — pages you starred, then the ones you opened most recently. */
/* ------------------------------------------------------------------ */

function PageRow({ page, onChanged }: { page: FavoritePage; onChanged: () => void }) {
  return (
    // Link + star are siblings: the star must not navigate.
    <div className="group flex items-center gap-1 rounded-md hover:bg-muted/50 transition-colors">
      <a href={page.href} className="flex flex-1 min-w-0 items-center gap-2 px-2 py-1.5 text-sm">
        <FavoriteIcon page={page} />
        <span className="truncate text-foreground">{page.title || "Untitled"}</span>
      </a>
      {/* Recents show a hollow star on hover — a way to keep the page without
          hunting for it — while a favorite always shows its filled one. */}
      {(page.favorited || !page.isRoute || !isNavbarRoute(page.href)) && (
        <span className={`pr-2 ${page.favorited ? "" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}>
          {page.isRoute ? (
            <FavoriteRouteButton
              href={page.href}
              label={page.title}
              favorited={page.favorited}
              onToggled={onChanged}
              compact
            />
          ) : (
            <FavoriteStar pageId={page.id} favorited={page.favorited} onToggled={onChanged} />
          )}
        </span>
      )}
    </div>
  );
}

function FavoritesPanel({
  pages,
}: {
  pages: { favorites: FavoritePage[]; recents: FavoritePage[] };
}) {
  const revalidator = useRevalidator();
  // Starring here re-sorts the panel: an un-starred page drops to Recent, and a
  // starred one rises out of it.
  const onChanged = () => revalidator.revalidate();
  const { favorites, recents } = pages;
  // Nothing starred and nothing opened yet — a brand-new account. Say what the
  // panel is for rather than showing an empty box.
  const empty = favorites.length === 0 && recents.length === 0;

  return (
    <div className="bg-card border border-border shadow-brand-1 rounded-lg p-4">
      <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground mb-2">
        <Star className="w-4 h-4 text-accent-coral" />
        Favorites
      </h2>

      {empty ? (
        <p className="px-2 py-1.5 text-sm text-muted-foreground italic">
          Star a document to keep it here — recently opened pages show up too.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {favorites.length > 0 && (
            <div className="flex flex-col gap-1">
              {favorites.map((p) => (
                <PageRow key={p.id} page={p} onChanged={onChanged} />
              ))}
            </div>
          )}

          {recents.length > 0 && (
            <div className="flex flex-col gap-1">
              {/* Only label the recents when pins sit above them; on its own the
                  heading is noise. */}
              {favorites.length > 0 && (
                <span className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Recent
                </span>
              )}
              {recents.map((p) => (
                <PageRow key={p.id} page={p} onChanged={onChanged} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MyTasksPanel({ tasks }: { tasks: MyProjectTask[] }) {
  if (tasks.length === 0) return null;
  return (
    <div className="bg-card border border-border shadow-brand-1 rounded-lg p-4">
      <h2 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground mb-2">
        <ListChecks className="w-4 h-4 text-accent-coral" />
        My tasks
      </h2>
      <div className="flex flex-col gap-1">
        {tasks.map((t) => {
          const url = `/projects/${t.projectId}?tab=board&task=${t.id}`;
          const overdue =
            t.dueAt != null && new Date(t.dueAt).getTime() < Date.now();
          return (
            <a
              key={t.id}
              href={url}
              onClick={(e) => openTaskLink(e, url, t.title)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-muted/50 transition-colors"
            >
              <span className="truncate text-foreground">{t.title}</span>
              <span className="flex items-center gap-1 truncate text-xs text-muted-foreground flex-shrink-0 max-w-[30%]">
                <ProjectIcon iconEmoji={t.projectIconEmoji} />
                <span className="truncate">{t.projectName}</span>
              </span>
              <span className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                {/* Low/Normal are the unremarkable default — only flag work
                    that's High or Urgent, in the board's priority tones. */}
                {(t.priority === "High" || t.priority === "Urgent") && (
                  <span
                    className={`text-[11px] ${
                      t.priority === "Urgent"
                        ? "text-accent-coral font-semibold"
                        : "text-accent-coral"
                    }`}
                  >
                    {t.priority}
                  </span>
                )}
                {t.dueAt && (
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded-md border ${
                      overdue
                        ? "border-accent-coral/40 text-accent-coral bg-accent-coral/10"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    Due {formatDuePill(t.dueAt)}
                  </span>
                )}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

// Short label for the due pill: "Mar 12" if it's this year, otherwise
// "Mar 12, 2027" — mirrors the TaskBoard card pill.
function formatDuePill(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/* ------------------------------------------------------------------ */
/* Attention banner — the single home surface for things needing the    */
/* user: open tasks plus notifications (incl. meeting-invite RSVP).      */
/* Only rendered when there's at least one of either.                    */
/* ------------------------------------------------------------------ */

function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function AttentionBanner({
  tasks,
  notifications,
}: {
  tasks: Task[];
  notifications: HomeNotification[];
}) {
  // Tasks are themselves notification rows (Task.id === Notification.id), so a
  // task (e.g. an announcement-todo) also appears in the raw notifications
  // list. Drop those duplicates — the task card is the richer rendering
  // (deadline + form link) — so each item shows once.
  const taskIds = new Set(tasks.map((t) => t.id));
  const extraNotifications = notifications.filter((n) => {
    if (taskIds.has(n.id)) return false;
    // A read notification still belongs on the banner only when it's a meeting
    // invite: we keep those so the RSVP/status badge stays reachable. Every
    // other read notification (e.g. an interview assignment already opened, so
    // it's no longer a task) is finished business — its Dismiss can't change
    // anything server-side, so the card would just sit here un-clearable. Drop
    // it so Dismiss actually removes it for good on revalidate.
    if (n.readAt && n.kind !== "MeetingInvite") return false;
    return true;
  });

  // Nothing to surface once duplicates and finished (read, non-invite)
  // notifications are filtered out — render nothing rather than an empty
  // banner with a bare header.
  if (tasks.length === 0 && extraNotifications.length === 0) return null;

  // "Needs attention" = open tasks + unread non-task notifications. Read
  // notifications still render below (so RSVP stays reachable) but don't
  // inflate the count.
  const unread = extraNotifications.filter((n) => !n.readAt).length;
  const count = tasks.length + unread;

  return (
    <div className="bg-accent-coral/10 border border-accent-coral/30 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <ListTodo className="w-4 h-4 text-accent-coral" />
        <span className="font-heading font-semibold text-sm text-foreground">
          {count > 0
            ? `${count} ${count === 1 ? "item needs" : "items need"} your attention`
            : "Your notifications"}
        </span>
      </div>

      {tasks.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </div>
      )}

      {extraNotifications.length > 0 && (
        <div
          className={`flex flex-col gap-2 ${tasks.length > 0 ? "mt-3 pt-3 border-t border-accent-coral/20" : ""}`}
        >
          {extraNotifications.map((n) => (
            <NotificationCard key={n.id} notification={n} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Task card (the top row of the attention banner)                      */
/*                                                                       */
/* Three shapes, by how the task clears:                                 */
/*   - meeting invite  → RSVP buttons (Accept/Maybe/Decline)             */
/*   - has an attached form (hasAction + link) → link to the form; the   */
/*     submit marks it read, so no Confirm                               */
/*   - everything else → its link (if any) plus a Confirm button that    */
/*     marks the notification read. A bare link doesn't self-clear, so   */
/*     Confirm is how the user says "handled".                           */
/* ------------------------------------------------------------------ */

function TaskCard({ task: t }: { task: Task }) {
  const revalidator = useRevalidator();
  const [confirming, setConfirming] = useState(false);
  const cls =
    "flex-shrink-0 w-56 bg-card border border-border shadow-brand-1 rounded-md px-3 py-2";

  const meta = t.dueAt ? (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-coral mt-1">
      <CalendarClock className="w-3 h-3" />
      {formatDeadline(t.dueAt)}
    </span>
  ) : (
    <span className="block text-[11px] text-muted-foreground mt-1">
      {t.source === "meeting" ? "Awaiting your response" : "Action needed"}
    </span>
  );

  const title = (
    <span className="block text-sm font-semibold text-foreground truncate">
      {t.title}
    </span>
  );

  // Meeting invites clear only on RSVP, never on a click — Accept/Maybe/Decline
  // inline. The RSVP revalidates, dropping the answered invite.
  if (t.source === "meeting") {
    return (
      <div className={cls}>
        {title}
        {meta}
        <RsvpButtons notificationId={t.id} />
      </div>
    );
  }

  // Form tasks self-clear on submit, so the whole tile is the form link and
  // there's no Confirm.
  if (t.hasAction && t.link) {
    return (
      <a
        href={t.link}
        onClick={(e) => openTaskLink(e, t.link!, t.title)}
        className={`${cls} hover:border-accent-coral/50 transition-colors`}
      >
        {title}
        {meta}
      </a>
    );
  }

  // Everything else: a Confirm button marks the task read. If it also carries
  // a link, expose it as a separate "Open" affordance so navigating and
  // confirming stay distinct actions.
  async function confirm() {
    setConfirming(true);
    try {
      await fetch(`/api/notifications/${t.id}/read`, {
        method: "POST",
        credentials: "include",
      });
      revalidator.revalidate();
      notifyTasksChanged();
    } catch {
      setConfirming(false);
    }
  }

  return (
    <div className={cls}>
      {title}
      {meta}
      <div className="flex items-center gap-1.5 mt-2">
        <button
          type="button"
          onClick={confirm}
          disabled={confirming}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-50"
        >
          <Check className="w-3 h-3" />
          {confirming ? "Confirming…" : "Confirm"}
        </button>
        {t.link && (
          <a
            href={t.link}
            onClick={(e) => openTaskLink(e, t.link!, t.title)}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-border text-foreground hover:bg-muted"
          >
            <ExternalLink className="w-3 h-3" />
            Open
          </a>
        )}
      </div>
    </div>
  );
}

// Open a task's link, handling the TabWorkspace iframe case: inside the embed,
// hand the URL to the parent shell so the user lands in a real tab instead of
// being stranded in the chrome-less iframe.
function openTaskLink(
  e: MouseEvent<HTMLAnchorElement>,
  link: string,
  label: string,
) {
  if (link.startsWith("/") && window.self !== window.top) {
    e.preventDefault();
    window.parent.postMessage(
      { type: "dali:openTab", url: link, label },
      window.location.origin,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Notification card (rendered inside the attention banner)             */
/* ------------------------------------------------------------------ */

function relativeTime(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}


function NotificationCard({ notification }: { notification: HomeNotification }) {
  const revalidator = useRevalidator();
  const isUnread = !notification.readAt;
  const isInvite = notification.kind === "MeetingInvite" && !!notification.scheduledMeetingId;
  const accent = isUnread ? "border-l-accent-coral" : "border-l-accent-teal";
  const [rsvp, setRsvp] = useState<HomeNotification["rsvp"]>(notification.rsvp);
  const [dismissing, setDismissing] = useState(false);

  // Invites clear by RSVP, never by dismiss (the /read endpoint exempts them),
  // so the Dismiss control is offered for every other notification. It marks
  // the row read and revalidates, dropping the card from the banner.
  async function dismiss() {
    setDismissing(true);
    try {
      await fetch(`/api/notifications/${notification.id}/read`, {
        method: "POST",
        credentials: "include",
      });
      revalidator.revalidate();
      notifyTasksChanged();
    } catch {
      setDismissing(false);
    }
  }

  return (
    <div
      className={`group bg-card border border-border shadow-brand-1 border-l-4 ${accent} rounded-md px-3 py-2.5 flex items-start gap-3`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-foreground truncate">{notification.title}</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {notification.link && (
              <a
                href={notification.link}
                onClick={(e) => {
                  if (!notification.readAt && !isInvite) {
                    // keepalive: true so the POST survives the navigation
                    // that the anchor's default action is about to start.
                    // Meeting invites clear only via RSVP — never via link.
                    fetch(`/api/notifications/${notification.id}/read`, {
                      method: "POST",
                      credentials: "include",
                      keepalive: true,
                    });
                  }
                  // If we're inside a TabWorkspace iframe, ask the parent to
                  // open the link as a new tab instead of letting it navigate
                  // the iframe (which strands the user in chrome-less embed
                  // mode with no way back).
                  const link = notification.link!;
                  if (link.startsWith("/") && window.self !== window.top) {
                    e.preventDefault();
                    window.parent.postMessage(
                      { type: "dali:openTab", url: link, label: notification.title },
                      window.location.origin,
                    );
                  }
                }}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Open linked page"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {!isInvite && (
              <button
                type="button"
                onClick={dismiss}
                disabled={dismissing}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-md border border-border text-foreground hover:bg-muted disabled:opacity-50"
                aria-label="Dismiss notification"
              >
                <Check className="w-3 h-3" />
                {dismissing ? "Dismissing…" : "Dismiss"}
              </button>
            )}
          </div>
        </div>
        {notification.body && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notification.body}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[10px] text-muted-foreground/70">
            {relativeTime(notification.createdAt)}
          </span>
          {rsvp && (
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                rsvp === "Accepted"
                  ? "bg-green-100 text-green-800"
                  : rsvp === "Declined"
                    ? "bg-red-100 text-red-800"
                    : "bg-yellow-100 text-yellow-800"
              }`}
            >
              {rsvp}
            </span>
          )}
        </div>
        {isInvite && !rsvp && (
          <RsvpButtons
            notificationId={notification.id}
            onResponded={setRsvp}
          />
        )}
      </div>
    </div>
  );
}

