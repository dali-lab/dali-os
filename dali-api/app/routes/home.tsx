import { useEffect, useRef, useState } from "react";
import { redirect, useLoaderData, useRevalidator } from "react-router";
import { Search } from "lucide-react";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { listFavoritesAndRecents, type FavoritePage } from "~/lib/user-pages.server";
import { loadShellUser } from "~/lib/shell-user.server";
import { timed } from "~/lib/server-timing";
import { FavoriteIcon } from "~/components/FavoriteIcon";
import { FavoriteStar } from "~/components/FavoriteStar";
import { FavoriteRouteButton } from "~/components/FavoriteRouteButton";
import { isNavbarRoute } from "~/lib/navbar-routes";
import { getUserRoles } from "~/lib/roles";
import { resolveHomeSurface } from "~/lib/feature-flags.server";
import { TYPE_META } from "~/components/CommandPalette";
import { MIN_QUERY_LENGTH, type SearchResult } from "~/lib/search";
import { Avatar } from "~/components/ui/Avatar";
import {
  getZonedHourFraction,
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
  const pages = await timed(request, 'home.favorites', () =>
    // `request` reuses the read the shell's sidebar already kicked off for the
    // same navigation instead of re-running the per-row access checks.
    listFavoritesAndRecents(auth.user.sub, request),
  );

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
    user: auth.user,
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

// Home's quiet state centres itself in the shell's main column, which only
// works if that column hands the page a height instead of sizing to it.
export const handle = { fitViewport: true };

export default function Home() {
  return <HomeOS />;
}

/* ------------------------------------------------------------------ */
/* Home. The design's front door: a time-of-day greeting, one wide       */
/* search field, and the pages you were last in as cards. The only other */
/* surface is the attention banner for tasks and invites still waiting   */
/* on an answer.                                                         */
/* ------------------------------------------------------------------ */

function HomeOS() {
  const { user, greeting, pages } = useLoaderData<typeof loader>();
  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email.split("@")[0];

  return (
    <div
      // Fill the column the shell sized to the window (see the route's
      // `fitViewport` handle) rather than claiming a viewport height of its own
      // — that stacked under the top bar and the shell's bottom gutter, so the
      // front door always scrolled by ~100px.
      className="mx-auto flex w-full max-w-[750px] flex-1 flex-col justify-center gap-12 py-12"
    >
      <div className="flex flex-col items-center gap-8">
        <h1 className="text-center text-3xl font-medium text-foreground">
          {greeting}, {fullName}.
        </h1>
        <HomeSearch />
      </div>

      <RecentGrid pages={pages} />
    </div>
  );
}

function RecentGrid({
  pages,
}: {
  pages: { favorites: FavoritePage[]; recents: FavoritePage[] };
}) {
  const revalidator = useRevalidator();
  const onChanged = () => revalidator.revalidate();
  const shortcuts = [...pages.favorites, ...pages.recents].slice(0, HOME_PAGE_LIMIT);

  // A brand-new account: nothing starred, nothing opened. The search field
  // above is the only thing to do here, and a caption over an empty row of
  // cards just crowds it.
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
    <div className="flex flex-col gap-4">
      <p className="text-center text-sm tracking-wider text-foreground uppercase">{caption}</p>
      {/* A single row that scrolls sideways rather than wrapping: two stacked
          rows of shortcuts read as clutter, so cap it at one. The inner row is
          w-max mx-auto so a short list stays centered, while a long one simply
          overflows and scrolls from the start (justify-center would clip the
          leading cards out of reach once the row overflows). no-scrollbar hides
          the always-on bar (the row still scrolls by wheel/trackpad/drag). */}
      <div className="overflow-x-auto no-scrollbar">
        <div className="mx-auto flex w-max gap-3">
          {shortcuts.map((p) => (
            <RecentCard key={p.id} page={p} onChanged={onChanged} />
          ))}
        </div>
      </div>
    </div>
  );
}

function RecentCard({ page, onChanged }: { page: FavoritePage; onChanged: () => void }) {
  return (
    // Link + star are siblings: the star must not navigate.
    // Fixed width + no shrink: in a single scrolling row the cards must hold
    // their size rather than divide the container, so the row scrolls instead
    // of squeezing every card thinner as more are added.
    <div className="group relative w-32 flex-shrink-0">
      <a
        href={page.href}
        className="flex h-full flex-col items-center gap-2 rounded-os-card bg-os-card p-3 text-center transition-colors hover:bg-os-card-hover"
      >
        <span className="flex items-center justify-center">
          <FavoriteIcon page={page} size="lg" />
        </span>
        <span className="w-full truncate text-sm text-foreground">{page.title || "Untitled"}</span>
      </a>
      {/* Recents show a hollow star on hover — a way to keep the page without
          hunting for it — while a favorite always shows its filled one. */}
      {(page.favorited || !page.isRoute || !isNavbarRoute(page.href)) && (
        <span
          className={`absolute right-2 top-2 ${
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
