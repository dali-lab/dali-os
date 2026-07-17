import { useRef, useState } from "react";
import { redirect, useLoaderData, useRevalidator } from "react-router";
import { Download, Upload } from "lucide-react";
import type { Route } from "./+types/documents.file.$fileId";
import { prisma } from "~/lib/db";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { getDownloadUrl } from "~/lib/s3";
import { hydrateAuthors } from "~/lib/collabAuth";
import { formatBytes, uploadFileToS3 } from "~/lib/upload-client";
import { CommentsRail } from "~/components/collab/CommentsRail";
import { TagPicker } from "~/components/TagPicker";

export const meta: Route.MetaFunction = ({ data }) => {
  const t = (data as { title?: string } | undefined)?.title;
  return [{ title: t ? `${t} · DALI OS` : "File · DALI OS" }];
};

// Not nested under /projects/:id in the URL (this route is a standalone
// /documents/file/:fileId sibling), so Breadcrumbs can't pick up the owning
// project from a parent route match — the "file" segment is dropped (see
// Breadcrumbs' DROPPED_SEGMENTS) and this expands the leaf into the real
// trail back to the project hub instead.
export const handle = {
  breadcrumb: (data: unknown) => {
    const d = data as
      | { projectId?: string; projectName?: string; title?: string }
      | undefined;
    if (!d?.projectId || !d.projectName) return null;
    return [
      { label: d.projectName, to: `/projects/${d.projectId}` },
      { label: d.title ?? "File" },
    ];
  },
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return partnerRedirect;

  const file = await prisma.projectFile.findUnique({
    where: { id: params.fileId },
    select: {
      id: true,
      title: true,
      projectId: true,
      project: { select: { name: true } },
      currentVersionId: true,
      archivedAt: true,
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
    projectId: file.projectId,
    projectName: file.project.name,
    title: file.title,
    tags: file.tags.map((t) => t.tag).sort((a, b) => a.label.localeCompare(b.label)),
    allTags,
    versions,
    canEdit,
    currentUserId: auth.user.sub,
  };
}

export default function FilePage() {
  const { fileId, projectId, title, tags, allTags, versions, canEdit, currentUserId } =
    useLoaderData() as Exclude<Awaited<ReturnType<typeof loader>>, Response>;

  const revalidator = useRevalidator();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    setUploading(true);
    setError(null);
    try {
      const meta = await uploadFileToS3(picked, `project-files/${projectId}`);
      const res = await fetch(`/api/files/${fileId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "version", ...meta }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed to upload new version");
      }
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
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

          <div className="flex items-center justify-between mt-6 mb-2">
            <h2 className="text-sm font-semibold text-foreground">Versions</h2>
            {canEdit && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={onPick}
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent-coral hover:underline disabled:opacity-60"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {uploading ? "Uploading…" : "Upload new version"}
                </button>
              </>
            )}
          </div>

          {error && (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-md px-3 py-2 mb-2">
              {error}
            </div>
          )}

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
