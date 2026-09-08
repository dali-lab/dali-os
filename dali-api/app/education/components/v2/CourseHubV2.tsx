import { useState, useCallback, useMemo, useRef } from "react";
import { Link, useSearchParams, useNavigate, useRevalidator } from "react-router";
import { FileText, Download, FolderPlus, Plus, ChevronDown, Upload } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { Avatar } from "~/components/ui/Avatar";
import { cn } from "~/lib/cn";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { EduBand } from "./EduBand";
import { JourneyBand, type JourneyStop, type CertificateNode } from "./JourneyBand";
import { SessionPane } from "./SessionPane";
import { InstructorModeToggle } from "./InstructorModeToggle";
import { JourneyEditingLayer } from "./JourneyEditing";
import { SessionPaneInstructor } from "./SessionPaneInstructor";
import {
  GradesTab,
  WorkspaceTab,
  DiscussionBoard,
  type HubData,
} from "../CourseHub";
import { DriveBrowser } from "~/components/drive/DriveBrowser";
import type { DriveItem } from "~/lib/drive.server";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";
import type { RowActions } from "~/components/drive/DriveBrowser";
import { moveDriveItem, driveErrorFrom } from "~/components/drive/move-item";
import { DestinationPicker } from "~/components/drive/DestinationPicker";
import type { PickerDrive, PickerFolder, Destination } from "~/components/drive/DestinationPicker";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { Select, Menu } from "~/components/ui/floating";
import { filterPillClass } from "~/components/ui/floating/styles";

// ---------------------------------------------------------------------------
// Instructor extras type (mirrors manage-hub.server getInstructorHubExtras)
// ---------------------------------------------------------------------------

export type InstructorExtras = {
  offeringStatus: string;
  closedOutAt: Date | null | string;
  capacity: number | null;
  approvedCount: number;
  presentBySession: Record<string, number>;
  willEarnCount: number;
  applicationCounts: {
    submitted: number;
    approved: number;
    waitlisted: number;
    rejected: number;
    withdrawn: number;
  };
};

export type SessionRoster = {
  session: unknown;
  roster: { applicationId: string; name: string; status: string | null }[];
} | null;

// ---------------------------------------------------------------------------
// Tab definition
// ---------------------------------------------------------------------------

type TabKey = "journey" | "grades" | "discussions" | "files" | "workspace" | "about";

const TAB_ALIASES: Record<string, TabKey> = {
  journey: "journey",
  grades: "grades",
  discussions: "discussions",
  files: "files",
  workspace: "workspace",
  about: "about",
  timeline: "journey",
  // legacy URL values
  talk: "discussions",
  library: "files",
  overview: "about",
};

function resolveTab(raw: string | null, hasWorkspace: boolean): TabKey {
  const mapped = raw ? TAB_ALIASES[raw] : undefined;
  if (!mapped) return "journey";
  if (mapped === "workspace" && !hasWorkspace) return "journey";
  return mapped;
}

// ---------------------------------------------------------------------------
// Shared pill nav
// ---------------------------------------------------------------------------

function PillNav({
  tabs,
  activeKey,
  onSelect,
}: {
  tabs: { key: TabKey; label: string; badge?: number }[];
  activeKey: TabKey;
  onSelect: (key: TabKey) => void;
}) {
  return (
    <div
      className="inline-flex w-fit max-w-full items-center gap-1 overflow-x-auto no-scrollbar rounded-full border border-border bg-card p-1"
      role="tablist"
      aria-label="Course sections"
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === activeKey}
          onClick={() => onSelect(t.key)}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors whitespace-nowrap",
            t.key === activeKey
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
          {t.badge != null && t.badge > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-accent-coral text-white text-[10px] font-bold min-w-4 h-4 px-1">
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Library pane
// ---------------------------------------------------------------------------

function LibraryPane({
  materials,
  files,
  sessions,
  basePath,
}: {
  materials: HubData["materials"];
  files: NonNullable<HubData["files"]>;
  sessions: HubData["sessions"];
  basePath: string;
}) {
  const courseWideLeaves = materials.filter((m) => !m.isFolder && !m.sessionId);
  const courseWideFolders = materials.filter((m) => m.isFolder);

  const sessionMaterialMap = new Map<string, { pageId: string; title: string }[]>();
  for (const m of materials) {
    if (!m.isFolder && m.sessionId) {
      const list = sessionMaterialMap.get(m.sessionId) ?? [];
      list.push({ pageId: m.id, title: m.title });
      sessionMaterialMap.set(m.sessionId, list);
    }
    for (const c of m.children) {
      if (c.sessionId) {
        const list = sessionMaterialMap.get(c.sessionId) ?? [];
        list.push({ pageId: c.id, title: c.title });
        sessionMaterialMap.set(c.sessionId, list);
      }
    }
  }

  const courseWideFiles = files.filter((f) => !f.folderPageId);
  const hasSessionContent = sessionMaterialMap.size > 0;
  const hasCourseWideContent =
    courseWideLeaves.length > 0 || courseWideFolders.length > 0 || courseWideFiles.length > 0;

  if (!hasCourseWideContent && !hasSessionContent) {
    return <p className="text-sm text-muted-foreground italic">No materials uploaded yet.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {hasCourseWideContent && (
        <section>
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Course-wide
          </h2>
          <div className="flex flex-col gap-2">
            {courseWideFolders.map((folder) => (
              <div key={folder.id} className="rounded-lg border border-border bg-card p-3">
                <p className="text-xs font-semibold text-muted-foreground mb-2">
                  📁 {folder.title}
                </p>
                <div className="flex flex-col gap-1 pl-2">
                  {folder.children.filter((c) => !c.sessionId).map((c) => (
                    <Link
                      key={c.id}
                      to={`${basePath}/page/${c.id}`}
                      className="inline-flex items-center gap-2 text-sm text-foreground hover:text-accent-coral"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      {c.title}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            {courseWideLeaves.map((m) => (
              <Link
                key={m.id}
                to={`${basePath}/page/${m.id}`}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 hover:border-accent-coral/50 hover:bg-muted/40 transition-colors"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-coral/10 text-accent-coral">
                  <FileText className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {m.title}
                </span>
              </Link>
            ))}
            {courseWideFiles.map((f) => (
              <a
                key={f.id}
                href={f.href ?? "#"}
                download
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 hover:border-accent-teal/50 hover:bg-muted/40 transition-colors"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-teal/10 text-accent-teal">
                  <Download className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {f.title}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {hasSessionContent && (
        <section>
          <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            By session
          </h2>
          <div className="flex flex-col gap-3">
            {sessions.map((s) => {
              const pages = sessionMaterialMap.get(s.id);
              if (!pages || pages.length === 0) return null;
              return (
                <div key={s.id} className="rounded-lg border border-border bg-card p-4">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">
                    Session {s.sequence}{s.title ? ` · ${s.title}` : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {pages.map((p) => (
                      <Link
                        key={p.pageId}
                        to={`${basePath}/page/${p.pageId}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-sm text-foreground hover:border-accent-coral/50 hover:text-accent-coral transition-colors"
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        {p.title}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// About pane
// ---------------------------------------------------------------------------

function AboutPane({
  data,
  basePath,
}: {
  data: HubData;
  basePath: string;
}) {
  const cp = data.certificateProgress;

  return (
    <div className="flex flex-col gap-5">
      {cp && (
        <section className="rounded-lg border border-yellow-300/40 bg-yellow-300/10 p-4">
          <p className="text-xs font-semibold text-yellow-700 mb-1">Certificate</p>
          {data.myCertificateId ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-foreground">🎓 You completed this course!</p>
              <a
                href={`/education/certificates/${data.myCertificateId}`}
                className={buttonClasses("primary", "sm") + " shrink-0"}
              >
                View certificate
              </a>
            </div>
          ) : (
            <p className="text-sm text-foreground">
              {cp.eligible
                ? "Certificate earned — it's being prepared."
                : `On track — ${cp.attended} of ${cp.total} attended${
                    cp.sessionsNeeded > 0 ? `, ${cp.sessionsNeeded} more needed` : ""
                  }.`}
            </p>
          )}
        </section>
      )}

      {data.myFeedback && (
        <section className="rounded-lg border border-accent-teal/30 bg-accent-teal/5 p-4">
          <p className="text-xs font-semibold text-accent-teal mb-1">
            Instructor feedback
            {data.myFeedback.authorName ? ` · ${data.myFeedback.authorName}` : ""}
          </p>
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {data.myFeedback.feedback}
          </p>
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          About this course
        </h2>
        {data.offering.descriptionHtml ? (
          <div
            className="prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: data.offering.descriptionHtml }}
          />
        ) : (
          <p className="text-sm text-muted-foreground italic">No description yet.</p>
        )}

        {data.instructors.length > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2">
              {data.instructors.length === 1 ? "Instructor" : "Instructors"}
            </p>
            <ul className="flex flex-wrap gap-2">
              {data.instructors.map((i) => (
                <li
                  key={i.id}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1"
                >
                  <Avatar photoUrl={i.photoUrl} name={i.name} size="xs" />
                  <span className="text-sm text-foreground">{i.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.classmates.length > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2">
              Classmates · {data.classmates.length}
            </p>
            <ul className="flex flex-wrap gap-2">
              {data.classmates.map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md border px-2 py-1",
                    c.isMe ? "border-accent-coral/30 bg-accent-coral/5" : "border-border bg-card",
                  )}
                >
                  <Avatar photoUrl={c.photoUrl} name={c.name} size="xs" />
                  <span className="text-sm text-foreground">{c.name}</span>
                  {c.isMe && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-accent-coral">
                      You
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Talk pane
// ---------------------------------------------------------------------------

function TalkPane({ data, tz }: { data: HubData; tz: string }) {
  return (
    <div className="flex flex-col gap-5">
      {data.announcements.length > 0 && (
        <section>
          <h2 className="mb-2 font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Announcements
          </h2>
          <ul className="flex flex-col gap-2">
            {data.announcements.map((a) => (
              <li key={a.id} className="rounded-lg border border-accent-coral/30 bg-accent-coral/5 p-4">
                <p className="text-xs text-muted-foreground">
                  {a.author.firstName} {a.author.lastName}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{a.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <DiscussionBoard
        threads={data.threads}
        currentUserId={data.currentUserId}
        isManager={data.isManager}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Journey data helpers
// ---------------------------------------------------------------------------

function toJourneyStops(data: HubData): JourneyStop[] {
  return data.sessions.map((s) => {
    const hasMaterials = data.materials.some(
      (m) => m.sessionId === s.id || m.children.some((c) => c.sessionId === s.id),
    );
    const hasAssignments = data.assignments.some((a) => a.sessionSequence === s.sequence);
    return {
      id: s.id,
      sequence: s.sequence,
      title: s.title,
      datetime: s.datetime,
      endsAt: s.endsAt,
      location: s.location,
      myAttendance: s.myAttendance,
      checkInOpen: s.checkInOpen,
      hasMaterials,
      hasAssignments,
      hasRecording: !!s.recordingUrl,
    };
  });
}

function toCertificateNode(data: HubData): CertificateNode {
  if (!data.certificateProgress) return null;
  if (data.myCertificateId) return { kind: "unlocked", certificateId: data.myCertificateId };
  const cp = data.certificateProgress;
  if (cp.eligible || cp.sessionsNeeded === 0) return { kind: "onTrack" };
  return { kind: "needsMore", sessionsNeeded: cp.sessionsNeeded };
}

// ---------------------------------------------------------------------------
// Education Drive tab — embedded DriveBrowser locked to the offering's scope.
// Mirrors ProjectDriveTab in projects.$id.tsx but targets education endpoints.
// Managers (isEditing) get full create/upload/delete; students get browse-only.
// ---------------------------------------------------------------------------

type EduDriveTypeFilter = "all" | "doc" | "file";
const EDU_TYPE_FILTERS: { value: EduDriveTypeFilter; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "doc", label: "Documents" },
  { value: "file", label: "Files" },
];

function folderSubtree(items: DriveItem[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const it of items) {
    if (!it.parentFolderId) continue;
    const arr = childrenOf.get(it.parentFolderId) ?? [];
    arr.push(it.id);
    childrenOf.set(it.parentFolderId, arr);
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of childrenOf.get(cur) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}

function EducationDriveTab({
  offeringId,
  offeringDriveScope,
  canEdit,
}: {
  offeringId: string;
  offeringDriveScope: DriveTreeScope;
  canEdit: boolean;
}) {
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const dialog = useDialog();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<EduDriveTypeFilter>("all");
  const scopeId = offeringDriveScope.id;
  const revalidate = useCallback(() => revalidator.revalidate(), [revalidator]);

  // File upload: education offerings have their own endpoint (manager-only).
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const uploadFiles = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return;
      setUploading(true);
      setUploadError(null);
      try {
        for (const file of files) {
          const key = `drive-files/${crypto.randomUUID()}-${file.name}`;
          const presignRes = await fetch("/api/upload/presign", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key,
              contentType: file.type || "application/octet-stream",
              contentLength: file.size,
            }),
          });
          if (!presignRes.ok) {
            const b = (await presignRes.json().catch(() => ({}))) as { error?: string };
            throw new Error(b.error ?? "Failed to get upload URL");
          }
          const { url, fields, key: s3Key } = (await presignRes.json()) as {
            url: string;
            fields: Record<string, string>;
            key: string;
          };
          const fd = new FormData();
          for (const [name, value] of Object.entries(fields)) fd.append(name, value);
          fd.append("file", file);
          const uploadRes = await fetch(url, { method: "POST", body: fd });
          if (!uploadRes.ok) throw new Error("Upload to storage failed");
          const registerRes = await fetch(`/api/education/${offeringId}/files`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: file.name,
              s3Key,
              fileName: file.name,
              contentType: file.type || "application/octet-stream",
              sizeBytes: file.size,
              ...(currentFolderId ? { folderPageId: currentFolderId } : {}),
            }),
          });
          if (!registerRes.ok) {
            const b = (await registerRes.json().catch(() => ({}))) as { error?: string };
            throw new Error(b.error ?? "Failed to register file");
          }
        }
        revalidate();
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [offeringId, currentFolderId, revalidate],
  );

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    await uploadFiles(files);
  }

  // Move-destination picker.
  const [movePicker, setMovePicker] = useState<{
    heading: string;
    drives: PickerDrive[];
    folders: PickerFolder[];
    disabledFolderIds?: Set<string>;
    disabledDest?: Destination;
    initial?: Destination;
  } | null>(null);
  const movePickerResolve = useRef<((d: Destination | null) => void) | null>(null);
  const resolveMovePicker = useCallback((d: Destination | null) => {
    setMovePicker(null);
    movePickerResolve.current?.(d);
    movePickerResolve.current = null;
  }, []);

  const onNavigate = useCallback(
    (_scopeId: string | null, folderId: string | null) => {
      setCurrentFolderId(folderId);
    },
    [],
  );

  const onOpenItem = useCallback(
    (item: DriveItem) => {
      if (item.href) navigate(item.href);
    },
    [navigate],
  );

  const onMove = useCallback(
    async (_scopeId: string, item: DriveItem, destFolderId: string | null) => {
      try {
        const res = await moveDriveItem(item, destFolderId);
        if (!res.ok) {
          toast.error((await driveErrorFrom(res)) ?? "Couldn't move");
          return;
        }
        revalidator.revalidate();
      } catch {
        toast.error("Couldn't move");
      }
    },
    [revalidator, toast],
  );

  const pickMoveDestination = useCallback(
    (item: DriveItem, heading: string): Promise<Destination | null> => {
      const rootId = offeringDriveScope.rootFolderId ?? null;
      const drives: PickerDrive[] = [
        { id: scopeId, label: offeringDriveScope.label, iconEmoji: offeringDriveScope.iconEmoji },
      ];
      const folders: PickerFolder[] = offeringDriveScope.items
        .filter((f) => f.type === "folder")
        .map((f) => ({
          id: f.id,
          driveId: scopeId,
          parentId: (f.parentFolderId ?? null) === rootId ? null : f.parentFolderId,
          title: f.title,
          iconEmoji: f.iconEmoji,
        }));
      const banned =
        item.type === "folder" ? folderSubtree(offeringDriveScope.items, item.id) : undefined;
      const currentFolder =
        (item.parentFolderId ?? null) === rootId ? null : (item.parentFolderId ?? null);
      const currentDest: Destination = { driveId: scopeId, folderId: currentFolder };
      return new Promise<Destination | null>((resolve) => {
        movePickerResolve.current = resolve;
        setMovePicker({
          heading,
          drives,
          folders,
          disabledFolderIds: banned,
          disabledDest: currentDest,
          initial: currentDest,
        });
      });
    },
    [scopeId, offeringDriveScope],
  );

  const getScopeActions = useCallback(
    (_scopeId: string): RowActions => ({
      onRename: async (item) => {
        const next = await dialog.prompt({
          title: "Rename",
          label: "Name",
          defaultValue: item.title || "",
          confirmLabel: "Save",
          validate: (v) => (v.trim() ? null : "Enter a name"),
        });
        if (next === null) return;
        const title = next.trim();
        if (title === item.title) return;
        const isFile = item.type === "file";
        const res = isFile
          ? await fetch(`/api/files/${item.id}`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ intent: "rename", title }),
            })
          : await fetch(`/api/documents/${item.id}`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title }),
            });
        if (res.ok) revalidate();
        else toast.error("Couldn't rename");
      },
      onRequestMove: async (item) => {
        const dest = await pickMoveDestination(item, `Move "${item.title || "Untitled"}"`);
        if (dest) await onMove(scopeId, item, dest.folderId);
      },
      onDelete: async (item) => {
        const ok = await dialog.confirm({
          title: `Delete "${item.title || "this item"}"?`,
          description:
            item.type === "folder" ? "The folder must be empty first." : "This moves it to the trash.",
          tone: "destructive",
          confirmLabel: "Delete",
        });
        if (!ok) return;
        const isFile = item.type === "file";
        const endpoint = isFile ? `/api/files/${item.id}` : `/api/documents/${item.id}`;
        const res = await fetch(endpoint, { method: "DELETE", credentials: "include" });
        if (res.ok) revalidate();
        else toast.error("Couldn't delete");
      },
    }),
    [dialog, toast, revalidate, pickMoveDestination, onMove, scopeId],
  );

  const onToggleFavorite = useCallback(
    async (item: DriveItem) => {
      if (item.type !== "doc" && item.type !== "folder") return;
      await fetch(`/api/pages/${item.id}/favorite`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorited: !item.favorited }),
      });
      revalidate();
    },
    [revalidate],
  );

  const createPage = useCallback(
    async (kind: "FreeForm" | "Folder", title: string): Promise<string | null> => {
      const res = await fetch(`/api/education/${offeringId}/documents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, kind, ...(currentFolderId ? { parentPageId: currentFolderId } : {}) }),
      });
      if (!res.ok) return null;
      return ((await res.json()) as { id: string }).id;
    },
    [offeringId, currentFolderId],
  );

  const createDoc = useCallback(async () => {
    const name = await dialog.prompt({
      title: "New document",
      label: "Name",
      defaultValue: "Untitled",
      confirmLabel: "Create",
      validate: (v) => (v.trim() ? null : "Enter a name"),
    });
    if (name === null) return;
    const id = await createPage("FreeForm", name.trim());
    if (id) navigate(`/documents/${id}`);
    else toast.error("Couldn't create the document");
  }, [dialog, createPage, navigate, toast]);

  const createFolder = useCallback(async () => {
    const name = await dialog.prompt({
      title: "New folder",
      label: "Folder name",
      defaultValue: "New folder",
      confirmLabel: "Create",
      validate: (v) => (v.trim() ? null : "Enter a name"),
    });
    if (name === null) return;
    const id = await createPage("Folder", name.trim());
    if (id) {
      toast.success("Folder created");
      revalidate();
    } else {
      toast.error("Couldn't create the folder");
    }
  }, [dialog, createPage, revalidate, toast]);

  const onBulkDelete = useCallback(
    async (items: DriveItem[]) => {
      if (items.length === 0) return;
      const ok = await dialog.confirm({
        title: `Delete ${items.length} item${items.length === 1 ? "" : "s"}?`,
        description: "Folders must be empty first.",
        tone: "destructive",
        confirmLabel: "Delete",
      });
      if (!ok) return;
      let fail = 0;
      for (const it of items) {
        const endpoint = it.type === "file" ? `/api/files/${it.id}` : `/api/documents/${it.id}`;
        const res = await fetch(endpoint, { method: "DELETE", credentials: "include" });
        if (!res.ok) fail++;
      }
      revalidate();
      if (fail) toast.error(`${fail} item${fail === 1 ? "" : "s"} couldn't be deleted`);
      else toast.success(`Deleted ${items.length}`);
    },
    [dialog, toast, revalidate],
  );

  const onBulkMove = useCallback(
    async (items: DriveItem[]) => {
      const movable = items.filter(
        (i) => i.type === "doc" || i.type === "folder" || i.type === "file",
      );
      if (movable.length === 0) return;
      const dest = await pickMoveDestination(
        movable[0],
        `Move ${movable.length} item${movable.length === 1 ? "" : "s"}`,
      );
      if (!dest) return;
      for (const it of movable) await onMove(scopeId, it, dest.folderId);
      revalidate();
    },
    [pickMoveDestination, onMove, scopeId, revalidate],
  );

  const filterControl = (
    <div>
      <Select<EduDriveTypeFilter>
        value={typeFilter}
        onChange={setTypeFilter}
        ariaLabel="Filter by type"
        align="right"
        options={EDU_TYPE_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
        buttonClassName={cn(filterPillClass(), "w-full sm:w-40")}
      />
    </div>
  );

  const newMenu = canEdit ? (
    <Menu
      align="right"
      ariaLabel="New in this course"
      trigger={
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md bg-accent-coral px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-coral/90 transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" /> New
          <ChevronDown className="w-3.5 h-3.5 opacity-80" />
        </button>
      }
    >
      <Menu.Item icon={<FileText className="w-3.5 h-3.5" />} onSelect={() => void createDoc()}>
        New document
      </Menu.Item>
      <Menu.Item
        icon={<FolderPlus className="w-3.5 h-3.5" />}
        onSelect={() => void createFolder()}
      >
        New folder
      </Menu.Item>
      <Menu.Separator />
      <Menu.Item
        icon={<Upload className="w-3.5 h-3.5" />}
        disabled={uploading}
        onSelect={() => uploadInputRef.current?.click()}
      >
        {uploading ? "Uploading…" : "Upload file"}
      </Menu.Item>
    </Menu>
  ) : undefined;

  // useMemo to stabilise the typeFilter cast for DriveBrowser's prop type.
  const driveTypeFilter = useMemo(
    () => typeFilter as "all" | "doc" | "file" | "form" | "agreement" | "emailTemplate" | "rubric",
    [typeFilter],
  );

  return (
    <>
      {uploadError && (
        <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-sm text-destructive">
          {uploadError}
        </div>
      )}
      <DriveBrowser
        scopes={[offeringDriveScope]}
        currentScopeId={scopeId}
        currentFolderId={currentFolderId}
        typeFilter={driveTypeFilter}
        search={search}
        onSearchChange={setSearch}
        onNavigate={onNavigate}
        onOpenItem={onOpenItem}
        onMove={onMove}
        getScopeActions={getScopeActions}
        onToggleFavorite={onToggleFavorite}
        onBulkDelete={canEdit ? onBulkDelete : undefined}
        onBulkMove={canEdit ? onBulkMove : undefined}
        onUploadFiles={canEdit ? uploadFiles : undefined}
        filterControl={filterControl}
        newMenu={newMenu}
        embeddedScopeId={scopeId}
      />
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        hidden
        onChange={handleFileChange}
      />
      {movePicker && (
        <DestinationPicker
          open
          heading={movePicker.heading}
          drives={movePicker.drives}
          folders={movePicker.folders}
          disabledFolderIds={movePicker.disabledFolderIds}
          disabledDest={movePicker.disabledDest}
          initial={movePicker.initial}
          onClose={() => resolveMovePicker(null)}
          onConfirm={(dest) => resolveMovePicker(dest)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main CourseHubV2
// ---------------------------------------------------------------------------

export function CourseHubV2({
  data,
  basePath,
  collabToken,
  isMemberShell,
  instructor = null,
  rosterForSession = null,
  previewAsStudent = false,
  offeringDriveScope,
}: {
  data: HubData;
  basePath: string;
  collabToken?: string | null;
  isMemberShell: boolean;
  instructor?: InstructorExtras | null;
  rosterForSession?: SessionRoster;
  previewAsStudent?: boolean;
  /** When present (member shell only), renders the Files tab as an embedded
   *  DriveBrowser. When absent (portal), falls back to the read-only list. */
  offeringDriveScope?: DriveTreeScope;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tz = useUserTimeZone();

  const rawTab = searchParams.get("tab");
  const hasWorkspace = data.workspaceDocs.length > 0;
  const activeTab = resolveTab(rawTab, hasWorkspace);

  function setTab(key: TabKey) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", key);
        return next;
      },
      { preventScrollReset: true },
    );
  }

  const openAssignments = data.isManager
    ? 0
    : data.assignments.filter(
        (a) => !a.mySubmittedAt && (!a.dueAt || new Date(a.dueAt) > new Date()),
      ).length;

  const tabs: { key: TabKey; label: string; badge?: number }[] = [
    { key: "journey", label: "Journey", badge: openAssignments > 0 ? openAssignments : undefined },
    { key: "grades", label: "Grades" },
    { key: "discussions", label: "Discussions" },
    { key: "files", label: "Files" },
    ...(hasWorkspace ? [{ key: "workspace" as TabKey, label: "Workspace" }] : []),
    { key: "about", label: "About" },
  ];

  const stops = toJourneyStops(data);
  const certificate = toCertificateNode(data);

  // Default selected: find current stop
  const now = Date.now();
  const currentStop =
    stops.find(
      (s) =>
        now >= new Date(s.datetime).getTime() &&
        now <= (s.endsAt ? new Date(s.endsAt).getTime() : new Date(s.datetime).getTime()),
    ) ??
    stops
      .filter((s) => new Date(s.datetime).getTime() > now)
      .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())[0] ??
    stops[stops.length - 1] ??
    null;

  // Instructor editing mode: instructor data present + not previewing as student
  const isEditing = !!instructor && !previewAsStudent;

  // Editing keeps the selected stop in ?session= so the loader can ship the
  // matching mark-by-hand roster; the student lens stays client-state only.
  const sessionParam = searchParams.get("session");
  const [selectedId, setSelectedId] = useState<string | null>(
    (isEditing && sessionParam) || (currentStop?.id ?? null),
  );

  function selectStop(id: string | null) {
    setSelectedId(id);
    if (isEditing && id) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("session", id);
          return next;
        },
        { preventScrollReset: true },
      );
    }
  }

  const selectedStop = stops.find((s) => s.id === selectedId) ?? null;
  const selectedSession = selectedStop ? data.sessions.find((s) => s.id === selectedId) ?? null : null;

  // Only hand the pane a roster that belongs to the selected session — after a
  // selection change the loader briefly still has the previous session's marks.
  const rosterForSelected =
    rosterForSession &&
    (rosterForSession.session as { id?: string } | null)?.id === selectedId
      ? rosterForSession
      : null;

  const bleed = isMemberShell ? "-mx-5 sm:-mx-10 lg:-mx-16" : "";
  const bandContent = isMemberShell
    ? "px-5 sm:px-10 lg:px-16 py-8"
    : "mx-auto max-w-5xl px-4 sm:px-6 py-8";

  const files = data.files ?? [];

  const threshold = data.offering.completionThreshold ?? 80;

  return (
    <div className="flex flex-col gap-0">
      {/* ── Header row ──────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {data.offering.title}
          </h1>
          {/* Draft chip */}
          {isEditing && instructor.offeringStatus === "Draft" && (
            <Link
              to={`${basePath}/setup`}
              className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-xs font-semibold text-amber-600 hover:bg-amber-400/20 transition-colors"
            >
              Draft — finish in Setup
            </Link>
          )}
        </div>

        {isEditing ? (
          /* Instructor editing controls */
          <div className="flex flex-wrap items-center gap-2">
            <InstructorModeToggle basePath={basePath} />
            <Link
              to={`${basePath}/people`}
              className={cn(buttonClasses("secondary", "sm"), "relative")}
            >
              People
              {instructor.applicationCounts.submitted > 0 && (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold min-w-4 h-4 px-1">
                  {instructor.applicationCounts.submitted}
                </span>
              )}
            </Link>
            <Link
              to={`${basePath}/setup`}
              className={buttonClasses("secondary", "sm")}
            >
              Setup
            </Link>
          </div>
        ) : data.isManager ? (
          /* Student preview or plain manager view */
          <div className="flex items-center gap-2">
            <Link
              to={`${basePath}/hub?as=student`}
              className={buttonClasses("ghost", "sm")}
            >
              View as student
            </Link>
            {isMemberShell && (
              <Link
                to={`/education/manage/${data.offering.id}`}
                className={buttonClasses("secondary", "sm")}
              >
                Manage
              </Link>
            )}
          </div>
        ) : null}
      </header>

      {/* ── Pill nav ─────────────────────────────────────────── */}
      <div className="mb-5">
        <PillNav tabs={tabs} activeKey={activeTab} onSelect={setTab} />
      </div>

      {/* ── Journey tab ──────────────────────────────────────── */}
      {activeTab === "journey" && (
        <div className="flex flex-col gap-0">
          <EduBand bleedClassName={bleed} contentClassName={bandContent}>
            {isEditing ? (
              <JourneyEditingLayer
                stops={stops}
                certificate={certificate}
                selectedId={selectedId}
                onSelect={selectStop}
                tz={tz}
                presentBySession={instructor.presentBySession}
                approvedCount={instructor.approvedCount}
                willEarnCount={instructor.willEarnCount}
                threshold={threshold}
                bleedClassName={bleed}
                contentClassName={bandContent}
              />
            ) : (
              <JourneyBand
                stops={stops}
                certificate={certificate}
                selectedId={selectedId}
                onSelect={selectStop}
                lens="student"
                tz={tz}
              />
            )}
          </EduBand>

          <div className="mt-5">
            {selectedSession ? (
              <SessionPane
                session={selectedSession}
                materials={data.materials}
                files={files}
                assignments={data.assignments}
                basePath={basePath}
                tz={tz}
                isManager={data.isManager}
                extras={
                  isEditing ? (
                    <SessionPaneInstructor
                      session={selectedSession}
                      offeringId={data.offering.id}
                      basePath={basePath}
                      tz={tz}
                      rosterForSession={rosterForSelected}
                    />
                  ) : undefined
                }
              />
            ) : stops.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                No sessions scheduled yet.
              </p>
            ) : null}
          </div>
        </div>
      )}

      {activeTab === "grades" && (
        <GradesTab
          sessions={data.sessions}
          assignments={data.assignments}
          myCertificateId={data.myCertificateId}
          tz={tz}
        />
      )}

      {activeTab === "discussions" && <TalkPane data={data} tz={tz} />}

      {activeTab === "files" && (
        offeringDriveScope ? (
          <EducationDriveTab
            offeringId={data.offering.id}
            offeringDriveScope={offeringDriveScope}
            canEdit={isEditing}
          />
        ) : (
          <LibraryPane
            materials={data.materials}
            files={files}
            sessions={data.sessions}
            basePath={basePath}
          />
        )
      )}

      {activeTab === "workspace" && hasWorkspace && (
        <WorkspaceTab
          docs={data.workspaceDocs}
          collabToken={collabToken ?? null}
          userName={data.currentUserName}
        />
      )}

      {activeTab === "about" && <AboutPane data={data} basePath={basePath} />}
    </div>
  );
}
