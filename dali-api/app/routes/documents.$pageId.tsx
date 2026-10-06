import { useCallback, useRef, useState } from "react";
import { Link, redirect, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import QRCode from "qrcode";
import { Shapes, Trash2, UserCheck } from "lucide-react";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { Button } from "~/components/ui/Button";
import { useToast } from "~/components/ui/toast";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import type { Route } from "./+types/documents.$pageId";
import { prisma } from "~/lib/db";
import { ensureOccurrenceRoster } from "~/lib/scheduled-meeting";
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { publicDocRedirectForPath } from "~/lib/public-doc.server";
import { getCollabToken } from "~/lib/collab-token.server";
import { fullName, formatDateShort } from "~/lib/display";
import { getPresenceUser } from "~/lib/presence-user";
import { getPageAccess, getPageAccessBulk } from "~/lib/pageAccess.server";
import { isFavorited, recordPageVisit } from "~/lib/user-pages.server";
import { canManageSharing } from "~/lib/page-share-access.server";
import { normalizePageTypography } from "~/lib/page-typography";
import { driveFolderCrumbs } from "~/lib/drive-crumbs.server";
import { workspaceDriveScope } from "~/lib/drive-crumbs";
import { DocumentEditor } from "~/components/DocumentEditor";
import { AttendanceChecklist, type AttendanceRow } from "~/components/AttendanceChecklist";
import { CheckInPanel } from "~/components/CheckInPanel";
import { MeetingRecorder } from "~/components/MeetingRecorder";
import { appendBlocks } from "~/components/doc";
import type { DocEditorInstance } from "~/components/doc/schema/build";
import { pageDocName } from "~/collab/roomName";
import { redirectToLogin } from "~/lib/login-next";
import { walletTokensConfigured } from "~/lib/wallet-token";

export const meta: Route.MetaFunction = ({ data }) => {
  const t = (data as { title?: string } | undefined)?.title;
  return [{ title: t ? `${t} · DALI OS` : "Document · DALI OS" }];
};

export const handle = {
  docKey: "document.editor",
  docTitle: "Documents",
  hideBreadcrumbs: true,
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  // Child loaders run alongside the shell's, and the deepest redirect wins, so
  // the public-doc fallback has to be mirrored here for the shell gate to hold.
  const publicDoc = () => publicDocRedirectForPath(new URL(request.url).pathname);
  if (!auth.ok) return (await publicDoc()) ?? redirectToLogin(request);
  if (auth.user.type === "applicant") return (await publicDoc()) ?? redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return (await publicDoc()) ?? partnerRedirect;

  const page = await prisma.page.findUnique({
    where: { id: params.pageId },
    select: {
      id: true,
      title: true,
      kind: true,
      workspaceType: true,
      workspaceId: true,
      parentPageId: true,
      archivedAt: true,
      meetingNoteId: true,
      meetingOccurrenceStart: true,
      notebookKey: true,
      parent: { select: { id: true, title: true, notebookKey: true } },
      iconEmoji: true,
      coverImageUrl: true,
      isTemplate: true,
      typography: true,
      updatedAt: true,
      createdById: true,
      partnerVisible: true,
      profileVisible: true,
      labListing: true,
      linkAccess: true,
      linkPermission: true,
      createdBy: { select: { firstName: true, lastName: true } },
      lastEditedBy: { select: { firstName: true, lastName: true } },
      tags: { select: { tag: { select: { id: true, label: true, slug: true, color: true } } } },
    },
  });
  // Mirrors the doc gate in authorizeCollabDoc: live page, any workspaceType.
  // Exception: meeting-note pages stay openable when archived — the SelfCheckIn
  // QR and the Attendance surface deep-link to /documents/:id, and archiving the
  // note from the Documents hub must not break check-in for invitees.
  if (!page) {
    throw new Response("Not found", { status: 404 });
  }
  if (page.archivedAt !== null && !page.meetingNoteId) {
    throw new Response("Not found", { status: 404 });
  }

  // Unified permission resolution. Passing the full field set (createdById, the
  // general-access + note-visibility flags) makes this match the by-id path
  // exactly — the Lab branch keys off createdById/Core plus the General-access
  // and share layers. The Member read gate is folded in here (getPageAccess
  // handles notes), so there's no separate noteAccess pre-check.
  // Only a meeting note reaches this line archived (checked above). Its access
  // has to be resolved from the page's ordinary rules — the default deny would
  // 404 the meeting's "Open meeting note" link and the printed check-in QR the
  // moment someone trashes the note — and is then narrowed to read-only: a
  // trashed doc is readable, never writable, until it's restored.
  const trashed = page.archivedAt !== null;
  const access = await getPageAccess(
    auth.user.sub,
    {
      id: page.id,
      workspaceType: page.workspaceType,
      workspaceId: page.workspaceId,
      archivedAt: page.archivedAt,
      createdById: page.createdById,
      partnerVisible: page.partnerVisible,
      profileVisible: page.profileVisible,
      labListing: page.labListing,
      linkAccess: page.linkAccess,
      linkPermission: page.linkPermission,
    },
    undefined,
    { includeArchived: trashed },
  );
  if (!access.canView) throw new Response("Not found", { status: 404 });
  const canEdit = access.canEdit && !trashed;
  const canComment = access.canComment && !trashed;
  // Restoring is the same gate the Trash panel applies (edit access), read
  // before the read-only narrowing above.
  const canRestore = trashed && access.canEdit;

  // Folder pages are Drive containers, not documents — the doc viewer would
  // render them with an editable body and a document breadcrumb. Send folders to
  // the Drive drilled into that folder, whatever the entry point (breadcrumb
  // link, bookmark, stale href). The Drive scope is the page's workspace; Lab
  // folders resolve to lab/core/hiring via the folder chain.
  if (page.kind === "Folder") {
    const scope =
      workspaceDriveScope(page.workspaceType) ??
      (await driveFolderCrumbs(page.id, auth.user.sub, request)).scope;
    return redirect(`/drive?scope=${scope}&folder=${page.id}`);
  }

  // Whiteboards are Excalidraw canvases, not text documents — send any stale
  // /documents/:id entry point (bookmark, recents, search hit) to the canvas.
  if (page.kind === "Whiteboard") {
    return redirect(`/whiteboard/${page.id}`);
  }

  // A meeting notebook has no body of its own: it opens on the note for the
  // latest meeting that has started, or the first one coming up.
  if (page.notebookKey) {
    const tabs = await prisma.page.findMany({
      where: { parentPageId: page.id, archivedAt: null },
      orderBy: { meetingOccurrenceStart: "desc" },
      select: { id: true, meetingOccurrenceStart: true },
    });
    const now = new Date();
    const tab = tabs.find((t) => (t.meetingOccurrenceStart ?? now) <= now) ?? tabs.at(-1);
    if (tab) return redirect(`/documents/${tab.id}${new URL(request.url).search}`);
  }

  // The other notes in this one's notebook, newest first, for the side tabs.
  let notebook: {
    title: string;
    tabs: { id: string; label: string; meeting: string | null }[];
  } | null = null;
  if (page.parent?.notebookKey) {
    const tabRows = await prisma.page.findMany({
      where: { parentPageId: page.parent.id, OR: [{ archivedAt: null }, { id: page.id }] },
      orderBy: { meetingOccurrenceStart: "desc" },
      select: {
        id: true,
        title: true,
        meetingOccurrenceStart: true,
        meetingNote: { select: { title: true } },
        // The same access shape the page itself was judged on above.
        workspaceType: true,
        workspaceId: true,
        archivedAt: true,
        createdById: true,
        partnerVisible: true,
        profileVisible: true,
        labListing: true,
        linkAccess: true,
        linkPermission: true,
      },
    });
    const tabAccess = await getPageAccessBulk(auth.user.sub, tabRows, request, {
      includeArchived: trashed,
    });
    const visible = tabRows.filter((t) => tabAccess.get(t.id)?.canView);
    // Naming the meeting only helps when the notebook holds more than one.
    const mixed = new Set(visible.map((t) => t.meetingNote?.title)).size > 1;
    notebook = {
      title: page.parent.title,
      tabs: visible.map((t) => ({
        id: t.id,
        label: t.meetingOccurrenceStart ? formatDateShort(t.meetingOccurrenceStart) : t.title,
        meeting: mixed ? (t.meetingNote?.title ?? null) : null,
      })),
    };
  }

  // After the gate, so a 404 never lands in someone's recents. Detached — a
  // failed bookkeeping write must not cost the reader their document.
  recordPageVisit(auth.user.sub, page.id, request);
  const favorited = await isFavorited(auth.user.sub, page.id);

  // Every workspace type now carries a shareable audience (named shares +
  // General access), so the Share button shows wherever the viewer may manage
  // it — the creator/Core on a lab doc, project staff, the note owner, an
  // instructor, or anyone granted Full access.
  const canManageAccess = await canManageSharing(
    {
      id: page.id,
      workspaceType: page.workspaceType,
      workspaceId: page.workspaceId,
      createdById: page.createdById,
    },
    auth.user.sub,
  );

  const allTags = await prisma.docTag.findMany({
    where: { archivedAt: null },
    orderBy: { label: "asc" },
    select: { id: true, label: true, slug: true, color: true },
  });

  let attendance:
    | {
        meetingId: string;
        /** The occurrence this note is for — its roster is that occurrence's. */
        occurrenceStart: string;
        meetingLabel: string;
        /** The meeting's linked whiteboard, when it has one (whiteboard flag). */
        whiteboardPageId: string | null;
        canMark: boolean;
        rows: AttendanceRow[];
        selfCheckIn: boolean;
        viewerInvited: boolean;
        viewerPresent: boolean;
        checkInUrl: string | null;
        checkInQrSvg: string | null;
        walletConfigured: boolean;
      }
    | null = null;
  if (page.meetingNoteId) {
    const meeting = await prisma.scheduledMeeting.findUnique({
      where: { id: page.meetingNoteId },
      select: {
        id: true,
        organizerId: true,
        participantUserIds: true,
        selectedAt: true,
        createdAt: true,
        recurrenceRule: true,
        meetingType: true,
        meetingTypeLabel: true,
        attendanceMode: true,
        whiteboardPage: { select: { id: true } },
      },
    });
    if (meeting) {
      const occurrenceStart = page.meetingOccurrenceStart ?? meeting.selectedAt ?? meeting.createdAt;
      await ensureOccurrenceRoster(meeting, occurrenceStart);
      const rows = await prisma.meetingAttendance.findMany({
        where: { scheduledMeetingId: meeting.id, occurrenceStart },
        select: {
          userId: true,
          present: true,
          user: { select: { firstName: true, lastName: true, daliEmail: true } },
        },
      });
      const label =
        meeting.meetingType === "Other"
          ? meeting.meetingTypeLabel || "Other"
          : (meeting.meetingType ?? "Meeting");
      const canMark = canEdit || auth.user.sub === meeting.organizerId;
      const viewerRow = rows.find((a) => a.userId === auth.user.sub);
      const selfCheckIn = meeting.attendanceMode === "SelfCheckIn";

      // Only the organizer/Core need the QR/link to display at the event —
      // everyone else just sees the check-in button below if they scanned it.
      // A recurring meeting's code points at its check-in page instead of this
      // week's note, since the same printed code is used every week.
      let checkInUrl: string | null = null;
      let checkInQrSvg: string | null = null;
      if (selfCheckIn && canMark) {
        const origin = new URL(request.url).origin;
        checkInUrl = meeting.recurrenceRule
          ? `${origin}/calendar/check-in/${meeting.id}`
          : `${origin}/documents/${page.id}`;
        checkInQrSvg = await QRCode.toString(checkInUrl, { type: "svg", margin: 1, width: 180 });
      }

      attendance = {
        meetingId: meeting.id,
        occurrenceStart: occurrenceStart.toISOString(),
        meetingLabel: label,
        whiteboardPageId: meeting.whiteboardPage?.id ?? null,
        canMark,
        rows: rows.map((a) => ({
          userId: a.userId,
          name: fullName(a.user) || a.user.daliEmail || a.userId,
          present: a.present,
        })),
        selfCheckIn,
        viewerInvited: viewerRow !== undefined,
        viewerPresent: viewerRow?.present ?? false,
        checkInUrl,
        checkInQrSvg,
        walletConfigured: walletTokensConfigured(),
      };
    }
  }

  const collabToken = await getCollabToken(request);
  const fallbackName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") || auth.user.email;
  const presenceUser = await getPresenceUser(auth.user.sub, fallbackName);

  // Backlinks: pages that mention this page via a @pageMention inline node.
  const backlinkRows = await prisma.pageLink.findMany({
    where: { toPageId: page.id, fromPage: { archivedAt: null } },
    select: {
      fromPage: { select: { id: true, title: true, iconEmoji: true } },
    },
  });
  const backlinks = backlinkRows.map((r) => ({
    id: r.fromPage.id,
    title: r.fromPage.title,
    iconEmoji: r.fromPage.iconEmoji,
  }));

  return {
    pageId: page.id,
    title: page.title,
    workspaceType: page.workspaceType,
    workspaceId: page.workspaceId,
    iconEmoji: page.iconEmoji,
    coverImageUrl: page.coverImageUrl,
    isTemplate: page.isTemplate,
    typography: normalizePageTypography(page.typography),
    updatedAt: page.updatedAt.toISOString(),
    tags: page.tags.map((t) => t.tag).sort((a, b) => a.label.localeCompare(b.label)),
    allTags,
    canEdit,
    canComment,
    canManageAccess,
    favorited,
    collabToken,
    userName: presenceUser?.name ?? fallbackName,
    currentUserId: auth.user.sub,
    photoUrl: presenceUser?.photoUrl ?? null,
    subtitle: presenceUser?.subtitle ?? null,
    attendance,
    notebook,
    backlinks,
    trashed,
    canRestore,
  };
}

// A notebook's notes as side tabs, the way a Google Doc lists its tabs: one
// document in the Drive, one tab per meeting.
function NotebookTabs({
  notebook,
  currentId,
}: {
  notebook: { title: string; tabs: { id: string; label: string; meeting: string | null }[] };
  currentId: string;
}) {
  const { card } = useOsChrome();
  return (
    <nav
      aria-label={notebook.title}
      className={cn(card, "flex min-w-0 shrink-0 flex-col gap-2 p-3 lg:sticky lg:top-4 lg:w-56")}
    >
      <p className="truncate px-2 text-sm font-semibold text-foreground">{notebook.title}</p>
      <ul className="flex gap-1 overflow-x-auto lg:max-h-[70vh] lg:flex-col lg:overflow-y-auto">
        {notebook.tabs.map((tab) => {
          const current = tab.id === currentId;
          return (
            <li key={tab.id} className="shrink-0">
              <Link
                to={`/documents/${tab.id}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "block rounded-os-item px-2 py-1.5 text-sm transition-colors",
                  current
                    ? "bg-os-accent/15 text-os-accent"
                    : "text-os-grey hover:bg-os-container hover:text-foreground",
                )}
              >
                <span className="block truncate">{tab.label}</span>
                {tab.meeting && <span className="block truncate text-xs">{tab.meeting}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// A trashed meeting note still opens (read-only) so check-in and the meeting's
// attendance roster keep working, which leaves the body looking like an ordinary
// doc with no explanation. Say where it is, and offer the way back.
function TrashedNoteBanner({ pageId, canRestore }: { pageId: string; canRestore: boolean }) {
  const toast = useToast();
  const [restoring, setRestoring] = useState(false);

  async function restore() {
    setRestoring(true);
    try {
      const fd = new FormData();
      fd.set("intent", "restore");
      fd.set("type", "doc");
      fd.set("id", pageId);
      const res = await fetch("/api/drive/trash", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        toast.error("Couldn't restore this note");
        setRestoring(false);
        return;
      }
      // A reload, not a revalidation: the collab socket has already connected
      // read-only, and only a fresh connection drops that.
      window.location.reload();
    } catch {
      toast.error("Couldn't restore this note");
      setRestoring(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-os-card border border-border bg-muted px-4 py-3">
      <p className="flex items-center gap-2 text-sm text-foreground">
        <Trash2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        This note is in the trash, so it's read-only.
      </p>
      {canRestore && (
        <Button size="sm" onClick={() => void restore()} disabled={restoring}>
          {restoring ? "Restoring…" : "Restore"}
        </Button>
      )}
    </div>
  );
}

// The roster keeps its own optimistic state, so closing reloads the loader's
// copy for the next time the dialog opens.
function AttendanceButton({
  attendance,
}: {
  attendance: {
    meetingId: string;
    occurrenceStart: string;
    meetingLabel: string;
    canMark: boolean;
    walletConfigured: boolean;
    rows: AttendanceRow[];
  };
}) {
  const { actionBtnPrimary, actionIcon } = useOsChrome();
  const revalidator = useRevalidator();
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    revalidator.revalidate();
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Attendance" className={actionBtnPrimary}>
        <UserCheck className={actionIcon} />
        <span className="hidden sm:inline">Attendance</span>
      </button>
      <Modal
        open={open}
        onClose={close}
        labelledBy="doc-attendance-title"
        containerClassName={modalCardClass("max-w-4xl")}
      >
        <ModalHeader
          titleId="doc-attendance-title"
          title="Attendance"
          subtitle={attendance.meetingLabel}
          onClose={close}
          className="mb-1"
        />
        <AttendanceChecklist
          plain
          meetingId={attendance.meetingId}
          occurrenceStart={attendance.occurrenceStart}
          meetingLabel={attendance.meetingLabel}
          canEdit={attendance.canMark}
          canScan={attendance.walletConfigured}
          attendees={attendance.rows}
        />
      </Modal>
    </>
  );
}

export default function DocumentPage() {
  const {
    pageId,
    title,
    workspaceType,
    workspaceId,
    tags,
    allTags,
    canEdit,
    canComment,
    canManageAccess,
    favorited,
    collabToken,
    userName,
    currentUserId,
    photoUrl,
    subtitle,
    iconEmoji,
    coverImageUrl,
    isTemplate,
    typography,
    updatedAt,
    attendance,
    notebook,
    backlinks,
    trashed,
    canRestore,
  } = useLoaderData() as Exclude<Awaited<ReturnType<typeof loader>>, Response>;

  // Arriving from a comment-mention notification (?comment=<id>): open the
  // comments panel and scroll to that comment once threads load.
  // Arriving from an @-mention notification (?mention=<userId>): scroll to and
  // flash the first mention chip for that user once the collab doc syncs.
  const [searchParams] = useSearchParams();
  const focusCommentId = searchParams.get("comment") ?? undefined;
  const focusMentionUserId = searchParams.get("mention") ?? undefined;
  const recordingEnabled = useFeatureFlag("ai-meeting-notes");
  const { actionBtnPrimary, actionIcon } = useOsChrome();

  // Meeting recording writes into the doc through the live editor, so
  // collaborators see the notes arrive like any other edit.
  const editorRef = useRef<DocEditorInstance | null>(null);
  const onEditorReady = useCallback((ed: DocEditorInstance) => {
    editorRef.current = ed;
  }, []);
  const insertMarkdown = useCallback((markdown: string) => {
    const editor = editorRef.current;
    if (!editor) return false;
    appendBlocks(editor, editor.tryParseMarkdownToBlocks(markdown));
    return true;
  }, []);

  const editor = (
    <DocumentEditor
      key={pageId}
      pageId={pageId}
      initialTitle={title}
      collabToken={collabToken}
      userName={userName}
      currentUserId={currentUserId}
      photoUrl={photoUrl}
      subtitle={subtitle}
      canEdit={canEdit}
      canComment={canComment}
      canManageAccess={canManageAccess}
      favorited={favorited}
      workspaceType={workspaceType}
      workspaceId={workspaceId}
      tags={tags}
      allTags={allTags}
      iconEmoji={iconEmoji}
      coverImageUrl={coverImageUrl}
      isTemplate={isTemplate}
      typography={typography}
      updatedAt={updatedAt}
      focusCommentId={focusCommentId}
      backlinks={backlinks}
      focusMentionUserId={focusMentionUserId}
      aiEnabled
      onEditorReady={onEditorReady}
      topBarActions={
        <>
          {attendance && <AttendanceButton attendance={attendance} />}
          {recordingEnabled && canEdit && (
            <MeetingRecorder documentName={pageDocName(pageId)} onInsert={insertMarkdown} />
          )}
          {attendance?.whiteboardPageId && (
            // This meeting also has a whiteboard — link across to it (the
            // board carries the matching link back).
            <Link
              to={`/whiteboard/${attendance.whiteboardPageId}`}
              aria-label="Whiteboard"
              className={actionBtnPrimary}
            >
              <Shapes className={actionIcon} />
              <span className="hidden sm:inline">Whiteboard</span>
            </Link>
          )}
        </>
      }
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {trashed && <TrashedNoteBanner pageId={pageId} canRestore={canRestore} />}
      {attendance?.selfCheckIn && (
        <CheckInPanel
          meetingId={attendance.meetingId}
          meetingLabel={attendance.meetingLabel}
          viewerInvited={attendance.viewerInvited}
          initialPresent={attendance.viewerPresent}
          checkInUrl={attendance.checkInUrl}
          checkInQrSvg={attendance.checkInQrSvg}
        />
      )}
      {notebook ? (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <NotebookTabs notebook={notebook} currentId={pageId} />
          <div className="min-w-0 flex-1">{editor}</div>
        </div>
      ) : (
        editor
      )}
    </div>
  );
}
