import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { itemIcon } from "~/components/drive/DriveBrowser";
import { LocationLink } from "~/components/drive/LocationLink";
import { locateItem, type LocatableScope } from "~/components/drive/location";
import { HOME_SECTION_TITLES, homeSections, type HomeSectionKey } from "~/components/drive/home-sections";
import { relativeTime } from "~/lib/relative-time";
import type { DriveItem } from "~/lib/drive.server";
import type { DriveHomeData } from "~/lib/drive-home.server";

const ROW =
  "group relative flex min-h-10 items-center gap-3 rounded-os-item px-2 py-1.5 transition-colors hover:bg-os-container focus-within:ring-2 focus-within:ring-inset focus-within:ring-accent-coral";
const TITLE =
  "min-w-0 flex-1 truncate text-sm font-medium text-foreground after:absolute after:inset-0 focus-visible:outline-none";
const REASON = "min-w-0 max-w-[45%] truncate text-xs text-muted-foreground md:shrink-0";

export function homeItemHref(item: DriveItem): string {
  return item.type === "folder" ? `/drive/reveal/${item.id}` : item.href;
}

function isPlainClick(e: ReactMouseEvent) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

type RowActions = {
  scopes: LocatableScope[];
  onOpen: (item: DriveItem) => void;
  onNavigate: (scopeId: string, folderId: string | null) => void;
};

const since = (at: Date) => relativeTime(new Date(at).toISOString());
const opened = (visitedAt: Date | null) => (visitedAt ? `Opened ${since(visitedAt)}` : null);

function HomeRow({
  item,
  title = item.title,
  reason,
  showLocation,
  scopes,
  onOpen,
  onNavigate,
}: RowActions & {
  item: DriveItem;
  title?: string;
  reason: string | null;
  showLocation?: boolean;
}) {
  return (
    <li className={ROW} data-testid={`drive-home-row-${item.id}`}>
      <span className="flex w-5 shrink-0 items-center justify-center">{itemIcon(item)}</span>
      <a
        href={homeItemHref(item)}
        className={TITLE}
        onClick={(e) => {
          if (!isPlainClick(e)) return;
          e.preventDefault();
          onOpen(item);
        }}
      >
        {title || "Untitled"}
      </a>
      {reason && (
        <span className={REASON} suppressHydrationWarning>
          {reason}
        </span>
      )}
      {showLocation && (
        <div className="relative z-10 hidden w-1/3 min-w-0 md:block">
          <LocationLink location={locateItem(scopes, item)} onNavigate={onNavigate} />
        </div>
      )}
    </li>
  );
}

export function DriveHome({ data, ...actions }: RowActions & { data: DriveHomeData }) {
  const sections = homeSections(data);
  if (sections.length === 0) return null;

  const rows: Record<HomeSectionKey, () => ReactNode> = {
    upcoming: () =>
      data.upcoming.map(({ meetingId, meetingTitle, nextAt, item }) => (
        <HomeRow
          key={meetingId}
          item={item}
          title={meetingTitle}
          reason={`${since(nextAt)} · ${item.title || "Untitled"}`}
          {...actions}
        />
      )),
    recent: () =>
      data.recent.map((item) => <HomeRow key={item.id} item={item} reason={opened(item.visitedAt)} showLocation {...actions} />),
  };

  return (
    <div className="flex flex-col gap-5" data-testid="drive-home">
      {sections.map((key) => (
        <section key={key} aria-labelledby={`drive-home-${key}`} data-testid={`drive-home-${key}`}>
          <h2 id={`drive-home-${key}`} className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {HOME_SECTION_TITLES[key]}
          </h2>
          <ul className="flex list-none flex-col">{rows[key]()}</ul>
        </section>
      ))}
    </div>
  );
}
