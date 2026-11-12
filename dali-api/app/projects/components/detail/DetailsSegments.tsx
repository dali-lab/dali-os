import { PROJECT_STATUSES } from "~/projects/lib/project-lifecycle";
import { useRef, useState } from "react";
import { Form, Link, useSubmit } from "react-router";
import { Select, InfoTip } from "~/components/ui/floating";
import {
  CalendarDays,
  Globe,
  Settings,
  ChevronRight,
  ChevronDown,
  FileText,
  Info,
  Users,
  ExternalLink,
  Mail,
  Github,
  Slack,
  Layers,
  Figma,
} from "lucide-react";
import { DomainChips } from "~/components/DomainChips";
import {
  DetailEditRow,
  DetailRow,
  OS_DETAIL_CARD,
  OS_DETAIL_ICON,
} from "~/components/os-page";
import { cn } from "~/lib/cn";
import { Checkbox } from "~/components/ui/Checkbox";
import { Toggle } from "~/components/ui/Toggle";
import { EditableSection } from "~/components/EditableSection";
import { Markdown } from "~/components/Markdown";
import { type ProjectStatus } from "~/projects/lib/project-lifecycle";
import { DOT_TONES } from "~/components/ui/Pill";
import { PROJECT_STATUS_TONES, StatusBadge } from "~/projects/components/detail/StatusBadge";
import { type LoaderData } from "~/projects/components/detail/types";

export function DescriptionSegment({
  description,
  canEdit,
}: {
  description: string | null;
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Description"
      icon={<FileText className="w-4 h-4" />}
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing }) =>
        editing ? (
          // Edits on the same card the description reads on, in the design's
          // field dress — not a differently-shaped form dropped in its place.
          <Form
            method="post"
            ref={formRef}
            className={cn("flex flex-col gap-1.5", "rounded-os-card bg-os-container/40 os-form p-5")}
          >
            <input type="hidden" name="intent" value="description" />
            <textarea
              name="description"
              rows={6}
              defaultValue={description ?? ""}
              placeholder="Add a short description… (Markdown supported)"
              className="w-full resize-y"
              autoFocus
            />
          </Form>
        ) : (
          <div className="rounded-os-card bg-os-container/40 p-5">
            {description ? (
              <Markdown>{description}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No description.
              </p>
            )}
          </div>
        )
      }
    </EditableSection>
  );
}
// Status: the project's lifecycle plate (Active / Paused / Archived), edited
// here in Project settings so Core owns lifecycle changes in one place; the
// hero shows the same pill read-only.
export function StatusSegment({
  status,
  canEdit,
}: {
  status: ProjectStatus;
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Status"
      canEdit={canEdit}
      description="Active, Paused, or Archived — the lifecycle state shown as the pill beside the project name."
      onSave={() => {
        if (formRef.current) submit(formRef.current);
      }}
    >
      {({ editing, resetKey }) =>
        editing ? (
          <Form method="post" ref={formRef} key={resetKey}>
            <input type="hidden" name="intent" value="status" />
            <Select
              name="status"
              defaultValue={status}
              ariaLabel="Project status"
              options={PROJECT_STATUSES.map((s) => ({ value: s, label: s }))}
              triggerIcon={
                <span
                  className={cn("h-2 w-2 shrink-0 rounded-full", DOT_TONES[PROJECT_STATUS_TONES[status]])}
                  aria-hidden
                />
              }
              buttonClassName="inline-flex items-center gap-1.5 rounded-full bg-os-container px-2.5 py-0.5 text-xs font-medium text-foreground transition-[filter] hover:brightness-95"
            />
          </Form>
        ) : (
          <StatusBadge status={status} />
        )
      }
    </EditableSection>
  );
}
// Declared-domain editor for the project. Multi-select via checkboxes (3–8
// active domains; click-to-toggle reads faster than a multi-select). Saves
// the full set on every toggle so the row order doesn't matter and a stale
// optimistic state can't accumulate. When no domains are declared and the
// project has bids/assignments, the derived union is shown read-only as a
// hint so the user can see what staffing has implied so far.
// Private toggle. "Private" only affects form reference questions today: a
// private project is dropped from every `projects:*` source in
// forms/lib/reference-sources.ts, so nobody can pick it as a bid/preference
// answer. It stays fully visible in the hub, search, and to its own team —
// the description below says so, since "private" otherwise reads as broader.
export function VisibilitySegment({
  isPrivate,
  canEdit,
}: {
  isPrivate: boolean;
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Visibility"
      canEdit={canEdit}
      description="Private projects can't be selected as an answer on forms that pull from the project database."
      onSave={() => {
        if (formRef.current) submit(formRef.current);
      }}
    >
      {({ editing, resetKey }) =>
        editing ? (
          <Form method="post" ref={formRef} key={resetKey}>
            <input type="hidden" name="intent" value="visibility" />
            <Checkbox
              name="isPrivate"
              defaultChecked={isPrivate}
              label="Private project"
              description="Hidden from project dropdowns on forms. Still listed in the project hub and search."
              className="text-sm"
            />
          </Form>
        ) : (
          <p className="text-sm text-foreground">
            {isPrivate ? "Private" : "Standard"}
            <span className="block text-xs text-muted-foreground">
              {isPrivate
                ? "Not offered as a choice on forms that query projects."
                : "Selectable on forms that query projects."}
            </span>
          </p>
        )
      }
    </EditableSection>
  );
}
// Meeting recording toggle (specs/meeting-transcription.md). Core-only
// (listed in SCOPE_INTENTS); Disabled hides the Record button and all three
// "record this meeting?" prompts for this project's meetings.
export function RecordingPolicySegment({
  recordingPolicy,
  canEdit,
}: {
  recordingPolicy: "Allowed" | "Disabled";
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);
  const allowed = recordingPolicy !== "Disabled";

  return (
    <EditableSection
      title="Meeting recording"
      canEdit={canEdit}
      description="Lets anyone editing a meeting note on this project record it. Audio is transcribed, then deleted after."
      onSave={() => {
        if (formRef.current) submit(formRef.current);
      }}
    >
      {({ editing, resetKey }) =>
        editing ? (
          <Form method="post" ref={formRef} key={resetKey}>
            <input type="hidden" name="intent" value="recordingPolicy" />
            <Toggle
              name="recordingAllowed"
              defaultChecked={allowed}
              label="Allow recording this project's meetings"
            />
          </Form>
        ) : (
          <p className="text-sm text-foreground">
            {allowed ? "Allowed" : "Disabled"}
            <span className="block text-xs text-muted-foreground">
              {allowed
                ? "The Record button and record prompts are available on this project's meeting notes."
                : "The Record button and record prompts are hidden for this project's meetings."}
            </span>
          </p>
        )
      }
    </EditableSection>
  );
}
// Read-only (specs/meeting-notes-model.md §1): the picker lives on the
// template page itself, in the Drive templates gallery — this just shows
// what's bound so Settings isn't the one place that's silent about it.
export function MeetingNoteTemplateSegment({
  meetingNoteTemplate,
}: {
  meetingNoteTemplate: { id: string; title: string } | null;
}) {
  return (
    <EditableSection title="Meeting note template" canEdit={false}>
      {() => (
        <p className="text-sm text-foreground">
          {meetingNoteTemplate ? (
            <Link to={`/documents/${meetingNoteTemplate.id}`} className="text-os-accent hover:underline">
              {meetingNoteTemplate.title}
            </Link>
          ) : (
            "None"
          )}
          <span className="block text-xs text-muted-foreground">
            Seeds every new meeting note for this project. Set from a template page's own ⋯ menu
            ("Use for this project's meeting notes").
          </span>
        </p>
      )}
    </EditableSection>
  );
}
export function DomainsSegment({
  declared,
  derived,
  allDomains,
  canEdit,
}: {
  declared: { id: string; name: string }[];
  derived: { id: string; name: string }[];
  allDomains: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Domains"
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing, resetKey }) =>
        editing ? (
          // Controlled chip toggles. The previous markup wrapped a hidden
          // checkbox in a styled <label> and keyed the chip's "selected"
          // styling off the prop-derived `isOn` — clicking the label
          // toggled the checkbox in the DOM but `isOn` (a render closure)
          // never re-read it, so the chip looked unchanged. Now an explicit
          // local Set tracks selection, the chip is a <button>, and the
          // form's `domainId` entries are emitted as hidden inputs at
          // submit time. `resetKey` (bumped by EditableSection on Cancel)
          // is the dependency that resets state back to `declared`.
          <DomainsChipsEditor
            key={resetKey}
            formRef={formRef}
            initialSelectedIds={declared.map((d) => d.id)}
            allDomains={allDomains}
            derived={derived}
            declaredCount={declared.length}
          />
        ) : declared.length > 0 ? (
          <DomainChips items={declared} />
        ) : derived.length > 0 ? (
          <>
            <DomainChips items={derived} muted />
            <p className="text-xs text-muted-foreground mt-2">
              Derived from current bids and assignments — no domains have
              been declared on the project yet.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground italic">No domains.</p>
        )
      }
    </EditableSection>
  );
}
function DomainsChipsEditor({
  formRef,
  initialSelectedIds,
  allDomains,
  derived,
  declaredCount,
}: {
  formRef: React.MutableRefObject<HTMLFormElement | null>;
  initialSelectedIds: string[];
  allDomains: { id: string; name: string }[];
  derived: { id: string; name: string }[];
  declaredCount: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelectedIds),
  );
  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <Form method="post" ref={formRef} className="flex flex-col gap-2">
      <input type="hidden" name="intent" value="domains" />
      {/* Selected ids are submitted as repeated form fields the action
          collects via form.getAll("domainId"). */}
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="domainId" value={id} />
      ))}
      <div className="flex flex-wrap gap-2">
        {allDomains.map((d) => {
          const isOn = selected.has(d.id);
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => toggle(d.id)}
              aria-pressed={isOn}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-sm cursor-pointer transition-colors ${
                isOn
                  ? "bg-os-accent/15 border-os-accent/40 text-foreground"
                  : "bg-background border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {d.name}
            </button>
          );
        })}
      </div>
      {derived.length > 0 && declaredCount === 0 && (
        <p className="text-xs text-muted-foreground">
          No domains declared yet — current bids and assignments suggest:{" "}
          <span className="text-foreground">
            {derived.map((d) => d.name).join(", ")}
          </span>
          .
        </p>
      )}
    </Form>
  );
}
// Project terms — the editable term set (source of truth for which terms the
// project runs). Same click-to-toggle, save-the-full-set pattern as Domains;
// the action's intent=terms handler full-replaces ProjectTerm rows. The start
// term and "active this term" are derived from this set, so no separate
// start-term field is edited here. `expected` (termCount) is edited in the
// Details section and shown here only as a target for context.
export function TermsSegment({
  selected,
  allTerms,
  expected,
  canEdit,
}: {
  selected: { id: string; code: string }[];
  allTerms: { id: string; code: string }[];
  expected: number;
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Terms"
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing, resetKey }) =>
        editing ? (
          <TermsChipsEditor
            key={resetKey}
            formRef={formRef}
            initialSelectedIds={selected.map((t) => t.id)}
            allTerms={allTerms}
            expected={expected}
          />
        ) : selected.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700 border border-blue-100"
              >
                {t.code}
              </span>
            ))}
            {selected.length !== expected && (
              <span className="text-xs text-muted-foreground self-center">
                {selected.length} of {expected} expected
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No terms yet{expected > 0 ? ` — ${expected} expected` : ""}.
          </p>
        )
      }
    </EditableSection>
  );
}
function TermsChipsEditor({
  formRef,
  initialSelectedIds,
  allTerms,
  expected,
}: {
  formRef: React.MutableRefObject<HTMLFormElement | null>;
  initialSelectedIds: string[];
  allTerms: { id: string; code: string }[];
  expected: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelectedIds),
  );
  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <Form method="post" ref={formRef} className="flex flex-col gap-2">
      <input type="hidden" name="intent" value="terms" />
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="termId" value={id} />
      ))}
      <div className="flex flex-wrap gap-2">
        {allTerms.map((t) => {
          const isOn = selected.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              aria-pressed={isOn}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-sm cursor-pointer transition-colors ${
                isOn
                  ? "bg-os-accent/15 border-os-accent/40 text-foreground"
                  : "bg-background border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.code}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {selected.size} selected · {expected} expected. The start term is the
        earliest selected; the project shows as active when the current term is
        selected.
      </p>
    </Form>
  );
}
// Calendar email + image URL + term count + repo URLs. One form posting
// intent=details with the full field set, so the action handler stays
// unchanged. Section-level Save submits; Cancel reverts via the wrapper.
// The os read view of Project details: a compact icon/label row list with the
// less-common fields folded behind "Additional details". The edit form is
// unchanged — this only replaces the read layout under the os tab set.
function DetailsReadOs({
  project,
  canEditFinance,
}: {
  project: LoaderData["project"];
  canEditFinance: boolean;
}) {
  const [showMore, setShowMore] = useState(false);
  const repoName = (url: string) => url.replace(/\/+$/, "").split("/").pop() || url;
  // figma.com/{file|design}/{key}/{name} — show the readable name segment, with
  // dashes turned back into spaces; fall back to "Figma" for a bare file URL.
  const figmaName = (url: string) => {
    try {
      const name = new URL(url).pathname.split("/").filter(Boolean)[2];
      return name ? decodeURIComponent(name).replace(/-/g, " ") : "Figma";
    } catch {
      return "Figma";
    }
  };
  const dash = <span className="text-os-muted">—</span>;
  const ic = OS_DETAIL_ICON;

  return (
    <div className={OS_DETAIL_CARD}>
      <DetailRow icon={<Mail className={ic} />} label="Calendar email">
        {project.calendarEmail ? (
          <a
            href={`mailto:${project.calendarEmail}`}
            className="text-os-accent hover:underline break-all"
          >
            {project.calendarEmail}
          </a>
        ) : (
          dash
        )}
      </DetailRow>

      <DetailRow icon={<Github className={ic} />} label="GitHub team">
        {project.githubTeamSlug ?? dash}
      </DetailRow>

      <DetailRow icon={<Slack className={ic} />} label="Slack channel">
        {project.slackChannelName && project.slackChannelId ? (
          <a
            href={`https://slack.com/app_redirect?channel=${project.slackChannelId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-os-accent hover:underline"
          >
            #{project.slackChannelName}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : project.slackChannelName ? (
          `#${project.slackChannelName}`
        ) : (
          dash
        )}
      </DetailRow>

      <DetailRow icon={<Layers className={ic} />} label="Repositories">
        {project.repoUrls.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {project.repoUrls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-os-container px-2.5 py-0.5 text-xs font-medium text-foreground transition-colors hover:text-os-accent"
              >
                {repoName(url)}
              </a>
            ))}
          </div>
        ) : (
          dash
        )}
      </DetailRow>

      <DetailRow icon={<Figma className={ic} />} label="Figma">
        {project.figmaUrls.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {project.figmaUrls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-os-container px-2.5 py-0.5 text-xs font-medium text-foreground transition-colors hover:text-os-accent"
              >
                {figmaName(url)}
              </a>
            ))}
          </div>
        ) : (
          dash
        )}
      </DetailRow>

      <DetailRow icon={<Globe className={ic} />} label="Deployment">
        {project.deploymentUrl ? (
          <a
            href={project.deploymentUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-os-accent hover:underline break-all"
          >
            {project.deploymentUrl.replace(/^https?:\/\//, "")}
            <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
          </a>
        ) : (
          dash
        )}
      </DetailRow>

      <div className="border-t border-os-container">
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
          className="flex w-full items-center gap-1.5 py-2.5 text-sm text-os-grey transition-colors hover:text-foreground"
        >
          {showMore ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          Additional details
        </button>
        {showMore && (
          <div className="pb-1">
            {project.teamGroupEmail && (
              <DetailRow icon={<Users className={ic} />} label="Team email group">
                <a
                  href={`mailto:${project.teamGroupEmail}`}
                  className="text-os-accent hover:underline break-all"
                >
                  {project.teamGroupEmail}
                </a>
              </DetailRow>
            )}
            <DetailRow icon={<CalendarDays className={ic} />} label="Terms required">
              {project.termCount} {project.termCount === 1 ? "term" : "terms"}
            </DetailRow>
          </div>
        )}
      </div>
    </div>
  );
}

/* Project details in edit mode: the read view's own card and rows, with each
   value swapped for its field. Every field the `details` intent writes is
   rendered — that write replaces the whole set, so a field left out of the
   form would be cleared rather than kept. That is also why nothing here hides
   behind a disclosure the way the read view's "Additional details" does. */
function DetailsEditOs({
  project,
  canEditFinance,
}: {
  project: LoaderData["project"];
  canEditFinance: boolean;
}) {
  const ic = OS_DETAIL_ICON;
  const field = "w-full";

  return (
    <div className={OS_DETAIL_CARD}>
      <DetailEditRow icon={<Mail className={ic} />} label="Calendar email">
        <input
          name="calendarEmail"
          type="email"
          defaultValue={project.calendarEmail ?? ""}
          placeholder="projectname@dali.dartmouth.edu"
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow icon={<Github className={ic} />} label="GitHub team">
        <input
          name="githubTeamSlug"
          type="text"
          defaultValue={project.githubTeamSlug ?? ""}
          placeholder="project-team-name"
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow icon={<Slack className={ic} />} label="Slack channel">
        <input
          name="slackChannelName"
          type="text"
          defaultValue={project.slackChannelName ?? ""}
          placeholder="project-name"
          className={field}
        />
      </DetailEditRow>

      <DetailEditRow
        icon={<Layers className={ic} />}
        label="Repositories"
        infoTip={<InfoTip content="One URL per line" />}
      >
        <textarea
          name="repoUrls"
          rows={3}
          defaultValue={project.repoUrls.join("\n")}
          placeholder="https://github.com/dali-lab/…"
          className={cn(field, "resize-y font-mono")}
        />
      </DetailEditRow>

      <DetailEditRow
        icon={<Figma className={ic} />}
        label="Figma"
        infoTip={<InfoTip content="One URL per line" />}
      >
        <textarea
          name="figmaUrls"
          rows={3}
          defaultValue={project.figmaUrls.join("\n")}
          placeholder="https://figma.com/design/…"
          className={cn(field, "resize-y font-mono")}
        />
      </DetailEditRow>

      <DetailEditRow icon={<Globe className={ic} />} label="Deployment">
        <input
          name="deploymentUrl"
          type="url"
          defaultValue={project.deploymentUrl ?? ""}
          placeholder="https://projectname.fly.dev"
          className={cn(field, "font-mono")}
        />
      </DetailEditRow>

      {/* Provisioned by the staffing "Create team email group" automation —
          shown for context, not lead-editable. */}
      <DetailEditRow icon={<Users className={ic} />} label="Team email group">
        <p className="text-sm text-foreground sm:text-right">
          {project.teamGroupEmail ?? (
            <span className="text-os-muted">Not created yet — run staffing finalize.</span>
          )}
        </p>
      </DetailEditRow>

      <DetailEditRow
        icon={<CalendarDays className={ic} />}
        label="Terms required"
        infoTip={<InfoTip content="The planned span, not the terms staffed so far" />}
      >
        <input
          name="termCount"
          type="number"
          min={1}
          defaultValue={project.termCount}
          className={field}
        />
      </DetailEditRow>

    </div>
  );
}
export function DetailsSegment({
  project,
  canEdit,
  canEditFinance,
}: {
  project: LoaderData["project"];
  canEdit: boolean;
  canEditFinance: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <EditableSection
      title="Project details"
      icon={<Info className="w-4 h-4" />}
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing }) =>
        editing ? (
          <Form method="post" ref={formRef} className="os-form w-full">
            <input type="hidden" name="intent" value="details" />
            <DetailsEditOs project={project} canEditFinance={canEditFinance} />
          </Form>
        ) : (
          <DetailsReadOs project={project} canEditFinance={canEditFinance} />
        )
      }
    </EditableSection>
  );
}
// Per-(domain, term) scope grid. One Edit button for the whole section;
// Save commits every cell at once via intent=scopesBulk. Empty cells in
// the submitted set delete their row server-side.
export function DomainScopesSegment({
  domains,
  terms,
  grid,
  canEdit,
}: {
  domains: { id: string; name: string }[];
  terms: { id: string; code: string }[];
  grid: {
    domainId: string;
    domainName: string;
    termId: string;
    termCode: string;
    scope: string;
  }[];
  canEdit: boolean;
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);
  const cell = (domainId: string, termId: string): string =>
    grid.find((c) => c.domainId === domainId && c.termId === termId)?.scope ??
    "";
  // terms is already sorted newest-first (plannedTerms), so terms[0] is this
  // project's latest term — the only one expanded by default.
  const [expandedTermIds, setExpandedTermIds] = useState<Set<string>>(
    () => new Set(terms[0] ? [terms[0].id] : []),
  );
  const toggleTerm = (id: string) =>
    setExpandedTermIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <EditableSection
      title="Domain challenges"
      description="Free-text challenge brief for each declared domain in each planned term."
      canEdit={canEdit}
      onSave={() => { if (formRef.current) submit(formRef.current); }}
    >
      {({ editing }) => (
        <Form method="post" ref={formRef} className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="scopesBulk" />
          {terms.map((t) => {
            // Editing needs every term's fields mounted so a save doesn't
            // wipe out cells in a folded term; folding only applies to viewing.
            const open = editing || expandedTermIds.has(t.id);
            return (
              <div key={t.id} className="flex flex-col gap-2">
                {editing ? (
                  <h3 className="text-sm font-semibold text-foreground">{t.code}</h3>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleTerm(t.id)}
                    className="flex items-center gap-1.5 text-left text-sm font-semibold text-foreground"
                  >
                    {open ? (
                      <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                    )}
                    {t.code}
                  </button>
                )}
                <div className={`flex flex-col gap-3 ${open ? "" : "hidden"}`}>
                  {domains.map((d) => {
                    const value = cell(d.id, t.id);
                    return (
                      <div
                        key={`${d.id}:${t.id}`}
                        className="rounded-md border border-border p-2 flex flex-col gap-1"
                      >
                        <span className="text-[11px] font-medium text-muted-foreground">
                          {d.name}
                        </span>
                        {editing ? (
                          <textarea
                            name={`scope:${d.id}:${t.id}`}
                            defaultValue={value}
                            rows={3}
                            placeholder="+ Add challenge"
                            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/30 resize-y"
                          />
                        ) : value ? (
                          <p className="text-sm text-foreground whitespace-pre-wrap">
                            {value}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">
                            No challenge.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </Form>
      )}
    </EditableSection>
  );
}
