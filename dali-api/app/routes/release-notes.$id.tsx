import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import type { Route } from "./+types/release-notes.$id";
import {
  getVisibleReleaseNote,
  releaseNoteVideoUrl,
  requireReleaseNoteViewer,
} from "~/lib/release-notes.server";
import { releaseNoteAreaLabel } from "~/lib/release-notes";
import { formatDateShort } from "~/lib/display";
import { DocEditor } from "~/components/doc";
import { ReleaseNoteVideo } from "~/components/release-notes/ReleaseNoteVideo";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.note.title ?? "Release note"} · DALI OS` },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireReleaseNoteViewer(request);
  const note = await getVisibleReleaseNote(viewer, params.id);
  if (!note) throw new Response("Not found", { status: 404 });
  return {
    note: {
      id: note.id,
      title: note.title,
      summary: note.summary,
      area: note.area,
      publishedAt: note.publishedAt!.toISOString(),
      contentJson: note.contentJson as unknown,
    },
    videoUrl: await releaseNoteVideoUrl(note.videoKey).catch(() => null),
  };
}

export default function ReleaseNotePage({ loaderData }: Route.ComponentProps) {
  const { note, videoUrl } = loaderData;
  return (
    <article className="max-w-3xl pt-4">
      <Link
        to="/release-notes"
        className="inline-flex items-center gap-1.5 py-4 text-sm text-os-grey hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Release notes
      </Link>
      <div className="border-b border-border pb-4">
        <h1 className="font-heading text-4xl font-semibold leading-tight text-foreground">
          {note.title}
        </h1>
        <p className="mt-3 text-lg text-os-grey">{note.summary}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          {[releaseNoteAreaLabel(note.area), formatDateShort(note.publishedAt)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      {videoUrl && (
        <div className="mt-6">
          <ReleaseNoteVideo src={videoUrl} title={note.title} />
        </div>
      )}
      <DocEditor
        key={note.id}
        features="resource"
        editable={false}
        className="mt-6 [&_.bn-editor]:!px-0"
        initialContent={note.contentJson ?? []}
      />
    </article>
  );
}
