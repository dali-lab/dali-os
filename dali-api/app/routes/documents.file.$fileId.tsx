import { useRef, useState } from "react";
import { useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { Download, Upload } from "lucide-react";
import { Menu, Tooltip } from "~/components/ui/floating";
import { PageBarShareButton } from "~/components/shell/PageBarShareButton";
import { ShareDialog } from "~/components/sharing/ShareDialog";
import { PageBarMenuItems, PageBarPortal, PageBarTitle, pageBarTextButton } from "~/components/shell/page-bar-slot";
import type { Route } from "./+types/documents.file.$fileId";
import { prisma } from "~/lib/db.server";
import { requireLabViewer } from "~/lib/lab-viewer.server";
import { isCore } from "~/lib/roles";
import { canViewFile, canEditFile, canManageFileSharing } from "~/lib/fileAccess.server";
import { getDownloadUrl } from "~/lib/s3.server";
import { hydrateAuthors } from "~/lib/collabAuth.server";
import { formatBytes, uploadFileToS3 } from "~/lib/upload-client";
import { CommentsRail } from "~/components/collab/CommentsRail";
import { FilePreview } from "~/components/FilePreview";
import { TagPicker } from "~/components/TagPicker";
import { ProjectIcon } from "~/components/ProjectIcon";
import { FolderIcon } from "~/components/FolderIcon";
import { driveFolderCrumbs } from "~/drive/lib/drive-crumbs.server";
import { driveRootCrumbs } from "~/drive/lib/drive-crumbs";

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
  docKey: "file.viewer",
  docTitle: "Files",
  // Project files live under the shared /documents/file/* viewer, so the URL
  // prefix says "Documents" but their home is Projects — declare the full trail.
  breadcrumbTrail: (data: unknown) => {
    const d = data as
      | {
          projectId?: string
          projectName?: string
          projectIconEmoji?: string | null
          title?: string
          driveCrumbs?: {
            scope: string
            folders: { id: string; title: string; iconEmoji: string | null }[]
          } | null
        }
      | undefined;
    if (!d?.title) return null;
    // Lab files (no project) root at Drive, then walk the folder path.
    if (!d.projectId || !d.projectName) {
      const scope = d.driveCrumbs?.scope ?? "lab";
      return [
        ...driveRootCrumbs(scope),
        ...(d.driveCrumbs?.folders ?? []).map((f) => ({
          label: f.title || "Untitled folder",
          to: `/drive?scope=${scope}&folder=${f.id}`,
          icon: <FolderIcon iconEmoji={f.iconEmoji} />,
        })),
        { label: d.title },
      ];
    }
    return [
      { label: "Projects", to: "/projects" },
      {
        label: d.projectName,
        to: `/projects/${d.projectId}`,
        icon: <ProjectIcon iconEmoji={d.projectIconEmoji} />,
      },
      // Keep the file's folder ancestry within the project (hub ▸ Folder ▸ …
      // ▸ file); folders deep-link into the Drive folder view, not the doc viewer.
      ...(d.driveCrumbs?.folders ?? []).map((f) => ({
        label: f.title || "Untitled folder",
        to: `/drive?scope=projects&folder=${f.id}`,
        icon: <FolderIcon iconEmoji={f.iconEmoji} />,
      })),
      { label: d.title },
    ];
  },
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const { auth } = await requireLabViewer(request);

  const file = await prisma.projectFile.findUnique({
    where: { id: params.fileId },
    select: {
      id: true,
      title: true,
      projectId: true,
      project: { select: { name: true, iconEmoji: true } },
      workspaceType: true,
      workspaceId: true,
      folderPageId: true,
      linkAccess: true,
      linkPermission: true,
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
          contentType: true,
        },
      },
    },
  });
  if (!file || file.archivedAt !== null) {
    throw new Response("Not found", { status: 404 });
  }

  // View gate: My Drive files are owner-only and scoped-folder (e.g. Core) files
  // follow their folder's access. Communal files stay open (404, not 403, so we
  // don't reveal that a private/Core file exists).
  if (!(await canViewFile(auth.user.sub, file, request))) {
    throw new Response("Not found", { status: 404 });
  }

  // Edit (upload new version + comment) follows the file's scope: My Drive =
  // owner, Core/scoped = folder edit access, project = members/Core, lab = any
  // lab member. The curated tag list stays Core-managed, matching /api/doctags.
  const canEdit = await canEditFile(auth.user.sub, file, request);
  const canManageTags = await isCore(auth.user.sub);
  const canShare = await canManageFileSharing(auth.user.sub, file, request);

  const uploaderNames = await hydrateAuthors(file.versions.map((v) => v.uploadedById));
  const nameById = new Map(uploaderNames.map((u) => [u.id, u.name]));

  const versions = await Promise.all(
    // Newest first, so the oldest upload is V1.
    file.versions.map(async (v, i) => ({
      id: v.id,
      label: `V${file.versions.length - i}`,
      fileName: v.fileName,
      sizeBytes: v.sizeBytes,
      uploadedBy: nameById.get(v.uploadedById) ?? "Unknown",
      createdAt: v.createdAt.toISOString(),
      isCurrent: v.id === file.currentVersionId,
      contentType: v.contentType,
      downloadUrl: `/api/files/${file.id}/download?version=${v.id}`,
      // Inline-preview URL: forces the known content type + inline disposition
      // so the browser renders it even when the S3 object's stored Content-Type
      // is wrong or missing (e.g. generated PDFs served as octet-stream).
      previewUrl: await getDownloadUrl(v.s3Key, {
        contentType: v.contentType ?? undefined,
        inline: true,
      }),
    })),
  );

  const allTags = await prisma.docTag.findMany({
    where: { archivedAt: null },
    orderBy: { label: "asc" },
    select: { id: true, label: true, slug: true, color: true },
  });

  // Lab files live in the Drive tree — resolve folder ancestry for the crumb.
  // Resolve folder ancestry for both Lab files (rooted at Drive) and project
  // files (rooted at the project hub) so the breadcrumb shows the full path.
  const driveCrumbs = await driveFolderCrumbs(file.folderPageId, auth.user.sub, request);

  return {
    fileId: file.id,
    driveCrumbs,
    projectId: file.projectId ?? null,
    projectName: file.project?.name ?? null,
    projectIconEmoji: file.project?.iconEmoji ?? null,
    title: file.title,
    tags: file.tags.map((t) => t.tag).sort((a, b) => a.label.localeCompare(b.label)),
    allTags,
    versions,
    canEdit,
    canShare,
    canManageTags,
    currentUserId: auth.user.sub,
  };
}

export default function FilePage() {
  const {
    fileId,
    projectId,
    title,
    tags,
    allTags,
    versions,
    canEdit,
    canShare,
    canManageTags,
    currentUserId,
  } = useLoaderData<typeof loader>();

  const revalidator = useRevalidator();
  const [fileSearchParams] = useSearchParams();
  const focusCommentId = fileSearchParams.get("comment") ?? undefined;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  // Which version the preview panel shows. Defaults to the current version
  // (versions are newest-first, and the current one is usually newest).
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    versions.find((v) => v.isCurrent)?.id ?? versions[0]?.id ?? null,
  );
  const selected =
    versions.find((v) => v.id === selectedVersionId) ?? versions[0] ?? null;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    setUploading(true);
    setError(null);
    try {
      const prefix = projectId ? `project-files/${projectId}` : "lab-files";
      const meta = await uploadFileToS3(picked, prefix);
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

  async function rename(next: string) {
    await fetch(`/api/files/${fileId}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "rename", title: next }),
    });
    revalidator.revalidate();
  }

  return (
    <div className="flex flex-col gap-4">
      <PageBarTitle title={title} onRename={canEdit ? rename : undefined} />
      {selected && (
        <PageBarPortal slot="status">
          <span className="text-[13px] text-os-muted">
            {selected.label.toLowerCase()} · {formatBytes(selected.sizeBytes)}
          </span>
        </PageBarPortal>
      )}
      {(selected || canShare) && (
        <PageBarPortal slot="actions">
          {canShare && <PageBarShareButton onClick={() => setShareOpen(true)} />}
          {selected && (
            <a href={selected.downloadUrl} className={pageBarTextButton()}>
              <Download className="h-4 w-4" />
              Download
            </a>
          )}
        </PageBarPortal>
      )}
      {canShare && (
        <ShareDialog
          target={{ kind: "file", id: fileId, title }}
          open={shareOpen}
          onClose={() => setShareOpen(false)}
        />
      )}
      {canEdit && (
        <>
          <input ref={fileInputRef} type="file" className="hidden" onChange={onPick} />
          <PageBarMenuItems>
            <Menu.Item
              icon={<Upload className="h-3.5 w-3.5" />}
              disabled={uploading}
              onSelect={() => fileInputRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload new version"}
            </Menu.Item>
          </PageBarMenuItems>
        </>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="min-w-0">
          <div>
            <TagPicker
              targetType="file"
              targetId={fileId}
              applied={tags}
              allTags={allTags}
              canEdit={canManageTags}
              canCreate={canManageTags}
            />
          </div>

          {selected && (
            <div className="mt-6">
              <FilePreview
                previewUrl={selected.previewUrl}
                downloadUrl={selected.downloadUrl}
                contentType={selected.contentType}
                fileName={selected.fileName}
                reloadKey={selected.id}
              />
            </div>
          )}

          <div className="flex items-center justify-between mt-6 mb-2">
            <h2 className="text-sm font-semibold text-foreground">Versions</h2>
          </div>

          {error && (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-md px-3 py-2 mb-2">
              {error}
            </div>
          )}

          <ul className="flex flex-col divide-y divide-border border border-border rounded-lg">
            {versions.map((v) => (
              <li
                key={v.id}
                role="button"
                tabIndex={0}
                aria-pressed={v.id === selected?.id}
                onClick={() => setSelectedVersionId(v.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedVersionId(v.id);
                  }
                }}
                className={`flex items-center justify-between gap-3 px-3 py-2.5 text-sm cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/40 ${
                  v.id === selected?.id ? "bg-os-accent/10" : "hover:bg-muted/40"
                }`}
              >
                <div className="min-w-0">
                  <span className="mr-2 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                    {v.label}
                  </span>
                  <span className="text-foreground truncate">{v.fileName}</span>
                  {v.isCurrent && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-os-accent/15 text-os-accent">
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
                <Tooltip content="Download">
                  <a
                    href={v.downloadUrl}
                    aria-label="Download"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center justify-center p-1.5 rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground flex-shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </a>
                </Tooltip>
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
            focusCommentId={focusCommentId}
            versionLabels={Object.fromEntries(versions.map((v) => [v.id, v.label]))}
            versionId={selected?.id ?? null}
          />
        </aside>
      </div>
    </div>
  );
}

