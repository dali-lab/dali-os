import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { Modal, ModalHeader } from "~/components/Modal";
import { Select } from "~/components/ui/floating";
import { Button } from "~/components/ui/Button";
import { ProjectIcon } from "~/components/ProjectIcon";
import type { RenewalRole } from "../../lib/partner-renewals";
import type { PlanningProjectInfo } from "../../lib/planning-gap.server";
import { SpotsStepper } from "../SpotsStepper";
import { fetcherError, noteMeta, PLANNING_ACTION, SavedTextField } from "./SavedTextField";

type CoreMember = { userId: string; name: string };
type Domain = { id: string; name: string };


export function sameSpots(a: RenewalRole[], b: RenewalRole[]): boolean {
  const key = (rs: RenewalRole[]) =>
    rs
      .filter((r) => r.slots > 0)
      .map((r) => `${r.domainId}:${r.slots}`)
      .sort()
      .join(",");
  return key(a) === key(b);
}

export function PlanningProjectModal({
  project,
  info,
  coreMembers,
  domains,
  currentTermId,
  canEdit,
  onClose,
}: {
  project: { id: string; name: string; iconEmoji: string | null };
  info: PlanningProjectInfo;
  coreMembers: CoreMember[];
  domains: Domain[];
  currentTermId: string | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} labelledBy="planning-project-title">
      <ModalHeader
        titleId="planning-project-title"
        title={
          <span className="flex min-w-0 items-center gap-2">
            <ProjectIcon iconEmoji={project.iconEmoji} />
            <span className="min-w-0 truncate">{project.name}</span>
          </span>
        }
        subtitle={info.partnerNames.length > 0 ? info.partnerNames.join(", ") : undefined}
        onClose={onClose}
        closeLabel="Close project info"
      />

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-os-container/70 px-2 py-0.5 font-medium text-foreground">
            {info.status}
          </span>
          {info.plannedTerms.length > 0 && (
            <span>
              {info.plannedTerms.length} planned {info.plannedTerms.length === 1 ? "term" : "terms"} ahead
            </span>
          )}
        </div>

        <SavedTextField
          key={`description:${info.description ?? ""}`}
          title="Description"
          label="Project description"
          placeholder="Add a short description"
          value={info.description}
          fields={{ intent: "description", projectId: project.id }}
          bodyField="description"
          saveLabel="Save description"
          canEdit={canEdit}
        />

        <SavedTextField
          key={`note:${info.note?.updatedAt ?? ""}`}
          title="Planning notes"
          label="Planning notes"
          placeholder="What's going on with this project right now?"
          hint="Only shown here on Planning, not on the project page."
          value={info.note?.body ?? null}
          meta={noteMeta(info.note)}
          fields={{ intent: "note", ownerKind: "project", ownerId: project.id }}
          bodyField="body"
          saveLabel="Save notes"
          canEdit={canEdit}
        />

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Upcoming terms</h3>
          {info.plannedTerms.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              No planned terms ahead, so there is no PI or staffing to set yet.
            </p>
          ) : (
            info.plannedTerms.map((t) => {
              const spots = info.spotsByTerm[t.id] ?? [];
              return (
                <TermBlock
                  key={`${t.id}:${spots.map((s) => `${s.domainId}=${s.slots}`).join(",")}`}
                  projectId={project.id}
                  term={t}
                  isCurrent={currentTermId !== null && t.id === currentTermId}
                  pi={info.pisByTerm[t.id] ?? null}
                  spots={spots}
                  coreMembers={coreMembers}
                  domains={domains}
                  canEdit={canEdit}
                />
              );
            })
          )}
        </section>

        <div className="flex items-center justify-between pt-2">
          <Link to={`/projects/${project.id}`} className="text-sm font-medium text-os-accent hover:underline">
            Open project →
          </Link>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TermBlock({
  projectId,
  term,
  isCurrent,
  pi,
  spots,
  coreMembers,
  domains,
  canEdit,
}: {
  projectId: string;
  term: { id: string; code: string };
  isCurrent: boolean;
  pi: { userId: string; name: string } | null;
  spots: RenewalRole[];
  coreMembers: CoreMember[];
  domains: Domain[];
  canEdit: boolean;
}) {
  const piFetcher = useFetcher();
  const spotsFetcher = useFetcher();
  const [draft, setDraft] = useState<RenewalRole[]>(spots);
  const savingSpots = spotsFetcher.state !== "idle";
  const error = fetcherError(piFetcher.data) ?? fetcherError(spotsFetcher.data);
  const dirty = !sameSpots(draft, spots);
  const total = spots.reduce((n, s) => n + s.slots, 0);

  const piOptions = [
    { value: "", label: "No PI" },
    ...(pi && !coreMembers.some((m) => m.userId === pi.userId) ? [{ value: pi.userId, label: pi.name }] : []),
    ...coreMembers.map((m) => ({ value: m.userId, label: m.name })),
  ];

  const setPi = (piUserId: string) => {
    const form = new FormData();
    form.set("intent", "pi");
    form.set("projectId", projectId);
    form.set("termId", term.id);
    form.set("piUserId", piUserId);
    piFetcher.submit(form, { method: "post", action: PLANNING_ACTION });
  };

  const saveSpots = () => {
    const form = new FormData();
    form.set("intent", "spots");
    form.set("projectId", projectId);
    form.set("termId", term.id);
    form.set("roles", JSON.stringify(draft.map((r) => ({ domainId: r.domainId, slots: r.slots }))));
    spotsFetcher.submit(form, { method: "post", action: PLANNING_ACTION });
  };

  return (
    <div className="flex flex-col gap-3 rounded-os-card bg-os-container/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">
          {term.code}
          {isCurrent && (
            <span className="ml-2 rounded border border-os-accent/40 bg-os-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-os-accent">
              Current
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {total} {total === 1 ? "spot" : "spots"}
        </span>
      </div>

      <div className="grid grid-cols-[minmax(70px,100px)_minmax(0,1fr)] items-center gap-3">
        <span className="text-xs text-muted-foreground">PI</span>
        {canEdit ? (
          <Select
            ariaLabel={`PI for ${term.code}`}
            value={pi?.userId ?? ""}
            onChange={setPi}
            options={piOptions}
          />
        ) : (
          <span className="text-sm text-foreground">
            {pi?.name ?? <span className="italic text-muted-foreground">No PI</span>}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Spots per domain</span>
        {canEdit ? (
          <SpotsStepper
            roles={draft}
            domains={domains}
            onChange={setDraft}
            disabled={savingSpots}
            labelPrefix={`${term.code}: `}
          />
        ) : spots.length === 0 ? (
          <span className="text-sm italic text-muted-foreground">No spots yet</span>
        ) : (
          spots.map((s) => (
            <div key={s.domainId} className="flex justify-between text-sm">
              <span>{s.name}</span>
              <span className="tabular-nums">{s.slots}</span>
            </div>
          ))
        )}
      </div>

      {(dirty || error) && (
        <div className="flex items-center justify-end gap-2">
          {error && <p className="mr-auto text-xs text-destructive">{error}</p>}
          {dirty && (
            <>
              <Button variant="ghost" size="sm" disabled={savingSpots} onClick={() => setDraft(spots)}>
                Cancel
              </Button>
              <Button size="sm" disabled={savingSpots} onClick={saveSpots}>
                {savingSpots ? "Saving" : `Save ${term.code} spots`}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

