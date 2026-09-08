import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { FileText, Download } from "lucide-react";
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

type TabKey = "journey" | "grades" | "talk" | "library" | "workspace" | "about";

const TAB_ALIASES: Record<string, TabKey> = {
  journey: "journey",
  grades: "grades",
  talk: "talk",
  library: "library",
  workspace: "workspace",
  about: "about",
  timeline: "journey",
  discussions: "talk",
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
}: {
  data: HubData;
  basePath: string;
  collabToken?: string | null;
  isMemberShell: boolean;
  instructor?: InstructorExtras | null;
  rosterForSession?: SessionRoster;
  previewAsStudent?: boolean;
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
    { key: "talk", label: "Talk" },
    { key: "library", label: "Library" },
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

      {activeTab === "talk" && <TalkPane data={data} tz={tz} />}

      {activeTab === "library" && (
        <LibraryPane
          materials={data.materials}
          files={files}
          sessions={data.sessions}
          basePath={basePath}
        />
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
