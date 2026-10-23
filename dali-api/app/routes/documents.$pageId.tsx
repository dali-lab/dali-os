import { useState } from "react";
import { Link, redirect, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import QRCode from "qrcode";
import { Shapes, Trash2, UserCheck } from "lucide-react";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { Button } from "~/components/ui/Button";
import { useToast } from "~/components/ui/toast";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import type { Route } from "./+types/documents.$pageId";
import { prisma } from "~/lib/db";
import { ensureOccurrenceRoster } from "~/lib/scheduled-meeting";
import { ACTIVE_RECORDING_STATUSES, latestRecordingFor } from "~/lib/meeting-recording.server";
import { requireAuth, redirectPartnerToPortal, isNonMember } from "~/lib/auth";
import { publicDocRedirectForPath } from "~/lib/public-doc.server";
import { getCollabToken } from "~/lib/collab-token.server";
import { fullName } from "~/lib/display";
import { getPresenceUser } from "~/lib/presence-user";
import { PAGE_ACCESS_SELECT, getPageAccess, getPageAccessBulk } from "~/lib/pageAccess.server";
import { getUserRoles, isProjectMember } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import type { MeetingType } from "~/generated/prisma/client";
import { isFavorited, recordPageVisit } from "~/lib/user-pages.server";
import { canManageSharing } from "~/lib/page-share-access.server";
import { groupIdsForUser } from "~/lib/page-sharing.server";
import { notebookItemLocation, pageItemLocation } from "~/lib/note-path.server";
import { normalizePageTypography } from "~/lib/page-typography";
import { driveFolderCrumbs } from "~/lib/drive-crumbs.server";
import { workspaceDriveScope } from "~/lib/drive-crumbs";
import type { ItemLocation } from "~/components/drive/location";
import { DocumentEditor } from "~/components/DocumentEditor";
import { AttendanceChecklist, type AttendanceRow } from "~/components/AttendanceChecklist";
import { CheckInPanel } from "~/components/CheckInPanel";
import { MeetingRecorder } from "~/components/MeetingRecorder";
import { RecordingPresencePill } from "~/components/RecordingPresencePill";
import { RecordPromptBanner } from "~/components/RecordPromptBanner";
import { TranscriptChipHoverLayer } from "~/components/meeting-recorder/TranscriptChipHoverLayer";
import { RecordingRail } from "~/components/meeting-recorder/RecordingRail";
import { ActionItemDraftScope } from "~/components/meeting-recorder/action-item-draft";
import { ActionItemChips } from "~/components/meeting-recorder/ActionItemChips";
import { EnhanceBar } from "~/components/meeting-recorder/EnhanceBar";
import { EnhanceBlockActions } from "~/components/meeting-recorder/EnhanceBlockActions";
import { RecordingMount } from "~/components/meeting-recorder/RecordingMount";
import { useRecordingEditor } from "~/components/meeting-recorder/use-recording-editor";
import { EnhanceReviewContext } from "~/components/doc";
import { pageDocName } from "~/collab/roomName";
import { canManageNotebook } from "~/lib/notebooks.server";
import { nextNoteTargets } from "~/lib/notebook-series.server";
import { NotebookRail, NoteLocationLine, type NotebookView } from "~/components/notebooks/NotebookRail";
import { itemTrail, noteTabLabel, noteTrail } from "~/components/notebooks/note-trail";
import { EmptyNotebook } from "~/components/notebooks/EmptyNotebook";
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
  /** A note in a notebook names its place in the shell's trail: space, folders, notebook, tab. */
  breadcrumbTrail: (data: unknown) => {
    const d = data as
      | { notebook?: { id: string; title: string } | null; noteLocation?: { location: ItemLocation; tabLabel: string } | null }
      | undefined;
    return d?.notebook && d.noteLocation ? noteTrail(d.noteLocation.location, d.notebook, d.noteLocation.tabLabel) : null;
  },
  shellTrail: (data: unknown) => {
    const d = data as { title?: string; docLocation?: ItemLocation | null } | undefined;
    return d?.docLocation ? itemTrail(d.docLocation, d.title || "Untitled") : null;
  },
};

type NotebookPage = {
  id: string;
  title: string;
  workspaceType: string;
  workspaceId: string | null;
  parentPageId: string | null;
  templatePage?: { id: string } | null;
};

function notebookShell(
  nb: NotebookPage,
  gate: { canEdit: boolean; manager: boolean; nextNotes: NotebookView["nextNotes"] },
): NotebookView {
  return {
    id: nb.id,
    title: nb.title,
    canEdit: gate.canEdit,
    canManage: gate.manager,
    workspaceType: nb.workspaceType,
    workspaceId: nb.workspaceId,
    folderId: nb.parentPageId,
    templateId: nb.templatePage?.id ?? null,
    projectId: nb.workspaceType === "Project" ? nb.workspaceId : null,
    nextNotes: gate.canEdit ? gate.nextNotes : [],
    tabs: [],
  };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  // Child loaders run alongside the shell's, and the deepest redirect wins, so
  // the public-doc fallback has to be mirrored here for the shell gate to hold.
  const publicDoc = () => publicDocRedirectForPath(new URL(request.url).pathname);
  if (!auth.ok) return (await publicDoc()) ?? redirectToLogin(request);
  if (await isNonMember(auth, request)) return (await publicDoc()) ?? redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) return (await publicDoc()) ?? partnerRedirect;

  const page = await prisma.page.findUnique({
    where: { id: params.pageId },
    select: {
      ...PAGE_ACCESS_SELECT,
      title: true,
      kind: true,
      meetingNoteId: true,
      meetingOccurrenceStart: true,
      seededFromPageId: true,
      seededTemplateHash: true,
      templatePage: { select: { id: true, title: true } },
      parent: {
        select: {
          ...PAGE_ACCESS_SELECT,
          title: true,
          kind: true,
          templatePage: { select: { id: true, title: true } },
        },
      },
      iconEmoji: true,
      coverImageUrl: true,
      isTemplate: true,
      typography: true,
      updatedAt: true,
      defaultMeetingNoteFor: true,
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

  // Only a meeting note reaches this line archived (checked above). Its access
  // has to be resolved from the page's ordinary rules — the default deny would
  // 404 the meeting's "Open meeting note" link and the printed check-in QR the
  // moment someone trashes the note — and is then narrowed to read-only: a
  // trashed doc is readable, never writable, until it's restored.
  const trashed = page.archivedAt !== null;
  const access = await getPageAccess(auth.user.sub, page, request, { includeArchived: trashed });
  if (!access.canView) throw new Response("Not found", { status: 404 });
  const canEdit = access.canEdit && !trashed;
  const canComment = access.canComment && !trashed;
  // Restoring is the same gate the Trash panel applies (edit access), read
  // before the read-only narrowing above.
  const canRestore = trashed && access.canEdit;

  const editViaMeeting =
    canEdit &&
    !(await getPageAccess(auth.user.sub, page, request, { ignoreShares: true })).canEdit &&
    (await prisma.meetingShareGrant.findFirst({
      where: {
        pageId: { in: page.parent?.kind === "Notebook" ? [page.parent.id, page.id] : [page.id] },
        OR: [
          { principalType: "User", principalId: auth.user.sub },
          { principalType: "Group", principalId: { in: await groupIdsForUser(auth.user.sub, request) } },
        ],
      },
      select: { id: true },
    })) !== null;

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
  if (page.kind === "Form") {
    return redirect(`/forms/edit/${page.id}`);
  }

  // A meeting notebook has no body of its own: it opens on the note for the
  // latest meeting that has started, or the first one coming up.
  if (page.kind === "Notebook") {
    const tabs = await prisma.page.findMany({
      where: { parentPageId: page.id, archivedAt: null },
      orderBy: { meetingOccurrenceStart: "desc" },
      select: { id: true, meetingOccurrenceStart: true },
    });
    const now = new Date();
    const tab = tabs.find((t) => (t.meetingOccurrenceStart ?? now) <= now) ?? tabs.at(-1);
    if (tab) return redirect(`/documents/${tab.id}${new URL(request.url).search}`);
    const [nextNotes, manager] = await Promise.all([
      nextNoteTargets(page.id),
      canManageNotebook(auth.user.sub, page, request),
    ]);
    return {
      title: page.title,
      emptyNotebook: notebookShell(page, { canEdit, manager: manager && !trashed, nextNotes }),
    };
  }

  // The other notes in this one's notebook, newest first, for the side tabs.
  let notebook: NotebookView | null = null;
  let noteLocation: { location: ItemLocation; tabLabel: string } | null = null;
  if (page.parent?.kind === "Notebook") {
    const [tabRows, notebookAccess, nextNotes, notebookManager, notebookPlace] = await Promise.all([
      prisma.page.findMany({
        where: { parentPageId: page.parent.id, OR: [{ archivedAt: null }, { id: page.id }] },
        orderBy: { meetingOccurrenceStart: "desc" },
        select: {
          ...PAGE_ACCESS_SELECT,
          title: true,
          meetingNoteId: true,
          meetingOccurrenceStart: true,
          meetingNote: { select: { title: true } },
        },
      }),
      getPageAccess(auth.user.sub, page.parent, request),
      nextNoteTargets(page.parent.id),
      canManageNotebook(auth.user.sub, page.parent, request),
      notebookItemLocation(page.parent, auth.user.sub, request),
    ]);
    noteLocation = {
      location: notebookPlace,
      tabLabel: noteTabLabel(page),
    };
    const tabAccess = await getPageAccessBulk(auth.user.sub, tabRows, request, {
      includeArchived: trashed,
    });
    const visible = tabRows.filter((t) => tabAccess.get(t.id)?.canView);
    // Naming the meeting only helps when the notebook holds more than one.
    const mixed = new Set(visible.map((t) => t.meetingNote?.title)).size > 1;
    const canEditNotebook = notebookAccess.canEdit && !trashed;
    notebook = {
      ...notebookShell(page.parent, { canEdit: canEditNotebook, manager: notebookManager && !trashed, nextNotes }),
      tabs: visible.map((t) => ({
        id: t.id,
        label: noteTabLabel(t),
        meeting: mixed ? (t.meetingNote?.title ?? null) : null,
        isNote: t.meetingNoteId !== null,
      })),
    };
  }

  // After the gate, so a 404 never lands in someone's recents. Detached — a
  // failed bookkeeping write must not cost the reader their document.
  recordPageVisit(auth.user.sub, page.id, request);
  const fallbackName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") || auth.user.email;

  // Everything below the gate is independent of everything else here, so it
  // goes to the database in one wave rather than seven.
  const [favorited, canManageAccess, allTags, meeting, collabToken, presenceUser, backlinkRows, latestRecordingRow, roles] =
    await Promise.all([
      isFavorited(auth.user.sub, page.id),
      // Every workspace type now carries a shareable audience (named shares +
      // General access), so the Share button shows wherever the viewer may manage
      // it — the creator/Core on a lab doc, project staff, the note owner, an
      // instructor, or anyone granted Full access.
      canManageSharing(
        {
          id: page.id,
          workspaceType: page.workspaceType,
          workspaceId: page.workspaceId,
          createdById: page.createdById,
        },
        auth.user.sub,
      ),
      prisma.docTag.findMany({
        where: { archivedAt: null },
        orderBy: { label: "asc" },
        select: { id: true, label: true, slug: true, color: true },
      }),
      page.meetingNoteId
        ? prisma.scheduledMeeting.findUnique({
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
              durationMinutes: true,
              recordPrompt: true,
              whiteboardPage: { select: { id: true } },
              project: { select: { recordingPolicy: true } },
            },
          })
        : Promise.resolve(null),
      getCollabToken(request),
      getPresenceUser(auth.user.sub, fallbackName),
      // Backlinks: pages that mention this page via a @pageMention inline node.
      prisma.pageLink.findMany({
        where: { toPageId: page.id, fromPage: { archivedAt: null } },
        select: {
          fromPage: { select: { id: true, title: true, iconEmoji: true } },
        },
      }),
      // The note's newest recording, whoever started it and whatever its
      // status: the recorder shows a live one in place of Record so nobody
      // starts a second one, and picks up a Done one for a viewer who never
      // watched it live (specs/meeting-transcription.md; fix for a finished
      // recording being invisible to anyone without the local backup).
      latestRecordingFor(pageDocName(page.id)),
      getUserRoles(auth.user.sub, request),
    ]);

  // The Direction I shell's page bar shows a plain document's place in the
  // Drive; notes already carry theirs in noteLocation.
  const docLocation =
    !noteLocation && (await isFeatureEnabled("desktop-tabs", auth.user.sub, roles, request))
      ? await pageItemLocation(page, auth.user.sub, request)
      : null;

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
        // Meeting recording (specs/meeting-transcription.md).
        recordingPolicy: "Allowed" | "Disabled";
        recordPromptEnabled: boolean;
        canDontSuggestRecording: boolean;
        windowEndIso: string;
      }
    | null = null;
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
      recordingPolicy: meeting.project?.recordingPolicy ?? "Allowed",
      recordPromptEnabled: meeting.recordPrompt,
      canDontSuggestRecording: auth.user.sub === meeting.organizerId || roles.isCore,
      windowEndIso: new Date(occurrenceStart.getTime() + meeting.durationMinutes * 60_000).toISOString(),
    };
  }

  const backlinks = backlinkRows.map((r) => ({
    id: r.fromPage.id,
    title: r.fromPage.title,
    iconEmoji: r.fromPage.iconEmoji,
  }));

  // Meeting-note-template binding action (specs/meeting-notes-model.md §1),
  // offered on the template page itself: the project's owner (Core or a
  // staffed member) for a project template, Core for a Lab template.
  let meetingNoteTemplateAction:
    | { scope: "project"; projectName: string; active: boolean }
    | { scope: "lab"; current: MeetingType | null }
    | null = null;
  if (page.kind === "FreeForm" && page.isTemplate && page.workspaceType === "Project" && page.workspaceId) {
    const canEditProjectSettings =
      roles.isCore || (await isProjectMember(auth.user.sub, page.workspaceId, request));
    if (canEditProjectSettings) {
      const owningProject = await prisma.project.findUnique({
        where: { id: page.workspaceId },
        select: { name: true, meetingNoteTemplateId: true },
      });
      if (owningProject) {
        meetingNoteTemplateAction = {
          scope: "project",
          projectName: owningProject.name,
          active: owningProject.meetingNoteTemplateId === page.id,
        };
      }
    }
  } else if (page.kind === "FreeForm" && page.isTemplate && page.workspaceType === "Lab" && roles.isCore) {
    meetingNoteTemplateAction = { scope: "lab", current: page.defaultMeetingNoteFor };
  }

  // Action items into Tasks (specs/meeting-notes-model.md §4): tasks need a
  // project, and the caller needs task-create rights on it — the same gate
  // requireProjectEditAccess applies to POST /api/projects/:id/tasks.
  const projectId = page.workspaceType === "Project" ? page.workspaceId : null;
  const canCreateTasks =
    projectId !== null && (roles.isCore || (await isProjectMember(auth.user.sub, projectId, request)));

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
    noteLocation,
    docLocation,
    editViaMeeting,
    notebookConversion:
      canEdit &&
      page.kind === "FreeForm" &&
      page.parent?.kind !== "Notebook" &&
      page.meetingNoteId === null &&
      (page.workspaceType === "Lab" || page.workspaceType === "Project")
        ? { parentPageId: page.parentPageId }
        : null,
    backlinks,
    trashed,
    canRestore,
    isCore: roles.isCore,
    meetingNoteTemplateAction,
    seededFromPageId: page.seededFromPageId,
    seededTemplateHash: page.seededTemplateHash,
    projectId,
    canCreateTasks,
    latestRecording: latestRecordingRow
      ? {
          id: latestRecordingRow.id,
          ownerName: latestRecordingRow.ownerName,
          ownerIsYou: latestRecordingRow.userId === auth.user.sub,
          status: latestRecordingRow.status,
          since: latestRecordingRow.createdAt.toISOString(),
        }
      : null,
    // RecordPromptBanner only cares whether a LIVE recording already exists
    // for this occurrence (a Done/Failed one shouldn't suppress "Record it?").
    hasActiveRecording:
      latestRecordingRow !== null &&
      (ACTIVE_RECORDING_STATUSES as readonly string[]).includes(latestRecordingRow.status),
  };
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

export default function DocumentRoute() {
  const { emptyNotebook } = useLoaderData() as { emptyNotebook?: NotebookView };
  if (emptyNotebook) return <EmptyNotebook notebook={emptyNotebook} />;
  return <DocumentPage />;
}

function DocumentPage() {
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
    noteLocation,
    editViaMeeting,
    notebookConversion,
    backlinks,
    trashed,
    canRestore,
    isCore,
    meetingNoteTemplateAction,
    seededFromPageId,
    seededTemplateHash,
    latestRecording,
    hasActiveRecording,
    projectId: meetingProjectId,
    canCreateTasks,
  } = useLoaderData() as Extract<Awaited<ReturnType<typeof loader>>, { pageId: string }>;

  // Arriving from a comment-mention notification (?comment=<id>): open the
  // comments panel and scroll to that comment once threads load.
  // Arriving from an @-mention notification (?mention=<userId>): scroll to and
  // flash the first mention chip for that user once the collab doc syncs.
  const [searchParams] = useSearchParams();
  const focusCommentId = searchParams.get("comment") ?? undefined;
  const focusMentionUserId = searchParams.get("mention") ?? undefined;
  const recordingEnabled = useFeatureFlag("ai-meeting-notes");
  const recordingAllowed = attendance?.recordingPolicy !== "Disabled";
  const hasTranscriptParam = Boolean(searchParams.get("transcript"));
  const [recordAutoOpen, setRecordAutoOpen] = useState(searchParams.get("record") === "1");
  const recordingMountEnabled = recordingEnabled && recordingAllowed && (canEdit || hasTranscriptParam);
  // DocumentEditor is the only component that measures the ≥ 1150px check;
  // the top-bar Record button needs it too, to answer a live recording with
  // a Popover instead of toggling the rail on a narrow canvas
  // (specs/meeting-recording-rail.md "Wiring").
  const [containerWide, setContainerWide] = useState(false);
  const toast = useToast();
  const { actionBtnPrimary, actionIcon } = useOsChrome();

  async function dontSuggestRecording() {
    if (!attendance) return;
    const fd = new FormData();
    fd.set("intent", "recordPrompt");
    const res = await fetch(`/calendar/meeting/${attendance.meetingId}`, {
      method: "POST",
      credentials: "include",
      body: fd,
    }).catch(() => null);
    if (!res?.ok) toast.error("Couldn't turn off the record prompt for this meeting.");
  }

  const { editorRef, onEditorReady, hookProps: recordingEditorProps } = useRecordingEditor({
    notePath: `/documents/${pageId}`,
    projectId: meetingProjectId,
  });

  return (
    <RecordingMount
      enabled={recordingMountEnabled}
      documentName={pageDocName(pageId)}
      scheduledMeetingId={attendance?.meetingId}
      occurrenceStart={attendance?.occurrenceStart}
      roster={attendance?.rows.map((r) => ({ userId: r.userId, name: r.name }))}
      canEdit={canEdit}
      isCore={isCore}
      latestRecording={latestRecording}
      autoOpen={recordAutoOpen}
      collabToken={collabToken}
      seededFromPageId={seededFromPageId}
      seededTemplateHash={seededTemplateHash}
      projectId={meetingProjectId}
      canCreateTasks={canCreateTasks}
      {...recordingEditorProps}
    >
      {(rec) => {
        const recordingLive = rec ? rec.phase === "recording" || rec.phase === "starting" || rec.phase === "stopping" : false;

        function onChipClick(recordingId: string, at: number): boolean {
          if (!rec || rec.recordingId !== recordingId) return false;
          rec.jumpToTranscript(at);
          return true;
        }

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
            meetingNoteTemplateAction={meetingNoteTemplateAction}
            notebookConversion={notebookConversion}
            aiEnabled
            toolbarInPageBar
            onEditorReady={onEditorReady}
            onContainerWideChange={setContainerWide}
            belowTabs={rec ? <EnhanceBar rec={rec} /> : undefined}
            rail={
              rec
                ? {
                    node: <RecordingRail rec={rec} />,
                    open: rec.open && rec.phase !== "idle",
                    onClose: () => rec.setOpen(false),
                    live: recordingLive,
                  }
                : undefined
            }
            topBarActions={
              <>
                {attendance && <AttendanceButton attendance={attendance} />}
                <RecordingPresencePill documentName={pageDocName(pageId)} collabToken={collabToken} />
                {rec && <MeetingRecorder rec={rec} containerWide={containerWide} />}
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

        // Lets DocSideMenu offer Keep change/Revert change on a marked block
        // without the generic side menu knowing anything about Enhance
        // (specs/meeting-recording-rail.md Step 2). Null when the recording
        // hook isn't mounted — the side menu then renders nothing extra.
        const enhanceReview = rec
          ? { keepBlock: rec.keepBlock, revertBlock: rec.revertBlock, priorBlocks: rec.enhanceNotes?.priorBlocks }
          : null;

        return (
          <ActionItemDraftScope rec={rec}>
          <EnhanceReviewContext.Provider value={enhanceReview}>
            <div className="flex flex-col gap-4">
              {rec && <EnhanceBlockActions rec={rec} getRoot={() => editorRef.current?.domElement ?? null} />}
              {rec && <ActionItemChips rec={rec} getRoot={() => editorRef.current?.domElement ?? null} />}
              {trashed && <TrashedNoteBanner pageId={pageId} canRestore={canRestore} />}
              {attendance && recordingEnabled && recordingAllowed && (
                <RecordPromptBanner
                  meetingId={attendance.meetingId}
                  occurrenceStart={attendance.occurrenceStart}
                  windowEndIso={attendance.windowEndIso}
                  canEdit={canEdit}
                  recordingEnabled={recordingEnabled}
                  recordPromptEnabled={attendance.recordPromptEnabled}
                  hasActiveRecording={hasActiveRecording}
                  canDontSuggest={attendance.canDontSuggestRecording}
                  onRecord={() => setRecordAutoOpen(true)}
                  onDontSuggest={() => void dontSuggestRecording()}
                />
              )}
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
              {notebook && (
                <NoteLocationLine
                  notebook={notebook}
                  editViaMeeting={editViaMeeting}
                  showControls={notebook.tabs.length <= 1}
                />
              )}
              {notebook && notebook.tabs.length > 1 ? (
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                  <NotebookRail notebook={notebook} currentId={pageId} />
                  <div className="min-w-0 flex-1">
                    <TranscriptChipHoverLayer onChipClick={onChipClick} railOpen={Boolean(rec?.open)}>
                      {editor}
                    </TranscriptChipHoverLayer>
                  </div>
                </div>
              ) : (
                <TranscriptChipHoverLayer onChipClick={onChipClick} railOpen={Boolean(rec?.open)}>
                  {editor}
                </TranscriptChipHoverLayer>
              )}
            </div>
          </EnhanceReviewContext.Provider>
          </ActionItemDraftScope>
        );
      }}
    </RecordingMount>
  );
}
