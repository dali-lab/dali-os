import { useEffect, useRef, useState, type MouseEvent } from "react";
import { redirect, useLoaderData, useRevalidator } from "react-router";
import {
  ListTodo,
  Check,
  ExternalLink,
  Search,
  CalendarClock,
  X,
} from "lucide-react";
import { useDialog } from "~/components/ui/dialog";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { listOpenTasks, type Task } from "~/lib/tasks";
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
import { RsvpButtons, notifyTasksChanged } from "~/components/RsvpButtons";
import { cn } from "~/lib/cn";
import type { Route } from "./+types/home";

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
  const roles = await getUserRoles(auth.user.sub, request);
  const surface = await resolveHomeSurface(auth.user.sub, roles, request);
  if (surface === "calendar") return redirect("/calendar");

  const me = await loadShellUser(auth.user.sub, request);
  const tz = resolveUserTimeZone(me);

  const [items, tasks, pages] = await Promise.all([
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
    timed(request, 'home.openTasks', () => listOpenTasks(auth.user.sub, request)),
    // `request` reuses the read the shell's sidebar already kicked off for the
    // same navigation instead of re-running the per-row access checks.
    timed(request, 'home.favorites', () => listFavoritesAndRecents(auth.user.sub, request)),
  ]);

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
    notifications,
    tasks,
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
  const { user, greeting, notifications, tasks, pages } = useLoaderData<typeof loader>();
  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email.split("@")[0];
  // Greeting + search (and any shortcuts) should sit in the middle of the pane
  // when there's nothing in the attention stack — otherwise the front door
  // reads as stuck under the top gutter.
  const quiet = !hasAttentionContent(tasks, notifications);

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[750px] flex-col gap-12",
        quiet
          ? // Fill the column the shell sized to the window (see the route's
            // `fitViewport` handle) rather than claiming a viewport height of
            // its own — that stacked under the top bar and the shell's bottom
            // gutter, so the front door always scrolled by ~100px.
            "flex-1 justify-center py-12"
          : "pt-6",
      )}
    >
      <div className="flex flex-col items-center gap-8">
        <h1 className="text-center text-3xl font-medium text-foreground">
          {greeting}, {fullName}.
        </h1>
        <HomeSearch />
      </div>

      <RecentGrid pages={pages} />

      <AttentionBanner tasks={tasks} notifications={notifications} />
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

function hasAttentionContent(
  tasks: Task[],
  notifications: HomeNotification[],
): boolean {
  // Same visibility rules as AttentionBanner: open tasks, plus notifications
  // that aren't a duplicate of a task or a finished (read, non-invite) item.
  if (tasks.length > 0) return true;
  const taskIds = new Set(tasks.map((t) => t.id));
  return notifications.some((n) => {
    if (taskIds.has(n.id)) return false;
    if (n.readAt && n.kind !== "MeetingInvite") return false;
    return true;
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
  if (!hasAttentionContent(tasks, notifications)) return null;

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
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
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
  const { confirm: confirmDialog } = useDialog();
  const [confirming, setConfirming] = useState(false);
  const [dismissing, setDismissing] = useState(false);
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

  // A form todo self-clears on submit, so the tile links to the form. But a
  // recipient who won't (or can't) fill it would otherwise be stuck with it
  // forever — the /read endpoint refuses a plain read — so offer a confirmed
  // Dismiss that clears the reminder without submitting (intent=dismiss).
  async function dismissForm() {
    const ok = await confirmDialog({
      title: "Dismiss this reminder?",
      description:
        "You haven't submitted this form. Dismissing removes it from your tasks — you can still find it in History.",
      confirmLabel: "Dismiss",
    });
    if (!ok) return;
    setDismissing(true);
    try {
      await fetch(`/api/notifications/${t.id}/read`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: "dismiss" }),
      });
      revalidator.revalidate();
      notifyTasksChanged();
    } catch {
      setDismissing(false);
    }
  }

  if (t.formTodo) {
    return (
      <div className={cls}>
        <a
          href={t.link!}
          onClick={(e) => openTaskLink(e, t.link!, t.title)}
          className="block hover:opacity-80 transition-opacity"
        >
          {title}
          {meta}
        </a>
        <button
          type="button"
          onClick={dismissForm}
          disabled={dismissing}
          className="inline-flex items-center gap-1 mt-2 px-2 py-1 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
        >
          <X className="w-3 h-3" />
          {dismissing ? "Dismissing…" : "Dismiss"}
        </button>
      </div>
    );
  }

  // Other self-clearing tasks that merely link (onboarding, an apply-to-cycle
  // task): the whole tile is the link and there's no Confirm.
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

