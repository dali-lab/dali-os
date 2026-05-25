import { Link, redirect, useLoaderData } from "react-router";
import { Download } from "lucide-react";
import type { Route } from "./+types/documents.file.$fileId";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { getDownloadUrl } from "~/lib/s3";
import { hydrateAuthors } from "~/lib/collabAuth";
import { formatBytes } from "~/lib/upload-client";
import { CommentsRail } from "~/components/collab/CommentsRail";
import { TagPicker } from "~/components/TagPicker";

export const meta: Route.MetaFunction = ({ data }) => {
  const t = (data as { title?: string } | undefined)?.title;
  return [{ title: t ? `${t} · DALI OS` : "File · DALI OS" }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  const file = await prisma.projectFile.findUnique({
    where: { id: params.fileId },
    select: {
      id: true,
      title: true,
      projectId: true,
      currentVersionId: true,
      archivedAt: true,
      project: { select: { id: true, name: true } },
      tags: { select: { tag: { select: { id: true, label: true, slug: true, color: true } } } },
      versions: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          fileName: true,
          sizeBytes: true,
          uploadedById: true,
          createdAt: true,
          s3Key: true,
        },
      },
    },
  });
  if (!file || file.archivedAt !== null) {
    throw new Response("Not found", { status: 404 });
  }

  const canEdit = await isCore(auth.user.sub);

  const uploaderNames = await hydrateAuthors(file.versions.map((v) => v.uploadedById));
  const nameById = new Map(uploaderNames.map((u) => [u.id, u.name]));

  const versions = await Promise.all(
    file.versions.map(async (v) => ({
      id: v.id,
      fileName: v.fileName,
      sizeBytes: v.sizeBytes,
      uploadedBy: nameById.get(v.uploadedById) ?? "Unknown",
      createdAt: v.createdAt.toISOString(),
      isCurrent: v.id === file.currentVersionId,
      downloadUrl: await getDownloadUrl(v.s3Key),
    })),
  );

  const allTags = await prisma.docTag.findMany({
    where: { archivedAt: null },
    orderBy: { label: "asc" },
    select: { id: true, label: true, slug: true, color: true },
  });

  return {
    fileId: file.id,
    title: file.title,
    project: file.project,
    tags: file.tags.map((t) => t.tag).sort((a, b) => a.label.localeCompare(b.label)),
    allTags,
    versions,
    canEdit,
    currentUserId: auth.user.sub,
  };
}

export default function FilePage() {
  const { fileId, title, project, tags, allTags, versions, canEdit, currentUserId } =
    useLoaderData() as Exclude<Awaited<ReturnType<typeof loader>>, Response>;

  return (
    <div className="flex flex-col gap-4">
      <Link
        to={project ? `/projects/${project.id}` : "/projects/list"}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← {project ? `Back to ${project.name}` : "Back to projects"}
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="min-w-0">
          <h1 className="font-heading text-3xl font-bold text-foreground">{title}</h1>
          <div className="mt-2">
            <TagPicker
              targetType="file"
              targetId={fileId}
              applied={tags}
              allTags={allTags}
              canEdit={canEdit}
              canCreate={canEdit}
            />
          </div>

          <h2 className="text-sm font-semibold text-foreground mt-6 mb-2">Versions</h2>
          <ul className="flex flex-col divide-y divide-border border border-border rounded-lg">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <span className="text-foreground truncate">{v.fileName}</span>
                  {v.isCurrent && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-accent-teal/15 text-accent-teal">
                      Current
                    </span>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {formatBytes(v.sizeBytes)} · {v.uploadedBy} ·{" "}
                    {new Date(v.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                <a
                  href={v.downloadUrl}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground flex-shrink-0"
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </a>
              </li>
            ))}
          </ul>
        </div>

        <aside className="lg:border-l lg:border-border lg:pl-6">
          <CommentsRail
            targetType="file"
            targetId={fileId}
            currentUserId={currentUserId}
            canComment={canEdit}
          />
        </aside>
      </div>
    </div>
  );
}
