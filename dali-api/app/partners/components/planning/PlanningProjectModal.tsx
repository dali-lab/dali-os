import { Link } from "react-router";
import { Modal, ModalHeader } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import { ProjectIcon } from "~/components/ProjectIcon";
import type { PlanningProjectInfo } from "../../lib/planning-gap.server";
import { PlanBlock, spotsKey, type CoreMember, type DomainOption } from "./PlanBlock";
import { noteMeta, SavedTextField } from "./SavedTextField";

export { sameSpots } from "./PlanBlock";

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
  domains: DomainOption[];
  currentTermId: string | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  const last = info.plannedTerms.length === 0 ? info.lastTerm : null;
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
          {info.plannedTerms.length > 0 ? (
            <span>
              {info.plannedTerms.length} planned {info.plannedTerms.length === 1 ? "term" : "terms"} ahead
            </span>
          ) : (
            <span>Not decided yet</span>
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
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {last ? "Last term" : "Upcoming terms"}
          </h3>
          {info.plannedTerms.map((t) => {
            const spots = info.spotsByTerm[t.id] ?? [];
            return (
              <PlanBlock
                key={`${t.id}:${spotsKey(spots)}`}
                title={
                  <>
                    {t.code}
                    {currentTermId !== null && t.id === currentTermId && (
                      <span className="ml-2 rounded border border-os-accent/40 bg-os-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-os-accent">
                        Current
                      </span>
                    )}
                  </>
                }
                label={t.code}
                pi={info.pisByTerm[t.id] ?? null}
                spots={spots}
                coreMembers={coreMembers}
                domains={domains}
                canEdit={canEdit}
                piFields={{ intent: "pi", projectId: project.id, termId: t.id }}
                spotsFields={{ intent: "spots", projectId: project.id, termId: t.id }}
              />
            );
          })}
          {last && (
            <PlanBlock
              key={`${last.id}:${spotsKey(last.spots)}`}
              title={`Last ran ${last.code}`}
              label={last.code}
              hint="Not planned for coming terms yet. The PI set here carries forward if it continues. Decide terms and spots in Renewals."
              pi={last.pi}
              spots={last.spots}
              coreMembers={coreMembers}
              domains={domains}
              canEdit={canEdit}
              piFields={{ intent: "pi", projectId: project.id, termId: last.id }}
              spotsFields={null}
            />
          )}
          {info.plannedTerms.length === 0 && !last && (
            <p className="text-sm italic text-muted-foreground">This project has no terms yet.</p>
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
