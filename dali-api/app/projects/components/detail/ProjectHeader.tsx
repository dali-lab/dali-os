import { useState } from "react";
import { useSubmit } from "react-router";
import { Avatar } from "~/components/ui/Avatar";
import { DomainChips } from "~/components/DomainChips";
import { HeroClusterLabel } from "~/components/os-page";
import { cn } from "~/lib/cn";
import { PANE_BLEED_TOP_CLASS } from "~/components/shell/pane-gutter";
import { ImagePlus } from "lucide-react";
import { CoverTile, cardColorHex, coverGround, parseCover } from "~/components/cover/CoverPattern";
import { GeneratedArt } from "~/components/cover/GeneratedArt";
import { ProjectCoverModal } from "~/projects/components/ProjectCoverModal";
import { ProjectImageBanner } from "~/projects/components/ProjectImageBanner";
import { ProjectIcon } from "~/components/ProjectIcon";
import { ProjectIconPicker } from "~/projects/components/ProjectIconPicker";
import { maintenanceLabel } from "~/partners/lib/partner-renewals";
import { type LoaderData } from "~/projects/components/detail/types";

// Above this many terms the row collapses its middle so a long-running project
// doesn't push a wall of chips across the hero. Terms are chronological, so we
// keep the first and last few (the span endpoints) and hide the run between
// behind a "+N" that expands in place.
const TERMS_COLLAPSE_THRESHOLD = 8;
const TERMS_HEAD = 3;
const TERMS_TAIL = 3;
function TermChip({ code }: { code: string }) {
  return (
    <span className="rounded-os-item bg-os-container px-3 py-1 text-[13px] font-semibold text-foreground">
      {code}
    </span>
  );
}
function TermsChips({ terms }: { terms: { code: string }[] }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = terms.length > TERMS_COLLAPSE_THRESHOLD;

  if (!collapsible || expanded) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {terms.map((t) => (
          <TermChip key={t.code} code={t.code} />
        ))}
        {collapsible && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="rounded-os-item px-2.5 py-1 text-[13px] font-medium text-os-grey transition-colors hover:text-foreground"
          >
            Show less
          </button>
        )}
      </div>
    );
  }

  const head = terms.slice(0, TERMS_HEAD);
  const tail = terms.slice(terms.length - TERMS_TAIL);
  const hidden = terms.length - TERMS_HEAD - TERMS_TAIL;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {head.map((t) => (
        <TermChip key={t.code} code={t.code} />
      ))}
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={`Show ${hidden} more terms`}
        className="rounded-os-item bg-os-container/60 px-3 py-1 text-[13px] font-semibold text-os-grey transition-colors hover:bg-os-container hover:text-foreground"
      >
        +{hidden}
      </button>
      {tail.map((t) => (
        <TermChip key={t.code} code={t.code} />
      ))}
    </div>
  );
}
export function ProjectHeader({
  project,
  partnerNames,
  canEdit,
  band = false,
  people = [],
}: {
  project: LoaderData["project"];
  partnerNames: string[];
  canEdit: boolean;
  band?: boolean;
  people?: { userId: string; name: string; photoUrl: string | null }[];
}) {
  const submit = useSubmit();
  // Name and icon each save the moment you change them — the hero has no edit
  // mode and no pencil (which used to collide with the taskboard's Edit-task
  // pencil). Only the name needs a transient draft while you type; icon
  // read/writes project state directly, so the field never drifts from the
  // loader. Status, terms and roles are read-only here now — they live in
  // Project settings (the gear), the one place that edits project scope.
  const [editingName, setEditingName] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);

  function startRename() {
    setNameDraft(project.name);
    setEditingName(true);
  }
  function commitName() {
    const trimmed = nameDraft.trim();
    setEditingName(false);
    if (!trimmed || trimmed === project.name) return;
    saveHeader({ name: trimmed });
  }
  // One write path for name + icon: post the current project values with the
  // one field being changed overridden, so a rename doesn't blank the icon and
  // vice versa. iconEmoji goes through "in patch" because null (no icon) is a
  // real value the ?? fallback would swallow. Status is edited in Project
  // settings now, but the `header` intent still validates it, so we carry the
  // current value through unchanged.
  function saveHeader(patch: {
    name?: string;
    iconEmoji?: string | null;
  }) {
    submit(
      {
        intent: "header",
        name: patch.name ?? project.name,
        status: project.status,
        iconEmoji: ("iconEmoji" in patch ? patch.iconEmoji : project.iconEmoji) ?? "",
      },
      { method: "post" },
    );
  }

  // Actual terms vs the expected span: when they differ, the label reads
  // "Terms · N of M" so a partially-scheduled project reads as such.
  // termCount is the expected target.
  const actualTermCount = project.actualTermCount;
  const termsClusterLabel =
    actualTermCount === project.termCount
      ? "Terms"
      : `Terms · ${actualTermCount} of ${project.termCount}`;

  // The design's right-hand clusters: a muted label over a row of plain chips,
  // the same dress for terms and roles. Read-only in the hero: terms and roles
  // are project scope, so Core edits them in Project settings (the gear), not
  // from the title row.
  const osTagGroup = (
    <div className="flex flex-wrap items-start gap-6">
      <HeroClusterLabel label={termsClusterLabel}>
        {project.terms.length === 0 ? (
          <span className="text-[13px] text-os-muted">No terms yet</span>
        ) : (
          <TermsChips terms={project.terms} />
        )}
      </HeroClusterLabel>

      <HeroClusterLabel label="Roles">
        {project.domains.length === 0 && project.derivedDomains.length === 0 ? (
          <span className="text-[13px] text-os-muted">No roles yet</span>
        ) : (
          // A role is a role: the set derived from bids and assignments (a
          // project staffed before anyone declared its domains) reads the same
          // as a declared one.
          <DomainChips
            items={project.domains.length > 0 ? project.domains : project.derivedDomains}
          />
        )}
      </HeroClusterLabel>

      {project.maintenancePlan && (
        <HeroClusterLabel label="Maintenance">
          <span className="rounded-full border border-os-accent/40 bg-os-accent/10 px-2.5 py-0.5 text-[13px] font-medium text-os-accent">
            {maintenanceLabel(project.maintenancePlan)}
          </span>
        </HeroClusterLabel>
      )}
    </div>
  );

  // Name, status and icon edit in place — no edit mode, no form wrapper. Each
  // control saves on its own (rename on blur/Enter, status and icon on change),
  // so the hero never swaps into a differently-shaped editor. A viewer who
  // can't edit gets the same three elements, read-only.
  const nameClasses = cn(
    "font-heading",
    band ? "text-os-on-band text-[32px] font-semibold tracking-[-0.02em]" : "text-foreground text-[32px] font-medium",
  );
  const titleCluster = (
    <>
      {/* Real project icon at the title's own size — the design prints the
          emoji inline with the heading. The picker renders the same glyph and
          opens on click, so read and edit look identical until you click. */}
      {canEdit ? (
        <ProjectIconPicker
          iconEmoji={project.iconEmoji}
          editing
          onChange={(v) => saveHeader({ iconEmoji: v })}
        />
      ) : (
        <ProjectIcon iconEmoji={project.iconEmoji} size="inherit" />
      )}
      {canEdit && editingName ? (
        <input
          name="name"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitName();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditingName(false);
            }
          }}
          aria-label="Project name"
          autoFocus
          // Sized to the name it holds so the title doesn't jump to a box of
          // some other width the moment you click it.
          style={{ width: `${Math.max(nameDraft.length, 8) + 1}ch` }}
          className={cn(
            nameClasses,
            "bg-transparent max-w-full focus:outline-none",
            band ? "border-b border-os-band-line focus:border-os-on-band" : "border-b border-os-container-hi focus:border-os-accent",
          )}
        />
      ) : (
        // Click-to-rename keeps the <h1> as the title element; when you can
        // edit it also acts as a button that turns into the field above.
        <h1
          className={cn(
            nameClasses,
            canEdit &&
              "cursor-text rounded-md -mx-1 px-1 transition-colors",
            canEdit && (band ? "hover:bg-os-band-chip" : "hover:bg-muted/40"),
          )}
          role={canEdit ? "button" : undefined}
          tabIndex={canEdit ? 0 : undefined}
          title={canEdit ? "Rename project" : undefined}
          onClick={canEdit ? startRename : undefined}
          onKeyDown={
            canEdit
              ? (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    startRename();
                  }
                }
              : undefined
          }
        >
          {project.name}
        </h1>
      )}
    </>
  );

  if (band) {
    const subtitle = [partnerNames.join(", "), project.terms.map((t) => t.code).join(", ")]
      .filter(Boolean)
      .join(" · ");
    const roles = project.domains.length > 0 ? project.domains : project.derivedDomains;
    const parsed = parseCover(project.imageUrl);
    return (
      <header
        data-testid="project-band"
        style={parsed ? { backgroundColor: cardColorHex(parsed.card) } : undefined}
        className={cn("flex min-h-[176px] gap-6 bg-os-band p-6 text-os-on-band", PANE_BLEED_TOP_CLASS)}
      >
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2.5">{titleCluster}</div>
            {subtitle && <p className="text-sm text-os-on-band-meta">{subtitle}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {roles.map((d) => (
              <span
                key={d.id}
                className="inline-flex h-[26px] items-center rounded-full border border-os-band-line bg-os-band-chip px-2.5 text-xs font-semibold text-os-on-band"
              >
                {d.name}
              </span>
            ))}
            {people.length > 0 && (
              <div className="ml-2 flex items-center -space-x-1.5">
                {people.map((p) => (
                  <Avatar
                    key={p.userId}
                    name={p.name}
                    photoUrl={p.photoUrl}
                    size="compact"
                    className="ring-2 ring-os-band"
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="group relative hidden h-[128px] w-[342px] shrink-0 overflow-hidden rounded-xl md:block">
          {parsed ? (
            <div className="h-full w-full" style={{ backgroundColor: coverGround(project.imageUrl!) }}>
              <CoverTile url={project.imageUrl!} />
            </div>
          ) : project.imageUrlResolved ? (
            <img src={project.imageUrlResolved} alt="" className="h-full w-full object-cover" />
          ) : (
            <GeneratedArt />
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setCoverOpen(true)}
              className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-md border border-os-band-line bg-os-band-chip px-2.5 py-1.5 text-xs font-medium text-os-on-band opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            >
              <ImagePlus className="h-4 w-4" aria-hidden />
              Change cover
            </button>
          )}
        </div>
        {coverOpen && (
          <ProjectCoverModal
            projectId={project.id}
            initialCover={project.imageUrl}
            initialImageUrl={project.imageUrlResolved}
            onClose={() => setCoverOpen(false)}
          />
        )}
      </header>
    );
  }

  return (
    <header className={cn("flex flex-col", "gap-6")}>
      <ProjectImageBanner
        projectId={project.id}
        projectName={project.name}
        initialPreviewUrl={project.imageUrlResolved}
        canEdit={canEdit}
        frameClassName="h-[275px] rounded-os-card"
      />
      <div className="min-w-0 flex-1">
        {/* The edit control is its own column at the far right, outside the
            row that wraps: while it rode along with the tag clusters it got
            pushed onto a line of its own under Roles as soon as they filled
            the row, and opening the editor re-flowed the clusters with it. */}
        <div className={cn("flex items-start justify-between", "gap-4")}>
          <div
            className={cn(
              "min-w-0 flex-1",
              "flex flex-wrap items-center justify-between gap-x-6 gap-y-4",
            )}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">{titleCluster}</div>
            </div>

            {/* os: the design's hero-meta row — title left, the term and role
                clusters right, both inside the wrapping column. */}
            {osTagGroup}
          </div>
        </div>
      </div>
    </header>
  );
}
