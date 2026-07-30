import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  CalendarClock,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  FileText,
  X,
} from "lucide-react";
import { termCodeLabel } from "~/lib/display";
import { formatBytes } from "~/lib/upload-client";
import { Avatar } from "~/components/ui/Avatar";
import { Markdown } from "~/components/Markdown";
import { Modal } from "~/components/Modal";
import { CommentsRail } from "~/components/collab/CommentsRail";
import { PartnerBackLink } from "~/partners/components/PartnerBackLink";
import { PartnerWeekCalendar } from "~/partners/components/PartnerWeekCalendar";
import { ProjectCoverImage } from "~/projects/components/ProjectCoverImage";
import { ProjectIcon } from "~/components/ProjectIcon";
import type {
  PartnerActivityKind,
  PartnerProjectArea,
  PartnerProjectViewData,
} from "~/partners/lib/partner-project-view.server";

type SharedFile = PartnerProjectViewData["sharedFiles"][number];

// Types the browser can render inline (image/pdf/text). Everything else is
// download-only, so the row offers Download rather than Preview.
function isPreviewable(contentType: string | null): boolean {
  const ct = contentType ?? "";
  return (
    ct.startsWith("image/") ||
    ct === "application/pdf" ||
    ct.startsWith("text/") ||
    ct === "application/json"
  );
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// Shared surface tokens so every tab panel reads the same.
const PANEL_HEADING = "font-heading text-lg font-semibold text-dark-blue";
const CARD = "bg-card border border-border rounded-2xl";
const EMPTY_CARD =
  "bg-card border border-border rounded-2xl p-6 text-sm text-muted-foreground";

const PARTNER_TABS = [
  { id: "overview", label: "Overview" },
  { id: "progress", label: "Progress" },
  { id: "deliverables", label: "Deliverables" },
  { id: "meetings", label: "Meetings" },
  { id: "team", label: "Team" },
] as const;
type PartnerTabId = (typeof PARTNER_TABS)[number]["id"];

// Plain-language presentation for an area's state — no agile vocabulary.
const AREA_STATE: Record<
  PartnerProjectArea["state"],
  { label: string; pill: string; bar: string }
> = {
  "in-progress": {
    label: "In progress",
    pill: "bg-accent-coral/10 text-accent-coral",
    bar: "bg-accent-coral",
  },
  done: {
    label: "Done",
    pill: "bg-accent-teal/15 text-accent-teal",
    bar: "bg-accent-teal",
  },
  upcoming: {
    label: "Coming up",
    pill: "bg-muted text-muted-foreground",
    bar: "bg-muted-foreground/30",
  },
};

// Project identity + a plain progress line ("About 42% complete"). No sprint
// counts or health verdict — just how much of the work is done.
function ProjectHeader({
  project,
  partnerSince,
  progress,
  backLink,
}: {
  project: PartnerProjectViewData["project"];
  partnerSince: string | null;
  progress: PartnerProjectViewData["progress"];
  backLink?: { to: string; label: string };
}) {
  const pct =
    progress.overallTotal > 0
      ? Math.round((progress.overallDone / progress.overallTotal) * 100)
      : 0;
  const meta = [
    project.terms.length > 0
      ? `Terms: ${project.terms.map(termCodeLabel).join(", ")}`
      : null,
    partnerSince ? `Partner since ${fmtDate(partnerSince)}` : null,
  ].filter(Boolean);
  return (
    <div>
      {backLink && <PartnerBackLink to={backLink.to} label={backLink.label} />}
      <div className={`${CARD} overflow-hidden ${backLink ? "mt-2" : ""}`}>
        <ProjectCoverImage
          name={project.name}
          imageUrl={project.imageUrl}
          className="w-full h-40 object-cover"
          placeholderClassName="w-full h-40"
        />
        <div className="p-5">
          <h1 className="flex items-center gap-2 font-heading text-3xl font-bold text-dark-blue">
            <ProjectIcon iconEmoji={project.iconEmoji} size="lg" />
            <span className="min-w-0 truncate">{project.name}</span>
          </h1>
          {meta.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1">{meta.join(" · ")}</p>
          )}
          <div className="mt-3 max-w-md">
            <p className="text-sm font-medium text-dark-blue">
              {progress.overallTotal > 0 ? `About ${pct}% complete` : "Getting started"}
            </p>
            {progress.overallTotal > 0 && (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-accent-teal"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// The project workspace's section tabs. Client-side tab state lives in the
// `?tab=` search param so each section has a shareable, back-navigable URL
// without a loader round-trip (all the data is already client-side).
function TabBar({
  active,
  onSelect,
}: {
  active: PartnerTabId;
  onSelect: (id: PartnerTabId) => void;
}) {
  return (
    <div className="border-b border-border">
      <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Project sections">
        {PARTNER_TABS.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              aria-current={isActive ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                isActive
                  ? "border-accent-coral text-accent-coral"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// Renders the partner-facing read surface for a project as a tabbed workspace,
// written for a busy, non-technical audience: a plain status header, then
// Overview / Progress / Deliverables / Meetings / Team. Shared by the real
// partner portal (partner.projects.$id.tsx) and the in-app preview any
// signed-in member can open from the project page
// (projects.$id.partner-view.tsx) — same content, different chrome via
// `backLink`, and `pageHref` for shared-document links.
export function PartnerProjectHubView({
  data,
  currentUserId,
  backLink,
  pageHref,
  canRsvp = false,
}: {
  data: PartnerProjectViewData;
  currentUserId: string;
  backLink?: { to: string; label: string };
  pageHref: (pageId: string) => string;
  // Whether the RSVP controls are live (real portal only).
  canRsvp?: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("tab");
  const active: PartnerTabId = PARTNER_TABS.some((t) => t.id === raw)
    ? (raw as PartnerTabId)
    : "overview";
  const selectTab = (id: PartnerTabId) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id === "overview") next.delete("tab");
        else next.set("tab", id);
        return next;
      },
      { preventScrollReset: true },
    );

  return (
    <div className="flex flex-col gap-6">
      <ProjectHeader
        project={data.project}
        partnerSince={data.partnerSince}
        progress={data.progress}
        backLink={backLink}
      />
      <TabBar active={active} onSelect={selectTab} />

      {active === "overview" && (
        <OverviewPanel data={data} pageHref={pageHref} onNavigate={selectTab} />
      )}
      {active === "progress" && <ProgressPanel areas={data.areas} />}
      {active === "deliverables" && (
        <DeliverablesPanel
          links={data.links}
          sharedPages={data.sharedPages}
          sharedFiles={data.sharedFiles}
          pageHref={pageHref}
          currentUserId={currentUserId}
        />
      )}
      {active === "meetings" && (
        <MeetingsPanel
          meetings={data.meetings}
          pageHref={pageHref}
          canRsvp={canRsvp}
          teamContact={data.teamContact}
          projectName={data.project.name}
        />
      )}
      {active === "team" && (
        <TeamPanel team={data.team} currentTermCode={data.currentTermCode} />
      )}
    </div>
  );
}

// The default landing — answers "how's my project going" plainly: overall
// progress, what the team is on now, what's been delivered (proof of work),
// what's next, and recent updates.
function OverviewPanel({
  data,
  pageHref,
  onNavigate,
}: {
  data: PartnerProjectViewData;
  pageHref: (pageId: string) => string;
  onNavigate: (id: PartnerTabId) => void;
}) {
  const {
    project,
    progress,
    currentFocus,
    meetings,
    activity,
    links,
    sharedPages,
    sharedFiles,
  } = data;
  const nextMeeting = meetings[0] ?? null;
  const pct =
    progress.overallTotal > 0
      ? Math.round((progress.overallDone / progress.overallTotal) * 100)
      : 0;
  const newCount = activity.filter((a) => a.isNew).length;
  const deliverableCount = links.length + sharedPages.length + sharedFiles.length;

  return (
    <div className="flex flex-col gap-6">
      {project.description && (
        <div className={`${CARD} p-5`}>
          <Markdown>{project.description}</Markdown>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* How it's going */}
        <div className={`${CARD} p-5`}>
          <h3 className={`${PANEL_HEADING} mb-3`}>How it's going</h3>
          {progress.overallTotal > 0 ? (
            <div>
              <div className="flex items-baseline justify-between">
                <span className="font-heading text-2xl font-bold text-dark-blue">
                  {pct}%
                </span>
                <span className="text-xs text-muted-foreground">complete</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-accent-teal"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              The team is getting set up — progress will show here soon.
            </p>
          )}
          {currentFocus && (
            <p className="mt-3 text-sm text-muted-foreground">
              <span className="font-medium text-dark-blue">Working on now:</span>{" "}
              {currentFocus}
            </p>
          )}
          <button
            type="button"
            onClick={() => onNavigate("progress")}
            className="mt-3 text-xs font-medium text-accent-coral hover:underline"
          >
            See what we're building →
          </button>
        </div>

        {/* What's next */}
        <div className={`${CARD} p-5`}>
          <h3 className={`${PANEL_HEADING} mb-3`}>What's next</h3>
          {nextMeeting ? (
            <button
              type="button"
              onClick={() => onNavigate("meetings")}
              className="flex w-full items-start gap-3 rounded-xl border border-border p-3 text-left transition hover:border-accent-coral"
            >
              <CalendarClock className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent-coral" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">
                  {nextMeeting.title}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {fmtDateTime(nextMeeting.start)}
                </span>
              </span>
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">
              No meetings scheduled right now. The team will set one up when
              there's something to review together.
            </p>
          )}
        </div>
      </div>

      {/* Recently delivered — proof of work, tied right to the progress above. */}
      <div className={`${CARD} p-5`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className={PANEL_HEADING}>Recently delivered</h3>
          {deliverableCount > 0 && (
            <button
              type="button"
              onClick={() => onNavigate("deliverables")}
              className="flex-shrink-0 text-xs font-medium text-accent-coral hover:underline"
            >
              See all →
            </button>
          )}
        </div>
        {deliverableCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing shared yet. Documents, files, and links from the team will
            show up here as the work progresses.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {links.slice(0, 2).map((l) => (
              <li key={`l-${l.id}`}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 py-2 text-sm transition hover:text-accent-coral"
                >
                  <ExternalLink className="h-4 w-4 flex-shrink-0 text-accent-teal" />
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {l.label}
                  </span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground">Link</span>
                </a>
              </li>
            ))}
            {sharedPages.slice(0, 2).map((p) => (
              <li key={`p-${p.id}`}>
                <Link
                  to={pageHref(p.id)}
                  className="flex items-center gap-3 py-2 text-sm transition hover:text-accent-coral"
                >
                  <span>{p.iconEmoji ?? "📄"}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {p.title}
                  </span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground">
                    {fmtDate(p.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
            {sharedFiles.slice(0, 2).map((f) => (
              <li key={`f-${f.id}`}>
                <button
                  type="button"
                  onClick={() => onNavigate("deliverables")}
                  className="flex w-full items-center gap-3 py-2 text-left text-sm transition hover:text-accent-coral"
                >
                  <FileText className="h-4 w-4 flex-shrink-0 text-accent-teal" />
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {f.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* What's new — the reason to come back: updates since the last visit. */}
      <div className={`${CARD} p-5`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className={PANEL_HEADING}>What's new</h3>
          {newCount > 0 && (
            <span className="flex-shrink-0 rounded-full bg-accent-coral/10 px-2 py-0.5 text-xs font-medium text-accent-coral">
              {newCount} new
            </span>
          )}
        </div>
        <ActivityFeed activity={activity} />
      </div>
    </div>
  );
}

// "What we're building" — the plan in plain terms. Each area of work shows a
// coarse state (In progress / Done / Coming up) and how far along it is. No
// sprints, stories, priorities, or acceptance criteria.
function ProgressPanel({ areas }: { areas: PartnerProjectArea[] }) {
  return (
    <section>
      <h2 className={`${PANEL_HEADING} mb-3`}>What we're building</h2>
      {areas.length === 0 ? (
        <div className={EMPTY_CARD}>
          The team will share the plan here as the work gets underway.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {areas.map((area) => {
            const s = AREA_STATE[area.state];
            const pct =
              area.total > 0 ? Math.round((area.done / area.total) * 100) : 0;
            return (
              <div key={area.id} className={`${CARD} p-5`}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="min-w-0 truncate font-heading text-base font-semibold text-dark-blue">
                    {area.title}
                  </h3>
                  <span
                    className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${s.pill}`}
                  >
                    {s.label}
                  </span>
                </div>
                {area.total > 0 && (
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {area.done} of {area.total} done
                      </span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${s.bar}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// The library — everything the team has shared as proof of work: documents and
// file uploads (previewed via a short-lived signed URL resolved in the loader).
function DeliverablesPanel({
  links,
  sharedPages,
  sharedFiles,
  pageHref,
  currentUserId,
}: {
  links: PartnerProjectViewData["links"];
  sharedPages: PartnerProjectViewData["sharedPages"];
  sharedFiles: PartnerProjectViewData["sharedFiles"];
  pageHref: (pageId: string) => string;
  currentUserId: string;
}) {
  const [previewFile, setPreviewFile] = useState<SharedFile | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {links.length > 0 && (
        <section>
          <h2 className={`${PANEL_HEADING} mb-3`}>Links</h2>
          <ul className={`${CARD} divide-y divide-border`}>
            {links.map((l) => (
              <li key={l.id}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-muted/20"
                >
                  <ExternalLink className="h-4 w-4 flex-shrink-0 text-accent-teal" />
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {l.label}
                  </span>
                  <span className="hidden max-w-[45%] flex-shrink-0 truncate text-xs text-muted-foreground sm:block">
                    {l.url.replace(/^https?:\/\//, "")}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className={`${PANEL_HEADING} mb-3`}>Documents</h2>
        {sharedPages.length === 0 ? (
          <div className={EMPTY_CARD}>
            The team hasn't shared any documents yet.
          </div>
        ) : (
          <ul className={`${CARD} divide-y divide-border`}>
            {sharedPages.map((p) => (
              <li key={p.id}>
                <Link
                  to={pageHref(p.id)}
                  className="flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-muted/20"
                >
                  <span>{p.iconEmoji ?? "📄"}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {p.title}
                  </span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground">
                    Updated {fmtDate(p.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className={`${PANEL_HEADING} mb-3`}>Files</h2>
        {sharedFiles.length === 0 ? (
          <div className={EMPTY_CARD}>The team hasn't shared any files yet.</div>
        ) : (
          <ul className={`${CARD} divide-y divide-border`}>
            {sharedFiles.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => setPreviewFile(f)}
                  disabled={!f.downloadUrl}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition ${
                    f.downloadUrl
                      ? "cursor-pointer hover:bg-muted/20"
                      : "cursor-not-allowed opacity-60"
                  }`}
                >
                  {isPreviewable(f.contentType) ? (
                    <Eye className="h-4 w-4 flex-shrink-0 text-accent-teal" />
                  ) : (
                    <Download className="h-4 w-4 flex-shrink-0 text-accent-teal" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">
                      {f.title}
                    </span>
                    {(f.fileName || f.sizeBytes != null) && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {[
                          f.fileName,
                          f.sizeBytes != null ? formatBytes(f.sizeBytes) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground">
                    {!f.downloadUrl
                      ? "Unavailable"
                      : isPreviewable(f.contentType)
                        ? "Preview"
                        : "Download"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {previewFile && (
        <SharedFilePreviewModal
          file={previewFile}
          currentUserId={currentUserId}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}

// Meetings tab: the week calendar (RSVP + notes in-place) and a direct line to
// the team when a partner wants to set something up.
function MeetingsPanel({
  meetings,
  pageHref,
  canRsvp,
  teamContact,
  projectName,
}: {
  meetings: PartnerProjectViewData["meetings"];
  pageHref: (pageId: string) => string;
  canRsvp: boolean;
  teamContact: PartnerProjectViewData["teamContact"];
  projectName: string;
}) {
  return (
    <section>
      <h2 className={`${PANEL_HEADING} mb-3`}>Meetings</h2>
      <PartnerWeekCalendar
        meetings={meetings}
        pageHref={pageHref}
        canRsvp={canRsvp}
      />
      <TeamContactPrompt contact={teamContact} projectName={projectName} />
    </section>
  );
}

// The current-term project roster.
function TeamPanel({
  team,
  currentTermCode,
}: {
  team: PartnerProjectViewData["team"];
  currentTermCode: string | null;
}) {
  return (
    <section>
      <h2 className={`${PANEL_HEADING} mb-3`}>
        Your DALI team
        {currentTermCode ? ` · ${termCodeLabel(currentTermCode)}` : ""}
      </h2>
      {team.length === 0 ? (
        <div className={EMPTY_CARD}>
          Your team will appear here once the project is staffed.
        </div>
      ) : (
        <div className={`${CARD} grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2`}>
          {team.map((m) => (
            <div key={m.name} className="flex min-w-0 items-center gap-3">
              <Avatar photoUrl={m.photoUrl} name={m.name} size="md" />
              <div className="min-w-0">
                <span className="block truncate font-medium text-dark-blue">
                  {m.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {m.domains.join(", ")}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const ACTIVITY_ICON: Record<PartnerActivityKind, typeof CheckCircle2> = {
  "task-done": CheckCircle2,
  "file-shared": FileText,
  "meeting-scheduled": CalendarClock,
};

// The "what's new" list — newest first, with an "Earlier" divider marking where
// the viewer's previous visit was. New items carry a coral icon; older ones go
// muted. Empty and all-new both read cleanly (no stray divider).
function ActivityFeed({
  activity,
}: {
  activity: PartnerProjectViewData["activity"];
}) {
  if (activity.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No recent updates yet. Progress and shared work will show up here.
      </p>
    );
  }
  const firstOlderId = activity.find((a) => !a.isNew)?.id ?? null;
  const hasNew = activity.some((a) => a.isNew);
  return (
    <ul className="flex flex-col">
      {activity.map((a) => {
        const Icon = ACTIVITY_ICON[a.kind];
        return (
          <li key={a.id}>
            {hasNew && a.id === firstOlderId && (
              <div className="my-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                Earlier
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            <div className="flex items-center gap-3 py-2 text-sm">
              <Icon
                className={`h-4 w-4 flex-shrink-0 ${
                  a.isNew ? "text-accent-coral" : "text-muted-foreground"
                }`}
              />
              <span className="min-w-0 flex-1 truncate text-foreground">
                {a.label}
              </span>
              <span className="flex-shrink-0 text-xs text-muted-foreground">
                {fmtDate(a.at)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// Inline preview of a shared file (parity with the internal file view).
// Images and PDFs render from the short-lived signed URL; anything else falls
// back to a download prompt. Download stays one click away in the header.
function SharedFilePreviewModal({
  file,
  currentUserId,
  onClose,
}: {
  file: SharedFile;
  currentUserId: string;
  onClose: () => void;
}) {
  const ct = file.contentType ?? "";
  // Inline preview uses the content-type-forced URL; the Download button uses
  // the plain attachment URL. Fall back to the download URL if no preview URL.
  const previewSrc = file.previewUrl ?? file.downloadUrl ?? undefined;
  const url = file.downloadUrl ?? undefined;
  const isImage = ct.startsWith("image/");
  const isPdf = ct === "application/pdf";
  const isText = ct.startsWith("text/") || ct === "application/json";

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="shared-file-preview-title"
      containerClassName="bg-card rounded-2xl shadow-brand-2 max-w-3xl w-full p-5 sm:p-6 my-auto max-h-[85vh] flex flex-col"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h2
          id="shared-file-preview-title"
          className="text-lg font-semibold text-foreground min-w-0 truncate"
        >
          {file.title}
        </h2>
        <div className="flex items-center gap-3 flex-shrink-0">
          {url && (
            <a
              href={url}
              download={file.fileName ?? undefined}
              className="inline-flex items-center gap-1 text-sm font-medium text-accent-teal hover:underline"
            >
              <Download className="w-4 h-4" />
              Download
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground/70 hover:text-foreground rounded p-1 hover:bg-muted"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="min-h-0 overflow-auto">
        {isImage ? (
          <img
            src={previewSrc}
            alt={file.title}
            className="max-w-full max-h-[70vh] mx-auto rounded-lg border border-border object-contain bg-muted/20"
          />
        ) : isPdf || isText ? (
          <iframe
            src={previewSrc}
            title={file.title}
            className="w-full h-[70vh] rounded-lg border border-border bg-white"
          />
        ) : (
          <div className="rounded-lg border border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
            <p>
              No inline preview for this file type
              {file.contentType ? ` (${file.contentType})` : ""}.
            </p>
            {url && (
              <a
                href={url}
                download={file.fileName ?? undefined}
                className="mt-3 inline-flex items-center gap-1 text-accent-teal hover:underline"
              >
                <Download className="w-3.5 h-3.5" />
                Download to view
              </a>
            )}
          </div>
        )}

        {/* Feedback thread on the shared file — the partner's channel to
            comment on a deliverable. Read-only resolve (the team resolves). */}
        <div className="mt-5 border-t border-border pt-4">
          <CommentsRail
            targetType="file"
            targetId={file.id}
            currentUserId={currentUserId}
            canComment
            canResolve={false}
          />
        </div>
      </div>
    </Modal>
  );
}

// "Contact your team" — a direct line to the project's PM instead of a
// fire-and-forget request form. The team schedules and shares meetings, which
// then surface on the calendar above.
function TeamContactPrompt({
  contact,
  projectName,
}: {
  contact: PartnerProjectViewData["teamContact"];
  projectName: string;
}) {
  return (
    <div className={`mt-4 ${CARD} p-4`}>
      <p className="text-sm font-medium text-dark-blue">Need to meet?</p>
      {contact ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {contact.name} is your DALI point of contact — reach out and they'll
          set up a time, which will show up here.{" "}
          <a
            href={`mailto:${contact.email}?subject=${encodeURIComponent(
              `Meeting request — ${projectName}`,
            )}`}
            className="font-medium text-accent-coral hover:underline"
          >
            Email {contact.name.split(" ")[0] || contact.name}
          </a>
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          Reach out to your DALI team to schedule time — new meetings will show
          up here once they're set.
        </p>
      )}
    </div>
  );
}
