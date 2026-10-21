import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/release-notes._index";
import {
  listVisibleReleaseNotes,
  markReleaseNotesSeen,
  releaseNoteVideoUrl,
  requireReleaseNoteViewer,
} from "~/lib/release-notes.server";
import { RELEASE_NOTE_AREAS, releaseNoteAreaLabel } from "~/lib/release-notes";
import { formatDateShort } from "~/lib/display";
import { useOsChrome } from "~/components/os-chrome";
import { Select } from "~/components/ui/floating";
import { ReleaseNoteVideo } from "~/components/release-notes/ReleaseNoteVideo";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = () => [{ title: "Release notes · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireReleaseNoteViewer(request);
  const area = new URL(request.url).searchParams.get("area");
  const [notes] = await Promise.all([
    listVisibleReleaseNotes(viewer, { area }),
    markReleaseNotesSeen(viewer.userId),
  ]);
  return {
    notes: await Promise.all(
      notes.map(async (n) => ({
        id: n.id,
        title: n.title,
        summary: n.summary,
        area: n.area,
        highlight: n.highlight,
        publishedAt: n.publishedAt!.toISOString(),
        hasBody: Array.isArray(n.contentJson) && n.contentJson.length > 0,
        videoUrl: await releaseNoteVideoUrl(n.videoKey).catch(() => null),
      })),
    ),
  };
}

export default function ReleaseNotesPage({ loaderData }: Route.ComponentProps) {
  const { notes } = loaderData;
  const { pageTitle, card, cardPad } = useOsChrome();
  const [params, setParams] = useSearchParams();
  const area = params.get("area") ?? "";

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className={pageTitle}>Release notes</h1>
        <Select
          value={area}
          ariaLabel="Filter by area"
          onChange={(next) => setParams(next ? { area: next } : {}, { replace: true })}
          options={[
            { value: "", label: "All areas" },
            ...RELEASE_NOTE_AREAS.map((a) => ({ value: a.key, label: a.label })),
          ]}
        />
      </header>
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {area ? "Nothing in this area yet." : "Nothing here yet."}
        </p>
      ) : (
        notes.map((n) => (
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
        ))
      )}
    </div>
  );
}
