import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { Star } from "lucide-react";
import { itemIcon } from "~/components/drive/DriveBrowser";
import { LocationLink } from "~/components/drive/LocationLink";
import { locateItem, type LocatableScope } from "~/components/drive/location";
import { HOME_SECTION_TITLES, homeSections, type HomeSectionKey } from "~/components/drive/home-sections";
import { relativeTime } from "~/lib/relative-time";
import type { DriveItem } from "~/lib/drive.server";
import type { DriveHomeData } from "~/lib/drive-home.server";

const CARD =
  "group relative flex w-56 shrink-0 flex-col gap-2 rounded-os-card border border-border bg-os-card p-3 transition-colors hover:bg-os-card-hover focus-within:ring-2 focus-within:ring-inset focus-within:ring-accent-coral";
const TITLE = "truncate text-sm font-medium text-foreground after:absolute after:inset-0 focus-visible:outline-none";
const META = "truncate text-xs text-muted-foreground";

export function homeItemHref(item: DriveItem): string {
  return item.type === "folder" ? `/drive/reveal/${item.id}` : item.href;
}

function isPlainClick(e: ReactMouseEvent) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

type CardActions = {
  scopes: LocatableScope[];
  onOpen: (item: DriveItem) => void;
  onNavigate: (scopeId: string, folderId: string | null) => void;
};

const since = (at: Date) => relativeTime(new Date(at).toISOString());
const opened = (visitedAt: Date | null) => (visitedAt ? `Opened ${since(visitedAt)}` : null);

function HomeCard({
  item,
  meta,
  starred,
  showLocation,
  scopes,
  onOpen,
  onNavigate,
}: CardActions & {
  item: DriveItem;
  meta: string | null;
  starred?: boolean;
  showLocation?: boolean;
}) {
  return (
    <li className={CARD} data-testid={`drive-home-card-${item.id}`}>
      {starred && (
        <Star aria-hidden="true" className="absolute right-3 top-3 h-4 w-4 fill-accent-coral text-accent-coral" />
      )}
      {itemIcon(item, "lg")}
      <div className="flex min-w-0 flex-col gap-0.5">
        <a
          href={homeItemHref(item)}
          className={TITLE}
          onClick={(e) => {
            if (!isPlainClick(e)) return;
            e.preventDefault();
            onOpen(item);
          }}
        >
          {item.title || "Untitled"}
        </a>
        {meta && (
          <span className={META} suppressHydrationWarning>
            {meta}
          </span>
        )}
        {showLocation && (
          <div className="relative z-10 min-w-0">
            <LocationLink location={locateItem(scopes, item)} onNavigate={onNavigate} />
          </div>
        )}
      </div>
    </li>
  );
}

export function DriveHome({ data, ...actions }: CardActions & { data: DriveHomeData }) {
  const sections = homeSections(data);
  if (sections.length === 0) return null;

  const cards: Record<HomeSectionKey, () => ReactNode> = {
    upcoming: () =>
      data.upcoming.map(({ item, nextAt, meetingTitle }) => (
        <HomeCard
          key={item.id}
          item={item}
          meta={`Next ${since(nextAt)} · ${meetingTitle}`}
          {...actions}
        />
      )),
    recent: () =>
      data.recent.map((item) => (
        <HomeCard key={item.id} item={item} meta={opened(item.visitedAt)} showLocation {...actions} />
      )),
    starred: () =>
      data.starred.map((item) => (
        <HomeCard key={item.id} item={item} meta={opened(item.visitedAt)} starred showLocation {...actions} />
      )),
  };

  return (
    <div className="flex flex-col gap-5" data-testid="drive-home">
      {sections.map((key) => (
        <section key={key} aria-labelledby={`drive-home-${key}`} data-testid={`drive-home-${key}`}>
          <h2 id={`drive-home-${key}`} className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {HOME_SECTION_TITLES[key]}
          </h2>
          <ul className="-mx-1 flex list-none gap-3 overflow-x-auto px-1 pb-1">{cards[key]()}</ul>
        </section>
      ))}
    </div>
  );
}
