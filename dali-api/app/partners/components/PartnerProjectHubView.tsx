import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ChevronDown, ChevronRight, Download, Eye, Folder, X } from "lucide-react";
import { termCodeLabel } from "~/lib/display";
import { formatBytes } from "~/lib/upload-client";
import { Avatar } from "~/components/ui/Avatar";
import { Markdown } from "~/components/Markdown";
import { Modal } from "~/components/Modal";
import { PartnerBackLink } from "~/partners/components/PartnerBackLink";
import { ProjectCoverImage } from "~/projects/components/ProjectCoverImage";
import { ProjectIcon } from "~/components/ProjectIcon";
import { EpicsTimeline } from "~/projects/components/EpicsTimeline";
import type {
  PartnerDriveDoc,
  PartnerDriveFile,
  PartnerDriveFolder,
  PartnerProjectViewData,
} from "~/partners/lib/partner-project-view.server";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Hero readout: names the live sprint so a partner lands on "where are we
// right now" before anything else.
function MomentumReadout({
  momentum,
}: {
  momentum: NonNullable<PartnerProjectViewData["momentum"]>;
}) {
  return (
    <div className="rounded-2xl bg-brand-tint px-5 py-4 sm:min-w-[13rem]">
      <p className="text-xs font-medium uppercase tracking-wide text-accent-teal">
        Current sprint
      </p>
      <p className="mt-1 font-heading font-bold text-dark-blue text-lg leading-snug">
        {momentum.label}
      </p>
    </div>
  );
}

// One shared document. Indented when it sits inside a folder, so the tree
// reads the same way the project hub's Drive does.
function DriveDocRow({
  doc,
  pageHref,
  indent = false,
}: {
  doc: PartnerDriveDoc;
  pageHref: (pageId: string) => string;
  indent?: boolean;
}) {
  return (
    <Link
      to={pageHref(doc.id)}
      className={`flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-muted/20 ${
        indent ? "pl-10" : ""
      }`}
    >
      <span>{doc.iconEmoji ?? "📄"}</span>
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
        {doc.title}
      </span>
      <span className="flex-shrink-0 text-xs text-muted-foreground">
        Updated {fmtDate(doc.updatedAt)}
      </span>
    </Link>
  );
}

// One shared upload. Opens the inline preview rather than navigating — the
// signed URL is already resolved in the loader.
function DriveFileRow({
  file,
  onPreview,
  indent = false,
}: {
  file: PartnerDriveFile;
  onPreview: (f: PartnerDriveFile) => void;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onPreview(file)}
      disabled={!file.downloadUrl}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition ${
        indent ? "pl-10" : ""
      } ${
        file.downloadUrl
          ? "cursor-pointer hover:bg-muted/20"
          : "cursor-not-allowed opacity-60"
      }`}
    >
      <Eye className="h-4 w-4 flex-shrink-0 text-accent-teal" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">
          {file.title}
        </span>
        {(file.fileName || file.sizeBytes != null) && (
          <span className="block truncate text-xs text-muted-foreground">
            {[file.fileName, file.sizeBytes != null ? formatBytes(file.sizeBytes) : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </span>
      <span className="flex-shrink-0 text-xs text-muted-foreground">
        {file.downloadUrl ? "Preview" : "Unavailable"}
      </span>
    </button>
  );
}

// A folder, collapsed until opened (the Finder/Drive convention the project
// hub follows). It only ever lists the items inside it that were shared.
function DriveFolderRow({
  folder,
  pageHref,
  onPreviewFile,
}: {
  folder: PartnerDriveFolder;
  pageHref: (pageId: string) => string;
  onPreviewFile: (f: PartnerDriveFile) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = folder.docs.length + folder.files.length;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition hover:bg-muted/20"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        )}
        <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {folder.title}
        </span>
        <span className="flex-shrink-0 text-xs text-muted-foreground">
          {count} item{count === 1 ? "" : "s"}
        </span>
      </button>
      {open && (
        <div className="border-t border-border divide-y divide-border bg-muted/10">
          {folder.docs.map((d) => (
            <DriveDocRow key={d.id} doc={d} pageHref={pageHref} indent />
          ))}
          {folder.files.map((f) => (
            <DriveFileRow key={f.id} file={f} onPreview={onPreviewFile} indent />
          ))}
        </div>
      )}
    </div>
  );
}

type NavSection = { id: string; label: string };

// Tracks which section is currently in view so the side nav can highlight it.
// Picks the topmost section whose top has scrolled past the header band.
function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");
  const key = ids.join(",");
  useEffect(() => {
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      // Active band sits just below the fixed navbar; a section counts once its
      // top clears the header and before it leaves the upper 40% of the view.
      { rootMargin: "-96px 0px -60% 0px" },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

// In-page table of contents. Sticky beside the sections on wide screens;
// hidden on narrow ones, where the page just scrolls.
function SectionNav({
  sections,
  active,
}: {
  sections: NavSection[];
  active: string;
}) {
  return (
    <nav className="hidden lg:block lg:w-44 lg:flex-shrink-0 lg:sticky lg:top-20 lg:self-start">
      <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        On this page
      </p>
      <ul className="flex flex-col gap-0.5">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById(s.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className={`w-full rounded-lg px-3 py-1.5 text-left text-sm transition ${
                active === s.id
                  ? "bg-brand-tint font-medium text-dark-blue"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// Renders the partner-facing read surface for a project. Shared by the real
// partner portal (partner.projects.$id.tsx) and the in-app preview any
// signed-in member can open from the project page
// (projects.$id.partner-view.tsx) — same content, different chrome around it
// via `backLink`, and pageHref for shared-document links. `backLink` is
// optional: the in-app preview instead swaps the project page's "Partner
// view" header button for an "Internal view" one (see that route's
// `handle.headerAction`), so it has no back link of its own here.
export function PartnerProjectHubView({
  data,
  backLink,
  pageHref,
}: {
  data: PartnerProjectViewData;
  backLink?: { to: string; label: string };
  pageHref: (pageId: string) => string;
}) {
  const {
    project,
    partnerSince,
    currentTermCode,
    team,
    momentum,
    timelineEpics,
    timelineTerms,
    recentlyDone,
    drive,
  } = data;

  // Shared-file inline preview (mirrors the internal file view): clicking a
  // file opens it in a modal — image/PDF inline, everything else a download.
  const [previewFile, setPreviewFile] = useState<PartnerDriveFile | null>(null);

  const isDriveEmpty =
    drive.folders.length === 0 &&
    drive.docs.length === 0 &&
    drive.files.length === 0;

  // Section anchors for the side nav — only the ones actually rendered.
  const sections: NavSection[] = [
    { id: "roadmap", label: "Roadmap" },
    ...(recentlyDone.length > 0
      ? [{ id: "recently-completed", label: "Recently completed" }]
      : []),
    { id: "drive", label: "Drive" },
    ...(team.length > 0 ? [{ id: "team", label: "Team" }] : []),
  ];
  const activeSection = useActiveSection(sections.map((s) => s.id));

  return (
    <div className="flex flex-col gap-8">
      <div>
        {backLink && (
          <PartnerBackLink to={backLink.to} label={backLink.label} />
        )}
        <div
          className={`bg-card border border-border rounded-2xl overflow-hidden ${backLink ? "mt-2" : ""}`}
        >
          <ProjectCoverImage
            name={project.name}
            imageUrl={project.imageUrl}
            className="w-full h-40 object-cover"
            placeholderClassName="w-full h-40"
          />
          <div className="p-5">
            <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="flex items-center gap-2 font-heading text-3xl font-bold text-dark-blue">
                  <ProjectIcon iconEmoji={project.iconEmoji} size="lg" />
                  <span className="min-w-0 truncate">{project.name}</span>
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {[
                    project.terms.length > 0
                      ? `Terms: ${project.terms.map(termCodeLabel).join(", ")}`
                      : null,
                    partnerSince ? `Partner since ${fmtDate(partnerSince)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {/* Same Markdown renderer as the internal Overview tab, so a
                    description written with formatting reads the same on both
                    surfaces. */}
                {project.description && (
                  <div className="mt-3">
                    <Markdown>{project.description}</Markdown>
                  </div>
                )}
              </div>
              {momentum && (
                <div className="sm:flex-shrink-0">
                  <MomentumReadout momentum={momentum} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="lg:flex lg:items-start lg:gap-8">
        {sections.length > 1 && (
          <SectionNav sections={sections} active={activeSection} />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-8">
      {/* The roadmap — the project hub's own planning timeline, drawn from the
          same resolver, with the task level hidden. Partners want the shape of
          the work and when it lands, not the card-by-card breakdown. */}
      <section id="roadmap" className="scroll-mt-24">
        <h2 className="mb-3 font-heading text-lg font-semibold text-dark-blue">
          Roadmap
        </h2>
        {timelineEpics.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-sm text-muted-foreground">
            Nothing on the roadmap yet. Work will appear here once the team
            plans it.
          </div>
        ) : (
          // `compact` because this is a read-only roadmap sitting among the
          // portal's own rounded-2xl cards, not the planning surface: the grid
          // sizes to its bars rather than holding the planning floor.
          <EpicsTimeline
            epics={timelineEpics}
            terms={timelineTerms}
            hiddenLevels={["task"]}
            compact
          />
        )}
      </section>

      {recentlyDone.length > 0 && (
        <section id="recently-completed" className="scroll-mt-24">
          <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
            Recently completed
          </h2>
          <ul className="bg-card border border-border rounded-2xl divide-y divide-border">
            {recentlyDone.map((t) => (
              <li key={t.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                <span className="text-accent-teal">✓</span>
                <span className="flex-1 min-w-0 truncate text-foreground">{t.title}</span>
                {t.domain && (
                  <span className="text-xs rounded-full bg-muted text-muted-foreground px-2 py-0.5 flex-shrink-0">
                    {t.domain}
                  </span>
                )}
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {fmtDate(t.doneAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Drive — one shelf for shared documents and shared files, the way the
          project hub's own Drive block reads. Folders hold whatever inside
          them was shared; everything else sits at the root. */}
      <section id="drive" className="scroll-mt-24">
        <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold text-dark-blue">
          <Folder className="h-4 w-4" /> Drive
        </h2>
        {isDriveEmpty ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-sm text-muted-foreground">
            The team hasn't shared any documents or files yet.
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl divide-y divide-border">
            {drive.folders.map((f) => (
              <DriveFolderRow
                key={f.id}
                folder={f}
                pageHref={pageHref}
                onPreviewFile={setPreviewFile}
              />
            ))}
            {drive.docs.map((d) => (
              <DriveDocRow key={d.id} doc={d} pageHref={pageHref} />
            ))}
            {drive.files.map((f) => (
              <DriveFileRow key={f.id} file={f} onPreview={setPreviewFile} />
            ))}
          </div>
        )}
      </section>

      {/* Team */}
      {team.length > 0 && (
        <section id="team" className="scroll-mt-24">
          <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
            Your DALI team{currentTermCode ? ` · ${termCodeLabel(currentTermCode)}` : ""}
          </h2>
          <div className="bg-card border border-border rounded-2xl p-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {team.map((m) => (
              <div key={m.name} className="flex items-center gap-3 min-w-0">
                <Avatar photoUrl={m.photoUrl} name={m.name} size="md" />
                <div className="min-w-0">
                  <span className="font-medium text-dark-blue block truncate">
                    {m.name}
                  </span>
                  <span className="text-xs text-muted-foreground block truncate">
                    {m.domains.join(", ")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {previewFile && (
        <SharedFilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
        </div>
      </div>
    </div>
  );
}

// Inline preview of a shared file (parity with the internal file view).
// Images and PDFs render from the short-lived signed URL; anything else falls
// back to a download prompt. Download stays one click away in the header.
function SharedFilePreviewModal({
  file,
  onClose,
}: {
  file: PartnerDriveFile;
  onClose: () => void;
}) {
  const ct = file.contentType ?? "";
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
            src={url}
            alt={file.title}
            className="max-w-full max-h-[70vh] mx-auto rounded-lg border border-border object-contain bg-muted/20"
          />
        ) : isPdf || isText ? (
          <iframe
            src={url}
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
      </div>
    </Modal>
  );
}
