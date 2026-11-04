import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/release-notes._index";
import {
  loadRecapWeeksPage,
  loadReleaseNotesPage,
  markReleaseNotesSeen,
  requireReleaseNoteViewer,
} from "~/lib/release-notes.server";
import { RELEASE_NOTE_AREAS, releaseNoteAreaLabel } from "~/lib/release-notes";
import type { RecapWeek } from "~/lib/release-notes-recap";
import { LoadMore } from "~/components/ui/Pager";
import { fetchCursorPage, useLoadMore } from "~/hooks/useLoadMore";
import { Segmented } from "~/components/ui/Segmented";
import { formatDateShort } from "~/lib/display";
import { useOsChrome } from "~/components/os-chrome";
import { Select } from "~/components/ui/floating";
import { ReleaseNoteVideo } from "~/components/release-notes/ReleaseNoteVideo";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = () => [{ title: "Release notes · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireReleaseNoteViewer(request);
  const url = new URL(request.url);
  if (url.searchParams.get("view") === "recaps") {
    const [page] = await Promise.all([loadRecapWeeksPage(viewer), markReleaseNotesSeen(viewer.userId)]);
    return { view: "recaps" as const, recaps: page.items, nextCursor: page.nextCursor };
  }
  const area = url.searchParams.get("area");
  const [page] = await Promise.all([loadReleaseNotesPage(viewer, { area }), markReleaseNotesSeen(viewer.userId)]);
  return { view: "all" as const, notes: page.items, nextCursor: page.nextCursor };
}

export default function ReleaseNotesPage({ loaderData }: Route.ComponentProps) {
  const { pageTitle } = useOsChrome();
  const [params, setParams] = useSearchParams();

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className={pageTitle}>Release notes</h1>
        <div className="flex items-center gap-3">
          <Segmented
            ariaLabel="View"
            value={loaderData.view}
            onChange={(next) => setParams(next === "recaps" ? { view: "recaps" } : {}, { replace: true })}
            options={[
              { value: "all", label: "All" },
              { value: "recaps", label: "Weekly recaps" },
            ]}
          />
          {loaderData.view === "all" && (
            <Select
              value={params.get("area") ?? ""}
              ariaLabel="Filter by area"
              onChange={(next) => setParams(next ? { area: next } : {}, { replace: true })}
              options={[
                { value: "", label: "All areas" },
                ...RELEASE_NOTE_AREAS.map((a) => ({ value: a.key, label: a.label })),
              ]}
            />
          )}
        </div>
      </header>
      {loaderData.view === "recaps" ? (
        <Recaps recaps={loaderData.recaps} nextCursor={loaderData.nextCursor} />
      ) : (
        <AllNotes notes={loaderData.notes} nextCursor={loaderData.nextCursor} area={params.get("area") ?? ""} />
      )}
    </div>
  );
}

function Recaps({ recaps: firstWeeks, nextCursor }: { recaps: RecapWeek[]; nextCursor: string | null }) {
  const { card, cardPad } = useOsChrome();
  const { items: recaps, pager } = useLoadMore<RecapWeek>({
    items: firstWeeks,
    nextCursor,
    fetchPage: (cursor) =>
      fetchCursorPage<RecapWeek>(`/api/release-notes?view=recaps&cursor=${encodeURIComponent(cursor)}`),
    idOf: (w) => w.week,
  });
  if (recaps.length === 0) {
    return <p className="text-sm text-muted-foreground">No weekly recaps yet.</p>;
  }
  return (
    <>
      {recaps.map(({ week, recap }) => (
        <section key={week} className={cn(card, cardPad, "flex flex-col gap-4")}>
          <h2 className="text-sm font-semibold text-foreground">{week}</h2>
          {recap.highlights.map((n) => (
            <div key={n.id} className="flex flex-col gap-1">
              <Link
                to={`/release-notes/${n.id}`}
                className="text-base font-semibold text-foreground hover:underline"
              >
                {n.title}
              </Link>
              <p className="text-sm text-foreground">{n.summary}</p>
            </div>
          ))}
          {recap.byArea.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold text-muted-foreground">{group.label}</h3>
              <ul className="flex flex-col gap-1">
                {group.notes.map((n) => (
                  <li key={n.id}>
                    <Link
                      to={`/release-notes/${n.id}`}
                      className="text-sm text-foreground hover:underline"
                    >
                      {n.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      <LoadMore {...pager} />
    </>
  );
}

type NoteItem = Extract<Route.ComponentProps["loaderData"], { view: "all" }>["notes"][number];

function AllNotes({
  notes: firstNotes,
  nextCursor,
  area,
}: {
  notes: NoteItem[];
  nextCursor: string | null;
  area: string;
}) {
  const { card, cardPad } = useOsChrome();
  const { items: notes, pager } = useLoadMore<NoteItem>({
    items: firstNotes,
    nextCursor,
    fetchPage: (cursor) =>
      fetchCursorPage<NoteItem>(
        `/api/release-notes?cursor=${encodeURIComponent(cursor)}${area ? `&area=${encodeURIComponent(area)}` : ""}`,
      ),
    idOf: (n) => n.id,
    resetKey: area,
  });
  if (notes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {area ? "Nothing in this area yet." : "Nothing here yet."}
      </p>
    );
  }
  return (
    <>
      {notes.map((n) => (
        <article key={n.id} className={cn(card, cardPad, "flex flex-col gap-3")}>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            {[releaseNoteAreaLabel(n.area), formatDateShort(n.publishedAt)]
              .filter(Boolean)
              .join(" · ")}
            {n.highlight && <span className="font-semibold text-os-accent">Highlight</span>}
          </p>
          <h2 className="text-lg font-semibold text-foreground">
            <Link to={`/release-notes/${n.id}`} className="hover:underline">
              {n.title}
            </Link>
          </h2>
          <p className="text-sm text-foreground">{n.summary}</p>
          {n.videoUrl && <ReleaseNoteVideo src={n.videoUrl} title={n.title} />}
          {n.hasBody && (
            <Link
              to={`/release-notes/${n.id}`}
              className="text-sm font-medium text-os-accent hover:underline"
            >
              Read more
            </Link>
          )}
        </article>
      ))}
      <LoadMore {...pager} />
    </>
  );
}
