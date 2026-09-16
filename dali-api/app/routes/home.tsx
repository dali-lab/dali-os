import { useEffect, useRef, useState } from "react";
import { redirect, useLoaderData, useRevalidator } from "react-router";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { listFavoritesAndRecents, type FavoritePage } from "~/lib/user-pages.server";
import { loadShellUser } from "~/lib/shell-user.server";
import { timed } from "~/lib/server-timing";
import { FavoriteIcon } from "~/components/FavoriteIcon";
import { FavoriteStar } from "~/components/FavoriteStar";
import { FavoriteRouteButton } from "~/components/FavoriteRouteButton";
import MilestoneHero from "~/components/home/MilestoneHero";
import SearchIcon from "~/components/home/landing/SearchIcon";
import { isNavbarRoute } from "~/lib/navbar-routes";
import { currentTermStrict, getUserRoles } from "~/lib/roles";
import { resolveHomeSurface } from "~/lib/feature-flags.server";
import { TYPE_META } from "~/components/CommandPalette";
import { MIN_QUERY_LENGTH, type SearchResult } from "~/lib/search";
import { Avatar } from "~/components/ui/Avatar";
import {
  getZonedHourFraction,
  getZonedYMD,
  resolveUserTimeZone,
} from "~/lib/timezone";
import type { Route } from "./+types/home";

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
  const roles = await getUserRoles(auth.user.sub, request);
  const surface = await resolveHomeSurface(auth.user.sub, roles, request);
  if (surface === "calendar") return redirect("/calendar");

  const me = await loadShellUser(auth.user.sub, request);
  const tz = resolveUserTimeZone(me);

  // The attention stack (open tasks, unanswered invites) lives in the shell's
  // bell panel, not here — home is the front door, not an inbox. It polls
  // /api/notifications for itself, so this loader owns only the greeting and
  // the page cards.
  const [pages, week] = await Promise.all([
    timed(request, 'home.favorites', () =>
      // `request` reuses the read the shell's sidebar already kicked off for the
      // same navigation instead of re-running the per-row access checks.
      listFavoritesAndRecents(auth.user.sub, request),
    ),
    loadCurrentWeek(tz, request),
  ]);

  const __loaderTotal = performance.now() - __loaderStart;
  if (__loaderTotal >= 400) console.log(`[perf-total] home loader ${__loaderTotal.toFixed(0)}ms`);

  // Time-of-day greeting, resolved server-side in the viewer's own zone: the
  // browser's clock would disagree with every other time on the page (all of
  // which are formatted in `tz`) and would differ between render and hydration.
  const greetingHour = getZonedHourFraction(new Date(), tz);
  const greeting =
    greetingHour < 12 ? "Good morning" : greetingHour < 18 ? "Good afternoon" : "Good evening";

  return {
    greeting,
    week,
    user: auth.user,
    pages: {
      favorites: pages.favorites.slice(0, HOME_PAGE_LIMIT),
      recents: pages.recents.slice(0, HOME_PAGE_LIMIT),
    },
  };
}

/* The term week "now" falls in, for the hero's badge: week 0 starts on the
   current term's start date (days counted in the viewer's zone) and each week
   is labelled with its first five days, e.g. "Week 0 Sep 15 – 19". Null
   between terms, where the badge is dropped. */
async function loadCurrentWeek(tz: string, request: Request) {
  const term = await currentTermStrict(request);
  if (!term) return null;
  const start = Date.UTC(
    term.startDate.getUTCFullYear(),
    term.startDate.getUTCMonth(),
    term.startDate.getUTCDate(),
  );
  const today = getZonedYMD(new Date(), tz);
  const days = (Date.UTC(today.year, today.month - 1, today.day) - start) / DAY_MS;
  const index = Math.floor(days / 7);
  const first = new Date(start + index * 7 * DAY_MS);
  const last = new Date(first.getTime() + 4 * DAY_MS);
  const month = (d: Date) => d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const dates =
    month(first) === month(last)
      ? `${month(first)} ${first.getUTCDate()} – ${last.getUTCDate()}`
      : `${month(first)} ${first.getUTCDate()} – ${month(last)} ${last.getUTCDate()}`;
  return { index, dates };
}

const DAY_MS = 86_400_000;

/* How many starred and how many recently-opened pages home shows. The lists
   themselves are longer (the sidebar shows more) — home is a landing page, not
   an index, and an unbounded pin list pushed everything else off the screen. */
const HOME_PAGE_LIMIT = 6;

// The hero fills the shell's main column edge to edge: the column hands it a
// height (fitViewport) and drops its gutter (bleedPane).
export const handle = { fitViewport: true, bleedPane: true };

export default function Home() {
  const { user, greeting, week, pages } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const onChanged = () => revalidator.revalidate();
  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email.split("@")[0];
  const shortcuts = [...pages.favorites, ...pages.recents].slice(0, HOME_PAGE_LIMIT);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <MilestoneHero
        weekBadge={week ? `Week ${week.index} ${week.dates}` : undefined}
        milestoneTitle="Lab Kickoff"
        greeting={greeting}
        userName={fullName}
        search={<HomeSearch />}
        recentsHeading="Favorites + Recently Visited"
        // A brand-new account (nothing starred, nothing opened) gets no card
        // row at all — the search field is the only thing to do.
        recents={shortcuts.map((page) => ({
          id: page.id,
          title: page.title || "Untitled",
          href: page.href,
          media: <RecentCardMedia page={page} />,
          // Recents show a hollow star on hover — a way to keep the page
          // without hunting for it — while a favorite always shows its filled one.
          action:
            page.favorited || !page.isRoute || !isNavbarRoute(page.href) ? (
              page.isRoute ? (
                <FavoriteRouteButton
                  href={page.href}
                  label={page.title}
                  favorited={page.favorited}
                  onToggled={onChanged}
                  compact
                />
              ) : (
                <FavoriteStar pageId={page.id} favorited={page.favorited} onToggled={onChanged} />
              )
            ) : undefined,
          actionPinned: page.favorited,
        }))}
      />
    </div>
  );
}

function RecentCardMedia({ page }: { page: FavoritePage }) {
  return (
    <span className="relative z-[2] flex size-full flex-col items-center justify-center gap-2 p-3 text-center">
      <FavoriteIcon page={page} size="lg" glyphClassName="text-white/80" />
      <span className="w-full truncate text-sm text-white">{page.title || "Untitled"}</span>
    </span>
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
    <div ref={boxRef} className="landing-search-box">
      <div className="landing-search landing-glass">
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
          className="landing-search-input"
        />
        <SearchIcon className="landing-search-icon" />
      </div>

      {/* Always mounted so opening and closing can fade; `inert` keeps the
          hidden list out of the tab order and away from clicks. Absolute so a
          long result list never pushes the shortcut tiles down. */}
      <div
        id="home-search-results"
        role="listbox"
        data-open={show || undefined}
        inert={!show}
        className="landing-search-results"
      >
        {results.length === 0 ? (
          <p className="landing-search-empty">No matches for “{query.trim()}”</p>
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
                className="landing-search-result"
              >
                {r.type === "person" ? (
                  <Avatar photoUrl={r.photoUrl} name={r.title} size="xs" />
                ) : r.iconEmoji ? (
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center leading-none">
                    {r.iconEmoji}
                  </span>
                ) : (
                  <Icon className="h-4 w-4 flex-shrink-0 text-white/60" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-white">{r.title}</span>
                {r.subtitle && (
                  <span className="max-w-[40%] flex-shrink-0 truncate text-xs text-white/55">
                    {r.subtitle}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
